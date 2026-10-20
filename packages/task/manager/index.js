import { TaskGroupModel, TaskModel, StepModel, createId, terminalTask, terminalStep, text, record, invalid } from '../models/index.js';
import { MemoryTaskStore } from '../store/index.js';

const now = () => new Date().toISOString();
const closedStep = () => Object.assign(new Error('步骤已结束，拒绝迟到记录'), { code: 'STEP_CLOSED' });
const stopTask = (snapshot, task, status, reason) => {
  if (terminalTask(task)) return;
  task.task_status = status; task.end_reason = reason; task.ended_at = now();
  for (const step of snapshot.steps.filter(st => st.task_id === task.id && !terminalStep(st))) {
    step.step_status = status === 'cancelled' ? 'cancelled' : step.step_status === 'running' ? status : 'skipped';
    step.error_reason = reason; step.ended_at = now();
  }
};

/** 通用调度入口；scope、节点执行计划、业务执行和写回全部由接入方提供。 */
export class TaskManager {
  #nodes = new Map();
  #running = new Map();
  #closed = false;
  #automatic;
  constructor({ store = new MemoryTaskStore(), nodes = {}, autoStart = true } = {}) {
    this.store = store;
    this.#automatic = autoStart;
    for (const [type, definition] of Object.entries(nodes)) this.register(type, definition);
  }
  register(type, { label = type, plan, execute, commit } = {}) {
    text(type, 'node_type', true); text(label, 'label', true);
    if (this.#nodes.has(type)) throw new Error(`节点类型已注册：${type}`);
    if (typeof plan !== 'function' || typeof execute !== 'function' || (commit !== undefined && typeof commit !== 'function')) invalid('node', '需提供 plan、execute，可选同步 commit');
    if (commit?.constructor.name === 'AsyncFunction') invalid('commit', '必须为同步函数');
    this.#nodes.set(type, { label, plan, execute, commit });
    return this;
  }
  nodeTypes() { return [...this.#nodes].map(([type, node]) => ({ type, label: node.label })); }
  #requireOpen() { if (this.#closed) throw new Error('任务管理器已关闭'); }
  submit(scope, { group = {}, tasks } = {}) {
    this.#requireOpen(); text(scope, 'scope', true);
    if (!Array.isArray(tasks) || !tasks.length) invalid('tasks', '任务组不能为空');
    const bundle = new TaskGroupModel(group).toJSON();
    // 先构建并验证全部计划；某个类型或计划非法时，整组不入库。
    const prepared = tasks.map((fields, index) => {
      const task = new TaskModel({ source: bundle.source, ...fields, group_id: bundle.id, group_seq: index + 1, task_status: 'queued', started_at: null, ended_at: null }).toJSON();
      const node = this.#nodes.get(task.node_type);
      if (!node) invalid('node_type', `未注册：${task.node_type}`);
      const plan = node.plan(structuredClone(task));
      if (!Array.isArray(plan) || !plan.length) invalid('plan', '需为非空步骤数组');
      const steps = plan.map((step, i) => new StepModel({ ...step, task_id: task.id, seq: i + 1, step_status: 'ready', prompt: null, http: [], result: null, started_at: null, ended_at: null }).toJSON());
      return { task, steps };
    });
    this.store.transaction(scope, snapshot => {
      if (snapshot.groups.some(g => g.id === bundle.id)) invalid('group.id', '任务组已存在');
      let order = Math.max(0, ...snapshot.tasks.map(t => t.queue_order));
      snapshot.groups.push(bundle);
      for (const { task, steps } of prepared) {
        task.queue_order = ++order;
        snapshot.tasks.push(task); snapshot.steps.push(...steps);
      }
    });
    if (this.#automatic) this.start(scope);
    return this.store.detail(scope, bundle.id);
  }
  activeGroups(scope) {
    const snapshot = this.store.read(scope, { steps: false });
    return snapshot.groups.filter(g => snapshot.tasks.some(t => t.group_id === g.id && !terminalTask(t)))
      .map(group => ({ group, tasks: snapshot.tasks.filter(t => t.group_id === group.id) }));
  }
  history(scope, filter) { return this.store.history(scope, filter); }
  detail(scope, id) { return this.store.detail(scope, id); }
  historySource(scope) {
    text(scope, 'scope', true);
    return {
      history: filter => this.history(scope, filter),
      detail: id => this.detail(scope, id),
      resolveTask: id => this.store.read(scope, { steps: false }).tasks.find(task => task.id === id)?.group_id || null,
      subscribe: listener => this.store.subscribe(changed => { if (changed === scope) listener(); }),
    };
  }
  start(scope) {
    this.#requireOpen(); text(scope, 'scope', true);
    if (this.#running.has(scope)) return;
    const entry = { controller: null, taskId: null, groupId: null, promise: null };
    this.#running.set(scope, entry);
    let completed = false;
    entry.promise = Promise.resolve().then(async () => { await this.#loop(scope, entry); completed = true; }).finally(() => {
      this.#running.delete(scope);
      // 最后一项结束与释放执行上下文之间，仍可能有新组入队。
      if (completed && !this.#closed && this.#automatic
        && this.store.read(scope, { steps: false }).tasks.some(t => t.task_status === 'queued')) this.start(scope);
    });
    // 避免无人调用 idle 时未处理 rejection；idle 仍能收到原失败。
    entry.promise.catch(() => {});
  }
  async idle(scope) {
    while (this.#running.has(scope)) await this.#running.get(scope).promise;
  }
  cancel(scope, groupId, reason = '用户取消') {
    text(reason, 'reason', true);
    if (!this.store.detail(scope, groupId)) throw new Error('任务组不存在');
    this.store.transaction(scope, snapshot => {
      for (const task of snapshot.tasks.filter(t => t.group_id === groupId)) stopTask(snapshot, task, 'cancelled', reason);
    });
    const entry = this.#running.get(scope);
    if (entry?.groupId === groupId) entry.controller?.abort(new Error(reason));
  }
  continueGroup(scope, groupId) {
    this.#requireOpen();
    const detail = this.detail(scope, groupId);
    if (!detail) throw new Error('任务组不存在');
    if (detail.tasks.some(t => !terminalTask(t))) throw new Error('任务组尚未结束');
    const index = detail.tasks.findIndex(t => t.task_status !== 'completed');
    if (index < 0) throw new Error('任务组已全部完成');
    const { id, created_at, ...group } = detail.group;
    return this.submit(scope, { group: { ...group, action: 'continue' }, tasks: detail.tasks.slice(index).map(task => ({
      node_type: task.node_type, action: task.action, name: task.name, source: task.source, metadata: task.metadata,
    })) });
  }
  recover(scope) {
    this.#requireOpen();
    if (this.#running.has(scope)) throw new Error('不能恢复正在运行的 scope');
    this.store.transaction(scope, snapshot => {
      const groups = new Set();
      for (const task of snapshot.tasks.filter(t => t.task_status === 'running')) {
        groups.add(task.group_id); stopTask(snapshot, task, 'failed', '执行中断，需要重新提交或继续');
      }
      for (const task of snapshot.tasks.filter(t => groups.has(t.group_id) && !terminalTask(t))) stopTask(snapshot, task, 'cancelled', '前序任务执行中断');
    });
    if (this.#automatic) this.start(scope);
  }
  async dispose() {
    if (this.#closed) return;
    this.#closed = true;
    const entries = [...this.#running];
    for (const [scope, entry] of entries) if (entry.groupId) this.cancel(scope, entry.groupId, '任务管理器关闭');
    await Promise.all(entries.map(([, entry]) => entry.promise));
    // store 生命周期由接入方管理，允许新管理器用同一存储恢复排队任务。
  }
  #stepRecord(scope, taskId, stepId, change) {
    this.store.transaction(scope, snapshot => {
      const task = snapshot.tasks.find(t => t.id === taskId), step = snapshot.steps.find(st => st.id === stepId);
      if (task?.task_status !== 'running' || step?.step_status !== 'running') throw closedStep();
      change(step);
    });
  }
  #context(scope, task, step, signal) {
    const transfers = new WeakMap();
    return {
      scope, task: structuredClone(task), step: structuredClone(step), signal,
      previousResults: this.store.read(scope).steps.filter(st => st.task_id === task.id && st.seq < step.seq).map(st => ({ ...st })),
      recordPrompt: ({ model = '', messages, input = {} }) => {
        const prompt = { id: createId(), model, messages: structuredClone(messages), input: structuredClone(input), created_at: now() };
        this.#stepRecord(scope, task.id, step.id, saved => {
          if (saved.prompt) throw new Error('同一步骤只能记录一套提示词；多次模型调用请拆成步骤');
          saved.prompt = prompt;
        });
        return prompt.id;
      },
      recordHttp: (transfer, { drop = false } = {}) => {
        record(transfer, 'transfer');
        this.#stepRecord(scope, task.id, step.id, saved => {
          let binding = transfers.get(transfer);
          if (!binding) { binding = { id: createId(), prompt_id: saved.prompt?.id || null }; transfers.set(transfer, binding); }
          const index = saved.http.findIndex(row => row.id === binding.id);
          if (drop) { if (index >= 0) saved.http.splice(index, 1); return; }
          // HTTP 回调可能包含未设置的可选字段；记录使用实际可序列化值。
          const row = { ...JSON.parse(JSON.stringify(transfer)), ...binding };
          if (index < 0) saved.http.push(row); else saved.http[index] = row;
        });
      },
    };
  }
  #finish(scope, taskId, status, reason, node) {
    this.store.transaction(scope, (snapshot, database) => {
      const task = snapshot.tasks.find(t => t.id === taskId);
      if (task.task_status !== 'running') return;
      if (status === 'completed' && node?.commit) {
        const steps = snapshot.steps.filter(st => st.task_id === taskId);
        const value = node.commit({ scope, task: structuredClone(task), steps: structuredClone(steps), result: structuredClone(steps.at(-1)?.result ?? null), database });
        if (value?.then) throw new TypeError('commit 必须同步；共享 SQLite 时与任务完成处于同一事务');
      }
      task.task_status = status; task.end_reason = reason; task.ended_at = now();
      if (status !== 'completed') {
        for (const step of snapshot.steps.filter(st => st.task_id === taskId && !terminalStep(st))) {
          step.step_status = step.step_status === 'running' ? status : 'skipped'; step.error_reason = reason; step.ended_at = now();
        }
        for (const next of snapshot.tasks.filter(t => t.group_id === task.group_id && !terminalTask(t))) stopTask(snapshot, next, 'cancelled', '前序任务未完成：' + reason);
      }
    });
  }
  async #loop(scope, entry) {
    while (!this.#closed) {
      const task = this.store.read(scope, { steps: false }).tasks.filter(t => t.task_status === 'queued').sort((a, b) => a.queue_order - b.queue_order)[0];
      if (!task) return;
      const node = this.#nodes.get(task.node_type);
      entry.controller = new AbortController(); entry.taskId = task.id; entry.groupId = task.group_id;
      const signal = entry.controller.signal;
      this.store.transaction(scope, snapshot => {
        const saved = snapshot.tasks.find(t => t.id === task.id);
        saved.task_status = 'running'; saved.started_at = now();
      });
      task.task_status = 'running';
      try {
        if (!node) throw new Error(`节点类型未注册：${task.node_type}`);
        const steps = this.store.read(scope).steps.filter(st => st.task_id === task.id).sort((a, b) => a.seq - b.seq);
        let rejected = false;
        for (const step of steps) {
          signal.throwIfAborted();
          this.store.transaction(scope, snapshot => {
            const saved = snapshot.steps.find(st => st.id === step.id);
            saved.step_status = 'running'; saved.started_at = now();
          });
          const outcome = await node.execute(this.#context(scope, task, step, signal));
          signal.throwIfAborted();
          record(outcome ?? {}, 'outcome');
          for (const key of Object.keys(outcome ?? {})) if (!['status', 'result', 'reason'].includes(key)) invalid(`outcome.${key}`, '未知执行结果字段');
          const { status = 'done', result = null, reason = '' } = outcome || {};
          if (!['done', 'rejected', 'skipped'].includes(status)) invalid('outcome.status', '需为 done/rejected/skipped');
          text(reason, 'outcome.reason');
          if (status === 'rejected' && !reason.trim()) invalid('outcome.reason', '未通过必须有原因');
          this.#stepRecord(scope, task.id, step.id, saved => {
            saved.result = structuredClone(result); saved.step_status = status; saved.error_reason = reason; saved.ended_at = now();
          });
          if (status === 'rejected') { this.#finish(scope, task.id, 'rejected', reason); rejected = true; break; }
        }
        if (!rejected) this.#finish(scope, task.id, 'completed', '', node);
      } catch (error) {
        if (!signal.aborted) this.#finish(scope, task.id, 'failed', error.message || String(error));
      } finally { entry.controller = null; entry.taskId = null; entry.groupId = null; }
    }
  }
}
