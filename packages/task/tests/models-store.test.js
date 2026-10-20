import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskGroupModel, TaskModel, StepModel, NodeStateModel } from '../models/index.js';
import { MemoryTaskStore } from '../store/index.js';
import { SQLiteTaskStore } from '../store/sqlite.js';

const fixture = () => {
  const group = new TaskGroupModel({ metadata: { project_id: 'project-1', shot_ids: ['shot-1'] } }).toJSON();
  const task = new TaskModel({ group_id: group.id, node_type: 'custom', metadata: { target_id: 'object-1', opinion: '意见' } }).toJSON();
  const step = new StepModel({ task_id: task.id, kind: 'custom', round: 9 }).toJSON();
  return { groups: [group], tasks: [task], steps: [step] };
};

test('四 Model 仅包含确认字段，业务 metadata 深拷贝，节点状态与执行状态独立', () => {
  const metadata = { project_id: 'p', nested: { value: 1 } };
  const group = new TaskGroupModel({ metadata });
  metadata.nested.value = 2;
  assert.equal(group.metadata.nested.value, 1);
  group.toJSON().metadata.nested.value = 3;
  assert.equal(group.metadata.nested.value, 1);
  assert.equal(Object.hasOwn(group, 'project_id'), false);
  assert.deepEqual(new NodeStateModel().toJSON(), { status: 'empty', reason: '', dependency_hash: '' });
  for (const field of ['project_id', 'target_id', 'opinion', 'previous_node_state', 'input', 'business_type']) {
    assert.throws(() => new TaskModel({ group_id: 'g', node_type: 'n', [field]: 'x' }), { code: 'INVALID_TASK' });
  }
  for (const state of [{ status: 'running' }, { fail_message: '' }, { status: 'rejected' }, { reason: '多余原因' }]) {
    assert.throws(() => new NodeStateModel(state), { code: 'INVALID_TASK' });
  }
  assert.equal(new NodeStateModel({ status: 'expired', reason: '依赖变化', dependency_hash: 'old' }).dependency_hash, 'old');
  assert.equal(fixture().steps[0].round, 9, '公共轮次不限制为 meiji 的三轮');
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => new TaskGroupModel({ metadata: cyclic }), { code: 'INVALID_TASK' });
  assert.throws(() => new TaskGroupModel({ metadata: { a: undefined } }), { code: 'INVALID_TASK' });
});

test('步骤提示词与 HTTP 校验关联，不接受悬空引用', () => {
  const prompt = { id: 'prompt', model: 'model', messages: [{ role: 'user', content: 'text' }], input: {}, created_at: new Date().toISOString() };
  assert.equal(new StepModel({ task_id: 't', kind: 'generate', prompt, http: [{ id: 'h', prompt_id: 'prompt' }] }).http[0].prompt_id, 'prompt');
  assert.throws(() => new StepModel({ task_id: 't', kind: 'generate', http: [{ id: 'h', prompt_id: 'missing' }] }), { code: 'INVALID_TASK' });
  assert.throws(() => new StepModel({ task_id: 't', kind: 'generate', prompt: { ...prompt, messages: [] } }), { code: 'INVALID_TASK' });
});

for (const kind of ['memory', 'sqlite']) {
  test(`${kind}：scope 隔离、分页、外键、回滚及终态不可变`, () => {
    const store = kind === 'memory' ? new MemoryTaskStore() : new SQLiteTaskStore();
    try {
      const data = fixture();
      store.transaction('a', state => Object.assign(state, data));
      assert.equal(store.history('a', { node_type: 'custom' }).total, 1);
      assert.equal(store.history('a', { status: 'completed' }).total, 0);
      assert.equal(store.history('b').total, 0);
      const selected = store.detail('a', data.groups[0].id);
      selected.group.metadata.project_id = 'changed';
      assert.equal(store.detail('a', data.groups[0].id).group.metadata.project_id, 'project-1');
      assert.throws(() => store.transaction('a', state => { state.tasks[0].group_id = 'missing'; }), { code: 'INVALID_TASK' });
      assert.throws(() => store.transaction('a', state => { state.tasks[0].name = 'bad'; throw Error('rollback'); }), /rollback/);
      assert.equal(store.read('a').tasks[0].name, '任务');
      assert.throws(() => store.transaction('a', async () => {}), /必须同步/);
      store.transaction('a', state => { state.tasks[0].task_status = 'completed'; state.steps[0].step_status = 'done'; });
      assert.throws(() => store.transaction('a', state => { state.tasks[0].end_reason = 'late'; }), /不可变/);
      assert.throws(() => store.transaction('a', state => { state.steps[0].result = 'late'; }), /不可变/);
      assert.equal(store.detail('a', data.groups[0].id).status, 'completed');
      assert.equal(store.read('a', { steps: false }).steps.length, 0);
      assert.throws(() => store.history('a', { offset: -1 }), { code: 'INVALID_TASK' });
    } finally { store.close(); }
  });
}

test('SQLite 重开保留记录，共享连接的业务写入与任务事务一起回滚', () => {
  const dir = mkdtempSync(join(tmpdir(), 'task-sqlite-'));
  let store = new SQLiteTaskStore(join(dir, 'task.sqlite'));
  try {
    const data = fixture();
    store.transaction('scope', state => Object.assign(state, data));
    store.close(); store = new SQLiteTaskStore(join(dir, 'task.sqlite'));
    assert.equal(store.history('scope').total, 1);
    store.database.exec('CREATE TABLE business_result(value TEXT)');
    assert.throws(() => store.transaction('scope', (state, db) => {
      db.prepare('INSERT INTO business_result VALUES(?)').run('must rollback');
      state.tasks[0].node_type = '';
    }), { code: 'INVALID_TASK' });
    assert.equal(store.database.prepare('SELECT COUNT(*) AS n FROM business_result').get().n, 0);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

function historyFixture(count = 80) {
  const data = { groups: [], tasks: [], steps: [] };
  for (let i = 0; i < count; i++) {
    const group = new TaskGroupModel({ id: `history-group-${i}` }).toJSON();
    const task = new TaskModel({ id: `history-task-${i}`, group_id: group.id, node_type: i % 2 ? 'odd' : 'even', queue_order: i + 1, task_status: 'completed' }).toJSON();
    const step = new StepModel({ id: `history-step-${i}`, task_id: task.id, kind: 'generate', step_status: 'done', result: '历史正文'.repeat(100) }).toJSON();
    data.groups.push(group); data.tasks.push(task); data.steps.push(step);
  }
  return data;
}

test('SQLite局部事务只UPDATE变化记录，空修改零写入，异常原子回滚', () => {
  const store = new SQLiteTaskStore();
  try {
    const data = fixture();
    store.transaction('s', state => Object.assign(state, data));
    store.database.exec(`CREATE TABLE changed_rows(kind TEXT,id TEXT);
      CREATE TABLE business_result(value TEXT);
      CREATE TRIGGER track_groups AFTER UPDATE ON agent_task_groups BEGIN INSERT INTO changed_rows VALUES('group',NEW.id); END;
      CREATE TRIGGER track_tasks AFTER UPDATE ON agent_tasks BEGIN INSERT INTO changed_rows VALUES('task',NEW.id); END;
      CREATE TRIGGER track_steps AFTER UPDATE ON agent_task_steps BEGIN INSERT INTO changed_rows VALUES('step',NEW.id); END;`);
    store.transaction('s', state => { state.steps[0].result = { answer: 'new' }; }, { taskId: data.tasks[0].id });
    assert.deepEqual(store.database.prepare('SELECT kind,id FROM changed_rows').all().map(row => ({ ...row })), [{ kind: 'step', id: data.steps[0].id }]);
    store.transaction('s', () => {}, { groupId: data.groups[0].id });
    assert.equal(store.database.prepare('SELECT COUNT(*) AS n FROM changed_rows').get().n, 1);
    assert.throws(() => store.transaction('s', (state, db) => {
      db.prepare('INSERT INTO business_result VALUES(?)').run('rollback');
      state.tasks[0].node_type = 'illegal change';
    }, { taskId: data.tasks[0].id }), /不可变/);
    assert.equal(store.database.prepare('SELECT COUNT(*) AS n FROM business_result').get().n, 0);
    assert.deepEqual(store.detail('s', data.groups[0].id).steps[0].result, { answer: 'new' });
  } finally { store.close(); }
});

test('SQLite历史SQL分页与内存状态汇总一致，详情/分页不全读scope或步骤正文', () => {
  const memory = new MemoryTaskStore(), sqlite = new SQLiteTaskStore();
  try {
    const data = historyFixture();
    // 停止状态按组内顺序决定，不能按failed/rejected的固定优先级重排。
    data.tasks[1].task_status = 'cancelled';
    data.tasks[2].task_status = 'running';
    data.tasks[3].task_status = 'queued';
    const extra = new TaskModel({ group_id: data.groups[1].id, group_seq: 2, node_type: 'extra', queue_order: 100, task_status: 'failed', end_reason: 'second task failed' }).toJSON();
    data.tasks.push(extra);
    data.groups.push(new TaskGroupModel({ id: 'empty-group' }).toJSON());
    const other = historyFixture(1);
    for (const store of [memory, sqlite]) {
      store.transaction('s', state => Object.assign(state, data));
      store.transaction('other', state => Object.assign(state, other));
    }
    const read = sqlite.read.bind(sqlite);
    sqlite.read = (scope, options) => {
      assert.ok(options && (options.groupIds || options.groupId), '不得读取完整scope');
      const selected = read(scope, options);
      if (options.groupIds) { assert.equal(options.steps, false); assert.ok(selected.groups.length <= 7); assert.equal(selected.steps.length, 0); }
      return selected;
    };
    for (const status of ['', 'completed', 'queued', 'running', 'failed', 'cancelled', 'rejected']) {
      for (const node_type of ['', 'odd', 'extra', 'missing']) {
        for (const offset of [0, 7, 100]) {
          const filter = { status, node_type, offset, limit: 7 };
          assert.deepEqual(sqlite.history('s', filter), memory.history('s', filter));
        }
      }
    }
    assert.deepEqual(sqlite.detail('s', data.groups[1].id), memory.detail('s', data.groups[1].id));
    assert.equal(sqlite.detail('s', 'missing'), null);
    assert.deepEqual(sqlite.history('other'), memory.history('other'));
    assert.throws(() => sqlite.history('s', { limit: 201 }), { code: 'INVALID_TASK' });
  } finally { sqlite.close(); }
});

for (const kind of ['memory', 'sqlite']) {
  test(`${kind}局部事务不能新增记录，追加不能覆盖历史ID或产生第二个运行任务`, () => {
    const store = kind === 'memory' ? new MemoryTaskStore() : new SQLiteTaskStore();
    try {
      const data = historyFixture(2);
      // 两个组尚未结束，允许领取任务，但scope只能同时运行一个。
      data.tasks.forEach(task => { task.task_status = 'queued'; });
      store.transaction('s', state => Object.assign(state, data));
      assert.throws(() => store.transaction('s', state => { state.groups.push(new TaskGroupModel().toJSON()); }, { groupId: data.groups[0].id }), /不允许添加/);
      assert.throws(() => store.transaction('s', state => { state.groups.push(new TaskGroupModel().toJSON()); }, { groupIds: [data.groups[0].id] }), /不允许添加/);
      assert.throws(() => store.transaction('s', state => Object.assign(state, { groups: [data.groups[0]], tasks: [data.tasks[0]], steps: [data.steps[0]] }), { append: true }));
      store.transaction('s', state => { state.tasks[0].task_status = 'running'; }, { groupId: data.groups[0].id });
      assert.throws(() => store.transaction('s', state => { state.tasks[0].task_status = 'running'; }, { groupId: data.groups[1].id }));
      assert.equal(store.detail('s', data.groups[1].id).tasks[0].task_status, 'queued');
      store.transaction('s', state => {
        state.tasks[0].task_status = 'queued'; state.tasks[1].task_status = 'running';
        state.tasks.reverse();
      });
      assert.equal(store.detail('s', data.groups[1].id).tasks[0].task_status, 'running');
      assert.equal(store.read('s').groups.length, 2);
    } finally { store.close(); }
  });
}
