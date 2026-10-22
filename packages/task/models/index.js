export const TASK_STATUS = Object.freeze(['queued', 'running', 'completed', 'rejected', 'failed', 'cancelled']);
export const STEP_STATUS = Object.freeze(['ready', 'running', 'done', 'rejected', 'failed', 'skipped', 'cancelled']);
export const NODE_STATUS = Object.freeze(['empty', 'generated', 'rejected', 'expired']);
export const terminalTask = task => !['queued', 'running'].includes(task.task_status);
export const terminalStep = step => !['ready', 'running'].includes(step.step_status);
export const createId = () => globalThis.crypto.randomUUID();
export function invalid(path, message) {
  throw Object.assign(new TypeError(`${path}：${message}`), { code: 'INVALID_TASK', path });
}
export function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(path, '需为普通对象');
  return value;
}
export function text(value, path, nonempty = false) {
  if (typeof value !== 'string' || (nonempty && !value.trim())) invalid(path, '需为文本' + (nonempty ? '且不能为空' : ''));
  return value;
}
function integer(value, path, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) invalid(path, `需为不小于 ${min} 的整数`);
}
function json(value, path, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || ancestors.has(value)) invalid(path, '需为无循环引用的 JSON 数据');
  ancestors.add(value);
  if (!Array.isArray(value)) record(value, path);
  for (const [key, item] of Object.entries(value)) json(item, `${path}.${key}`, ancestors);
  ancestors.delete(value);
}
function timestamp(value, path, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid(path, '需为有效时间');
}
function fields(input, defaults) {
  record(input, 'model');
  for (const key of Object.keys(input)) if (!Object.hasOwn(defaults, key)) invalid(key, '未知字段；业务资料放入 metadata');
  const value = { ...defaults, ...input };
  json(value, 'model');
  return structuredClone(value);
}
class Model {
  toJSON() { return structuredClone({ ...this }); }
}
export class TaskGroupModel extends Model {
  constructor(input = {}) {
    super();
    const v = fields(input, { id: createId(), name: '任务组', group_type: 'single', action: 'generate', source: 'api', metadata: {}, created_at: new Date().toISOString() });
    for (const key of ['id', 'name', 'group_type', 'action', 'source']) text(v[key], key, true);
    record(v.metadata, 'metadata'); timestamp(v.created_at, 'created_at');
    Object.assign(this, v);
  }
}
export class TaskModel extends Model {
  constructor(input = {}) {
    super();
    const v = fields(input, { id: createId(), group_id: '', group_seq: 1, node_type: '', action: 'generate', name: '任务', task_status: 'queued', queue_order: 1, source: 'api', metadata: {}, end_reason: '', created_at: new Date().toISOString(), started_at: null, ended_at: null });
    for (const key of ['id', 'group_id', 'node_type', 'action', 'name', 'source']) text(v[key], key, true);
    integer(v.group_seq, 'group_seq', 1); integer(v.queue_order, 'queue_order', 1);
    if (!TASK_STATUS.includes(v.task_status)) invalid('task_status', '未知状态');
    text(v.end_reason, 'end_reason'); record(v.metadata, 'metadata');
    timestamp(v.created_at, 'created_at'); timestamp(v.started_at, 'started_at', true); timestamp(v.ended_at, 'ended_at', true);
    Object.assign(this, v);
  }
}
export function validatePrompt(prompt) {
  record(prompt, 'prompt');
  for (const key of Object.keys(prompt)) if (!['id', 'model', 'messages', 'input', 'created_at'].includes(key)) invalid(`prompt.${key}`, '未知字段');
  text(prompt.id, 'prompt.id', true); text(prompt.model, 'prompt.model');
  if (!Array.isArray(prompt.messages) || !prompt.messages.length) invalid('prompt.messages', '需为非空消息数组');
  for (const [i, message] of prompt.messages.entries()) {
    record(message, `prompt.messages.${i}`); text(message.role, `prompt.messages.${i}.role`, true);
    if (!Object.hasOwn(message, 'content')) invalid(`prompt.messages.${i}.content`, '缺少内容');
  }
  record(prompt.input, 'prompt.input'); timestamp(prompt.created_at, 'prompt.created_at'); json(prompt, 'prompt');
}
export function validateHttp(http, prompt) {
  if (!Array.isArray(http)) invalid('http', '需为数组');
  const ids = new Set();
  for (const row of http) {
    record(row, 'http'); text(row.id, 'http.id', true);
    if (ids.has(row.id)) invalid('http.id', '重复 ID'); ids.add(row.id);
    if (row.prompt_id !== null && row.prompt_id !== prompt?.id) invalid('http.prompt_id', '需关联本步骤提示词，或为 null');
    json(row, 'http');
  }
}
export class StepModel extends Model {
  constructor(input = {}) {
    super();
    const v = fields(input, { id: createId(), task_id: '', name: '步骤', seq: 1, kind: '', round: 0, executor: 'program', step_status: 'ready', error_reason: '', prompt: null, http: [], result: null, metadata: {}, started_at: null, ended_at: null });
    for (const key of ['id', 'task_id', 'name', 'kind']) text(v[key], key, true);
    integer(v.seq, 'seq', 1); integer(v.round, 'round');
    if (!['ai', 'program'].includes(v.executor)) invalid('executor', '需为 ai 或 program');
    if (!STEP_STATUS.includes(v.step_status)) invalid('step_status', '未知状态');
    text(v.error_reason, 'error_reason'); record(v.metadata, 'metadata');
    if (v.prompt !== null) validatePrompt(v.prompt);
    validateHttp(v.http, v.prompt);
    timestamp(v.started_at, 'started_at', true); timestamp(v.ended_at, 'ended_at', true);
    Object.assign(this, v);
  }
}
export class NodeStateModel extends Model {
  constructor(input = {}) {
    super();
    const v = fields(input, { type: 0, opinion: '', status: 'empty', reason: '', last_execution: null, dependency_hash: '', supports_supplement: false, rules: {} });
    if (![0, 1].includes(v.type)) invalid('type', '需为0或1');
    text(v.opinion, 'opinion'); record(v.rules, 'rules');
    if (typeof v.supports_supplement !== 'boolean') invalid('supports_supplement', '需为布尔值');
    if (v.type === 0 && (v.opinion || v.supports_supplement || Object.keys(v.rules).length)) invalid('type', '程序节点不保存AI意见或规则');
    if (v.type === 1) {
      for (const action of ['generate', 'review', 'revise']) {
        record(v.rules[action], `rules.${action}`);
        text(v.rules[action].base, `rules.${action}.base`); text(v.rules[action].supplement, `rules.${action}.supplement`);
        if (Object.keys(v.rules[action]).some(key => !['base', 'supplement'].includes(key))) invalid('rules', '未知规则字段');
      }
      if (Object.keys(v.rules).some(key => !['generate', 'review', 'revise'].includes(key))) invalid('rules', '未知动作');
    }
    if (v.last_execution !== null) {
      const e = v.last_execution;
      record(e, 'last_execution');
      if (Object.keys(e).sort().join(',') !== 'finished_at,message,status,stop_code,task_id') invalid('last_execution', '结束摘要字段不完整或包含未知字段');
      text(e.task_id, 'last_execution.task_id', true); text(e.message, 'last_execution.message', true);
      timestamp(e.finished_at, 'last_execution.finished_at');
      const statuses = { completed: ['completed'], rejected: ['revision_limit_reached', 'content_issue', 'rule_conflict', 'upstream_issue', 'validation_failed'], failed: ['request_failed', 'execution_error'], cancelled: ['cancelled'] };
      if (!statuses[e.status]?.includes(e.stop_code)) invalid('last_execution.stop_code', '与执行终态不一致');
    }
    if (!NODE_STATUS.includes(v.status)) invalid('status', '未知节点数据状态');
    text(v.reason, 'reason'); text(v.dependency_hash, 'dependency_hash');
    if (['rejected', 'expired'].includes(v.status) !== Boolean(v.reason.trim())) invalid('reason', '与节点状态不一致');
    Object.assign(this, v);
  }
}

export function groupSummary(group, tasks) {
  const sorted = [...tasks].sort((a, b) => a.group_seq - b.group_seq);
  const stopped = sorted.find(t => ['rejected', 'failed', 'cancelled'].includes(t.task_status));
  const status = stopped?.task_status || (sorted.some(t => t.task_status === 'running') ? 'running'
    : sorted.some(t => t.task_status === 'queued') ? 'queued' : sorted.length ? 'completed' : 'queued');
  return { group, tasks: sorted, status, reason: stopped?.end_reason || '', total_tasks: sorted.length, completed_tasks: sorted.filter(t => t.task_status === 'completed').length };
}
