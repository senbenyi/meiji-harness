import { TaskGroupModel, TaskModel, StepModel, groupSummary, terminalTask, terminalStep, text, invalid } from '../models/index.js';

export const emptySnapshot = () => ({ groups: [], tasks: [], steps: [] });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const collections = ['groups', 'tasks', 'steps'];
export function snapshotChanges(next, previous) {
  return Object.fromEntries(collections.map(key => {
    const prior = new Map(previous[key].map(row => [row.id, row]));
    return [key, next[key].filter(row => !prior.has(row.id) || !same(row, prior.get(row.id)))];
  }));
}
export function validatePagination(offset, limit) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) invalid('pagination', 'offset >= 0，limit 为 1–200');
}
export function validateSnapshot(next, previous = emptySnapshot()) {
  const normalized = {
    groups: next.groups.map(row => new TaskGroupModel(row).toJSON()),
    tasks: next.tasks.map(row => new TaskModel(row).toJSON()),
    steps: next.steps.map(row => new StepModel(row).toJSON()),
  };
  for (const key of ['groups', 'tasks', 'steps']) {
    const ids = normalized[key].map(row => row.id);
    if (new Set(ids).size !== ids.length) invalid(key, '存在重复 ID');
    const byId = new Map(normalized[key].map(row => [row.id, row]));
    for (const row of previous[key]) {
      const found = byId.get(row.id);
      if (!found) invalid(key, '不允许删除已有执行记录');
      for (const field of key === 'tasks' ? ['group_id', 'group_seq', 'queue_order', 'node_type', 'metadata'] : key === 'steps' ? ['task_id', 'seq', 'kind', 'executor', 'round', 'metadata'] : []) {
        if (!same(found[field], row[field])) invalid(`${key}.${field}`, '已有任务的归属、计划与业务参数不可变');
      }
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
  transaction(scope, change, selection = {}) {
    text(scope, 'scope', true);
    if (change.constructor.name === 'AsyncFunction') throw new TypeError('task 事务回调必须同步');
    if (this.#writing) throw new Error('不允许嵌套 task 事务');
    this.#writing = true;
    let result;
    try {
      result = this.atomic(() => {
        const before = this.read(scope, selection), draft = structuredClone(before);
        const value = change(draft, this.database);
        if (value?.then) throw new TypeError('task 事务回调必须同步；异步执行放在事务之外');
        const next = validateSnapshot(draft, before);
        if (!selection.append && (selection.taskId || selection.groupId || selection.groupIds || selection.activeOnly)) {
          for (const key of collections) if (next[key].length !== before[key].length) invalid(key, '局部事务不允许添加记录');
        }
        this.write(scope, next, before);
        return structuredClone(value);
      });
    } finally { this.#writing = false; }
    this.notify(scope);
    return result;
  }
  atomic(run) { return run(); }
  hasGroup(scope, id) { return this.read(scope, { groupId: id, steps: false }).groups.some(group => group.id === id); }
  taskGroupId(scope, id) { return this.read(scope, { steps: false }).tasks.find(task => task.id === id)?.group_id || null; }
  queueTail(scope) { return this.read(scope, { steps: false }).tasks.reduce((max, task) => Math.max(max, task.queue_order), 0); }
  history(scope, { status = '', node_type = '', offset = 0, limit = 50 } = {}) {
    validatePagination(offset, limit);
    const snapshot = this.read(scope, { steps: false });
    const members = new Map();
    for (const task of snapshot.tasks) {
      if (!members.has(task.group_id)) members.set(task.group_id, []);
      members.get(task.group_id).push(task);
    }
    const rows = snapshot.groups.map(group => groupSummary(group, members.get(group.id) || []))
      .filter(row => (!status || row.status === status) && (!node_type || row.tasks.some(t => t.node_type === node_type)))
      .sort((a, b) => Math.max(0, ...b.tasks.map(t => t.queue_order)) - Math.max(0, ...a.tasks.map(t => t.queue_order)));
    return { groups: rows.slice(offset, offset + limit), total: rows.length, offset, limit };
  }
  detail(scope, groupId) {
    const snapshot = this.read(scope, { groupId }), group = snapshot.groups.find(g => g.id === groupId);
    if (!group) return null;
    const tasks = snapshot.tasks.filter(t => t.group_id === groupId);
    const ids = new Set(tasks.map(t => t.id));
    const order = new Map(tasks.map(task => [task.id, task.group_seq]));
    return { ...groupSummary(group, tasks), steps: snapshot.steps.filter(st => ids.has(st.task_id)).sort((a, b) =>
      order.get(a.task_id) - order.get(b.task_id) || a.seq - b.seq) };
  }
}

export class MemoryTaskStore extends TaskStore {
  #scopes = new Map();
  read(scope, { steps = true, groupId, taskId, groupIds, activeOnly = false, append = false } = {}) {
    text(scope, 'scope', true);
    if (append) return emptySnapshot();
    const data = this.#scopes.get(scope);
    if (!data) return emptySnapshot();
    if (taskId) groupId = data.tasks.get(taskId)?.group_id || '';
    let selected = groupIds ? new Set(groupIds) : groupId !== undefined ? new Set([groupId]) : null;
    if (activeOnly) {
      const active = new Set([...data.tasks.values()].filter(task => !terminalTask(task)).map(task => task.group_id));
      selected = selected ? new Set([...selected].filter(id => active.has(id))) : active;
    }
    const groups = [...data.groups.values()].filter(group => !selected || selected.has(group.id));
    const tasks = [...data.tasks.values()].filter(task => !selected || selected.has(task.group_id));
    const ids = new Set(tasks.map(task => task.id));
    return structuredClone({ groups, tasks, steps: steps ? [...data.steps.values()].filter(step => ids.has(step.task_id)) : [] });
  }
  write(scope, data, previous = this.read(scope)) {
    const current = this.#scopes.get(scope) || { groups: new Map(), tasks: new Map(), steps: new Map() };
    const delta = snapshotChanges(data, previous);
    for (const key of collections) {
      const prior = new Set(previous[key].map(row => row.id));
      for (const row of delta[key]) if (!prior.has(row.id) && current[key].has(row.id)) invalid(key, '记录 ID 已存在');
    }
    const changedTasks = new Set(delta.tasks.map(task => task.id));
    let running = delta.tasks.filter(task => task.task_status === 'running').length;
    const orders = new Set(), positions = new Set();
    for (const task of current.tasks.values()) if (!changedTasks.has(task.id)) {
      if (task.task_status === 'running') running++;
      orders.add(task.queue_order); positions.add(JSON.stringify([task.group_id, task.group_seq]));
    }
    for (const task of delta.tasks) {
      const position = JSON.stringify([task.group_id, task.group_seq]);
      if (orders.has(task.queue_order) || positions.has(position)) invalid('task', '组内顺序或队列顺序重复');
      orders.add(task.queue_order); positions.add(position);
    }
    if (running > 1) invalid('task_status', '同一 scope 只能有一个运行中任务');
    const prepared = Object.fromEntries(collections.map(key => [key, structuredClone(delta[key])]));
    for (const key of collections) for (const row of prepared[key]) current[key].set(row.id, row);
    this.#scopes.set(scope, current);
  }
  taskGroupId(scope, id) { text(scope, 'scope', true); return this.#scopes.get(scope)?.tasks.get(id)?.group_id || null; }
  hasGroup(scope, id) { text(scope, 'scope', true); return this.#scopes.get(scope)?.groups.has(id) || false; }
  queueTail(scope) {
    text(scope, 'scope', true);
    let max = 0;
    for (const task of this.#scopes.get(scope)?.tasks.values() || []) max = Math.max(max, task.queue_order);
    return max;
  }
  scopes() { return [...this.#scopes.keys()]; }
  close() {}
}
