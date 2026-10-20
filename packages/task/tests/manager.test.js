import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskManager, MemoryTaskStore, TaskGroupModel, TaskModel, StepModel } from '../index.js';
import { SQLiteTaskStore } from '../store/sqlite.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const plan = () => [{ kind: 'prepare', name: '准备' }, { kind: 'generate', name: '生成', executor: 'ai' }];
const tasks = n => Array.from({ length: n }, (_, i) => ({ node_type: 'custom', name: `任务${i + 1}`, metadata: { object: i } }));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('业务注册计划、两组同 scope 串行，节点种类由调用方提供，组进度正确', async () => {
  const order = [];
  const manager = new TaskManager({ nodes: { custom: { label: '自定义节点', plan, execute: async ({ task, step, previousResults }) => {
    order.push([task.name, step.kind]);
    if (step.kind === 'generate') assert.equal(previousResults[0].result, '准备完毕');
    return { result: step.kind === 'prepare' ? '准备完毕' : '输出' };
  } } } });
  const first = manager.submit('scope', { tasks: tasks(2) });
  const second = manager.submit('scope', { tasks: tasks(1) });
  assert.equal(manager.activeGroups('scope').length, 2);
  await manager.idle('scope');
  assert.deepEqual(order.map(row => row[1]), ['prepare', 'generate', 'prepare', 'generate', 'prepare', 'generate']);
  assert.deepEqual(manager.nodeTypes(), [{ type: 'custom', label: '自定义节点' }]);
  assert.equal(manager.detail('scope', first.group.id).completed_tasks, 2);
  assert.equal(manager.detail('scope', second.group.id).status, 'completed');
  assert.equal(manager.activeGroups('scope').length, 0);
  assert.throws(() => manager.submit('scope', { tasks: [{ node_type: 'missing' }] }), /未注册/);
  await manager.dispose();
});

test('执行器异常和不合法返回均记失败，后续组继续，错误不混成审核拒绝', async () => {
  const manager = new TaskManager({ nodes: { custom: { plan, execute: async ({ task }) => {
    if (task.metadata.throw) throw Error('network failed');
    if (task.metadata.invalid) return '不能悄悄丢弃的结果';
    return { result: 'ok' };
  } } } });
  const groups = [];
  for (const metadata of [{ throw: true }, { invalid: true }, {}]) groups.push(manager.submit('s', { tasks: [{ node_type: 'custom', metadata }] }));
  await manager.idle('s');
  assert.deepEqual(groups.map(g => manager.detail('s', g.group.id).status), ['failed', 'failed', 'completed']);
  assert.match(manager.detail('s', groups[0].group.id).tasks[0].end_reason, /network failed/);
  await manager.dispose();
});

test('关闭时取消运行组，保留未开始的独立组，新管理器可继续执行', async () => {
  const store = new MemoryTaskStore(), entered = deferred();
  const first = new TaskManager({ store, nodes: { custom: { plan, execute: async ({ signal }) => {
    entered.resolve(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    return { result: 'late' };
  } } } });
  const running = first.submit('s', { tasks: tasks(1) }), queued = first.submit('s', { tasks: tasks(1) });
  await entered.promise; await first.dispose();
  assert.equal(first.detail('s', running.group.id).status, 'cancelled');
  assert.equal(first.detail('s', queued.group.id).status, 'queued');
  const second = new TaskManager({ store, nodes: { custom: { plan, execute: async () => ({ result: 'restarted' }) } } });
  second.recover('s'); await second.idle('s');
  assert.equal(second.detail('s', queued.group.id).status, 'completed');
  await second.dispose();
});

test('不同 scope 可并行，不通过 metadata.project_id 分队列', async () => {
  const gate = deferred(), entered = deferred();
  const manager = new TaskManager({ nodes: { custom: { plan, execute: async ({ scope }) => {
    if (scope === 'a') { entered.resolve(); await gate.promise; }
    return { result: scope };
  } } } });
  manager.submit('a', { tasks: tasks(1) }); await entered.promise;
  const b = manager.submit('b', { tasks: tasks(1) });
  await manager.idle('b');
  assert.equal(manager.detail('b', b.group.id).status, 'completed');
  gate.resolve(); await manager.idle('a'); await manager.dispose();
});

test('队列即将空闲时入队的新组不会滞留，idle 等待补启动完成', async () => {
  const manager = new TaskManager({ nodes: { custom: { plan, execute: async () => ({ result: 'ok' }) } } });
  let appended = false, second;
  const unsubscribe = manager.store.subscribe(scope => {
    if (!appended && manager.store.read(scope).tasks.some(t => t.task_status === 'completed')) {
      appended = true;
      queueMicrotask(() => queueMicrotask(() => { second = manager.submit(scope, { tasks: tasks(1) }); }));
    }
  });
  manager.submit('s', { tasks: tasks(1) }); await manager.idle('s');
  assert.equal(manager.detail('s', second.group.id).status, 'completed');
  unsubscribe(); await manager.dispose();
});

test('审核拒绝与执行异常分开，组内后续取消，继续创建新组且旧历史不变', async () => {
  let reject = true;
  const manager = new TaskManager({ nodes: { custom: { plan, execute: async ({ step }) =>
    reject && step.kind === 'generate' ? { status: 'rejected', reason: '不符合要求', result: { check: false } } : { result: 'ok' },
  } } });
  const row = manager.submit('s', { tasks: tasks(2) }); await manager.idle('s');
  const original = manager.detail('s', row.group.id);
  assert.deepEqual(original.tasks.map(t => t.task_status), ['rejected', 'cancelled']);
  assert.equal(original.steps[1].step_status, 'rejected');
  reject = false;
  const next = manager.continueGroup('s', row.group.id); await manager.idle('s');
  assert.notEqual(next.group.id, row.group.id);
  assert.equal(manager.detail('s', next.group.id).status, 'completed');
  assert.deepEqual(manager.detail('s', row.group.id), original);
  await manager.dispose();
});

test('记录按请求对象更新、稳定关联提示词，drop 删除指定 HTTP，终态拒绝迟到记录', async () => {
  let context;
  const manager = new TaskManager({ nodes: { custom: { plan: () => [{ kind: 'generate', executor: 'ai' }], execute: async ctx => {
    context = ctx;
    const promptId = ctx.recordPrompt({ model: 'any', messages: [{ role: 'user', content: '实际消息' }] });
    const transfer = { method: 'POST', path: '/model', request: { body: 'request' } };
    await ctx.recordHttp(transfer);
    transfer.status = 200; transfer.body = 'response';
    await ctx.recordHttp(transfer);
    const removed = { method: 'GET', path: '/poll' };
    ctx.recordHttp(removed); ctx.recordHttp(removed, { drop: true });
    return { result: promptId };
  } } } });
  const row = manager.submit('s', { tasks: tasks(1) }); await manager.idle('s');
  const step = manager.detail('s', row.group.id).steps[0];
  assert.equal(step.http.length, 1);
  assert.equal(step.http[0].prompt_id, step.prompt.id);
  assert.equal(step.http[0].body, 'response');
  assert.throws(() => context.recordHttp({}), { code: 'STEP_CLOSED' });
  assert.throws(() => context.recordPrompt({ messages: [{ role: 'user', content: 'late' }] }), { code: 'STEP_CLOSED' });
  await manager.dispose();
});

test('取消赶在标为运行中之前时，不中断同 scope 的后续任务', async () => {
  class ReadHookStore extends MemoryTaskStore {
    onQueueRead = null;
    read(scope, options) {
      const data = super.read(scope, options);
      if (options?.steps === false && this.onQueueRead) this.onQueueRead(scope, data);
      return data;
    }
  }
  const store = new ReadHookStore();
  const ran = [];
  const manager = new TaskManager({ store, autoStart: false, nodes: { custom: { plan: () => [{ kind: 'generate' }], execute: async ({ task }) => {
    ran.push(task.group_id); return { result: 'ok' };
  } } } });
  const first = manager.submit('s', { tasks: tasks(1) });
  const next = manager.submit('s', { tasks: tasks(1) });
  store.onQueueRead = (scope, data) => {
    store.onQueueRead = null;
    const queued = data.tasks.filter(t => t.task_status === 'queued').sort((a, b) => a.queue_order - b.queue_order)[0];
    manager.cancel(scope, queued.group_id);
  };
  manager.start('s');
  await manager.idle('s');
  assert.equal(manager.detail('s', first.group.id).status, 'cancelled');
  assert.equal(manager.detail('s', next.group.id).status, 'completed');
  assert.deepEqual(ran, [next.group.id]);
  await manager.dispose();
});

test('取消可中断执行，迟到返回不覆盖状态，同 scope 下一个组继续', async () => {
  const entered = deferred(), finish = deferred(); let late;
  const manager = new TaskManager({ nodes: { custom: { plan: () => [{ kind: 'generate' }], execute: async ctx => {
    if (ctx.task.metadata.wait) { late = ctx; entered.resolve(); await finish.promise; }
    return { result: 'late output' };
  } } } });
  const first = manager.submit('s', { tasks: [{ node_type: 'custom', metadata: { wait: true } }] });
  const next = manager.submit('s', { tasks: tasks(1) });
  await entered.promise; manager.cancel('s', first.group.id);
  assert.equal(late.signal.aborted, true);
  assert.throws(() => late.recordHttp({}), { code: 'STEP_CLOSED' });
  finish.resolve(); await manager.idle('s');
  assert.equal(manager.detail('s', first.group.id).status, 'cancelled');
  assert.equal(manager.detail('s', next.group.id).status, 'completed');
  await manager.dispose();
});

test('重启恢复把中断执行标为失败，不重放外部请求；独立排队组仍可执行', async () => {
  const store = new MemoryTaskStore();
  const manager = new TaskManager({ store, autoStart: false, nodes: { custom: { plan, execute: async () => ({ result: 'ok' }) } } });
  const interrupted = manager.submit('s', { tasks: tasks(2) });
  const queued = manager.submit('s', { tasks: tasks(1) });
  store.transaction('s', snapshot => { snapshot.tasks[0].task_status = 'running'; snapshot.steps[0].step_status = 'running'; });
  manager.recover('s');
  assert.deepEqual(manager.detail('s', interrupted.group.id).tasks.map(t => t.task_status), ['failed', 'cancelled']);
  manager.start('s'); await manager.idle('s');
  assert.equal(manager.detail('s', queued.group.id).status, 'completed');
  await manager.dispose();
});

test('SQLite 关闭重开后恢复中断组，执行次数不会因恢复而增加', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'task-recover-'));
  let store = new SQLiteTaskStore(join(directory, 'tasks.sqlite')), manager;
  let executed = 0;
  const nodes = { custom: { plan, execute: async () => { executed++; return { result: 'ok' }; } } };
  try {
    manager = new TaskManager({ store, nodes, autoStart: false });
    const original = manager.submit('s', { tasks: tasks(2) });
    store.transaction('s', snapshot => { snapshot.tasks[0].task_status = 'running'; snapshot.steps[0].step_status = 'running'; });
    await manager.dispose(); store.close();
    store = new SQLiteTaskStore(join(directory, 'tasks.sqlite'));
    manager = new TaskManager({ store, nodes });
    manager.recover('s'); await manager.idle('s');
    assert.equal(executed, 0);
    assert.deepEqual(manager.detail('s', original.group.id).tasks.map(t => t.task_status), ['failed', 'cancelled']);
  } finally { await manager?.dispose(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('SQLite commit 业务写回抛错时回滚，任务记失败；正常写回与完成一并提交', async () => {
  const store = new SQLiteTaskStore(); store.database.exec('CREATE TABLE outputs(value TEXT)');
  let fail = true;
  const manager = new TaskManager({ store, nodes: { custom: { plan: () => [{ kind: 'generate' }], execute: async () => ({ result: 'output' }), commit({ database, result }) {
    database.prepare('INSERT INTO outputs VALUES(?)').run(result);
    if (fail) throw Error('业务提交失败');
  } } } });
  try {
    const first = manager.submit('s', { tasks: tasks(1) }); await manager.idle('s');
    assert.equal(manager.detail('s', first.group.id).status, 'failed');
    assert.equal(store.database.prepare('SELECT COUNT(*) AS n FROM outputs').get().n, 0);
    fail = false;
    const next = manager.submit('s', { tasks: tasks(1) }); await manager.idle('s');
    assert.equal(manager.detail('s', next.group.id).status, 'completed');
    assert.equal(store.database.prepare('SELECT COUNT(*) AS n FROM outputs').get().n, 1);
  } finally { await manager.dispose(); store.close(); }
});

for (const backend of ['memory', 'sqlite']) {
  test(`${backend}调度、HTTP记录、取消及恢复只读取当前组/活动组，不扫描完整历史`, async () => {
    const store = backend === 'sqlite' ? new SQLiteTaskStore() : new MemoryTaskStore();
    const seed = { groups: [], tasks: [], steps: [] };
    for (let i = 0; i < 120; i++) {
      const group = new TaskGroupModel().toJSON();
      const task = new TaskModel({ group_id: group.id, node_type: 'custom', queue_order: i + 1, task_status: 'completed' }).toJSON();
      seed.groups.push(group); seed.tasks.push(task);
      seed.steps.push(new StepModel({ task_id: task.id, kind: 'generate', step_status: 'done', result: 'heavy historical HTTP'.repeat(100) }).toJSON());
    }
    store.transaction('s', snapshot => Object.assign(snapshot, seed));
    const read = store.read.bind(store);
    store.read = (scope, options) => {
      assert.ok(options && (options.append || options.taskId || options.groupId || options.activeOnly || options.groupIds), '调度不能全读历史');
      const snapshot = read(scope, options);
      assert.ok(snapshot.groups.length <= 2, '工作快照只含活动组');
      return snapshot;
    };
    let records = 0;
    const manager = new TaskManager({ store, autoStart: false, nodes: { custom: {
      plan: () => [{ kind: 'generate', executor: 'ai' }],
      execute: async context => {
        context.recordPrompt({ model: 'custom', messages: [{ role: 'user', content: 'hello' }] });
        const transfer = { method: 'POST', path: '/mock', request: { body: 'request' } };
        for (let i = 0; i < 12; i++) { transfer.status = i; context.recordHttp(transfer); records++; }
        return { result: 'ok' };
      },
    } } });
    try {
      const first = manager.submit('s', { tasks: tasks(1) });
      assert.equal(first.tasks[0].queue_order, 121);
      manager.start('s'); await manager.idle('s');
      assert.equal(manager.detail('s', first.group.id).status, 'completed');
      assert.equal(records, 12);
      assert.equal(manager.historySource('s').resolveTask(seed.tasks[0].id), seed.groups[0].id);
      const next = manager.submit('s', { tasks: tasks(1) });
      manager.cancel('s', next.group.id);
      manager.recover('s');
      assert.equal(manager.detail('s', next.group.id).status, 'cancelled');
      assert.equal(manager.activeGroups('s').length, 0);
    } finally { await manager.dispose(); store.close(); }
  });
}
