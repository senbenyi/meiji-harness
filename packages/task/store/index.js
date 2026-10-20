import { TaskGroupModel, TaskModel, StepModel, groupSummary, terminalTask, terminalStep, text, invalid } from '../models/index.js';

export const emptySnapshot = () => ({ groups: [], tasks: [], steps: [] });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function validateSnapshot(next, previous = emptySnapshot()) {
  const normalized = {
    groups: next.groups.map(row => new TaskGroupModel(row).toJSON()),
    tasks: next.tasks.map(row => new TaskModel(row).toJSON()),
    steps: next.steps.map(row => new StepModel(row).toJSON()),
  };
  for (const key of ['groups', 'tasks', 'steps']) {
    const ids = normalized[key].map(row => row.id);
    if (new Set(ids).size !== ids.length) invalid(key, '存在重复 ID');
    for (const row of previous[key]) {
      const found = normalized[key].find(item => item.id === row.id);
      if (!found) invalid(key, '不允许删除已有执行记录');
      if ((key === 'groups' || (key === 'tasks' && terminalTask(row)) || (key === 'steps' && terminalStep(row))) && !same(found, row)) {
        invalid(key, '任务组定义及终态记录不可变');
      }
    }
  }
  const groups = new Set(normalized.groups.map(row => row.id)), tasks = new Set(normalized.tasks.map(row => row.id));
  const positions = new Set(), orders = new Set(), steps = new Set();
  let running = 0;
  for (const task of normalized.tasks) {
    if (!groups.has(task.group_id)) invalid('group_id', '任务组不存在');
    const position = `${task.group_id}:${task.group_seq}`;
    if (positions.has(position) || orders.has(task.queue_order)) invalid('task', '组内顺序或队列顺序重复');
    positions.add(position); orders.add(task.queue_order);
    if (task.task_status === 'running') running++;
  }
  if (running > 1) invalid('task_status', '同一 scope 只能有一个运行中任务');
  for (const step of normalized.steps) {
    if (!tasks.has(step.task_id)) invalid('task_id', '所属任务不存在');
    const position = `${step.task_id}:${step.seq}`;
    if (steps.has(position)) invalid('seq', '任务内步骤顺序重复');
    steps.add(position);
  }
  return normalized;
}

export class TaskStore {
  #listeners = new Set();
  #writing = false;
  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  notify(scope) {
    // 订阅是通知，不参与已经完成的事务，也不能让提交结果变成失败。
    for (const listener of this.#listeners) { try { listener(scope); } catch {} }
  }
  transaction(scope, change) {
    text(scope, 'scope', true);
    if (this.#writing) throw new Error('不允许嵌套 task 事务');
    this.#writing = true;
    let result;
    try {
      result = this.atomic(() => {
        const before = this.read(scope), draft = structuredClone(before);
        const value = change(draft, this.database);
        if (value?.then) throw new TypeError('task 事务回调必须同步；异步执行放在事务之外');
        this.write(scope, validateSnapshot(draft, before));
        return structuredClone(value);
      });
    } finally { this.#writing = false; }
    this.notify(scope);
    return result;
  }
  atomic(run) { return run(); }
  history(scope, { status = '', node_type = '', offset = 0, limit = 50 } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) invalid('pagination', 'offset >= 0，limit 为 1–200');
    const snapshot = this.read(scope, { steps: false });
    const rows = snapshot.groups.map(group => groupSummary(group, snapshot.tasks.filter(t => t.group_id === group.id)))
      .filter(row => (!status || row.status === status) && (!node_type || row.tasks.some(t => t.node_type === node_type)))
      .sort((a, b) => Math.max(0, ...b.tasks.map(t => t.queue_order)) - Math.max(0, ...a.tasks.map(t => t.queue_order)));
    return { groups: rows.slice(offset, offset + limit), total: rows.length, offset, limit };
  }
  detail(scope, groupId) {
    const snapshot = this.read(scope), group = snapshot.groups.find(g => g.id === groupId);
    if (!group) return null;
    const tasks = snapshot.tasks.filter(t => t.group_id === groupId);
    const ids = new Set(tasks.map(t => t.id));
    return { ...groupSummary(group, tasks), steps: snapshot.steps.filter(st => ids.has(st.task_id)).sort((a, b) => a.seq - b.seq) };
  }
}

export class MemoryTaskStore extends TaskStore {
  #scopes = new Map();
  read(scope, { steps = true } = {}) {
    text(scope, 'scope', true);
    const data = this.#scopes.get(scope) || emptySnapshot();
    return structuredClone({ ...data, steps: steps ? data.steps : [] });
  }
  write(scope, data) { this.#scopes.set(scope, structuredClone(data)); }
  scopes() { return [...this.#scopes.keys()]; }
  close() {}
}
