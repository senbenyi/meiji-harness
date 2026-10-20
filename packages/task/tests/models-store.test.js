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
