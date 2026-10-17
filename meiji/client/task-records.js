import { request } from './task-client.js';

// 最近节点/组摘要批量读取；token 守卫拒绝切换项目后的晚到结果。
export async function loadLatestRecords(context) {
  const token = context.token(), missing = context.neededRecords();
  const batches = Math.max(Math.ceil(missing.task_ids.length / 200), Math.ceil(missing.group_ids.length / 200));
  let changed = false;
  for (let index = 0; index < batches && context.valid(token); index++) {
    const ids = { task_ids: missing.task_ids.slice(index * 200, (index + 1) * 200), group_ids: missing.group_ids.slice(index * 200, (index + 1) * 200) };
    const data = await request('records?' + new URLSearchParams({ session_id: token.session_id || '', task_ids: ids.task_ids.join(','), group_ids: ids.group_ids.join(',') }));
    changed = context.acceptRecords(token, data, ids) || changed;
  }
  return changed;
}

// 历史缓存与当前项目绑定，异步完成只重绘当前页面，不能把用户拉回历史页。
function cacheOf(env) {
  if (env.state.taskRecords?.project !== env.p.id) env.state.taskRecords = { project: env.p.id, details: {}, pages: {}, pending: {}, errors: {} };
  return env.state.taskRecords;
}
function load(env, key, path, save) {
  const cache = cacheOf(env), ownerDocument = globalThis.document;
  if (cache.pending[key] || cache.errors[key]) return;
  cache.pending[key] = true;
  request(path).then(data => {
    if (env.state.taskRecords === cache && (!env.valid || env.valid())) save(cache, data);
  }).catch(error => { if (env.state.taskRecords === cache && (!env.valid || env.valid())) cache.errors[key] = error.message || '读取失败'; })
    .finally(() => {
      delete cache.pending[key];
      if (globalThis.document === ownerDocument && env.state.taskRecords === cache && env.state.page === 'history' && (!env.valid || env.valid())) {
        if (env.paint) env.paint(); else env.go('history', {});
      }
    });
}
export function historyRecords(env, snapshot) {
  const cache = cacheOf(env), state = env.state;
  const filter = { status: state.history_status || '', business: state.history_business || '', episode: state.history_episode || '', offset: state.history_offset || 0, limit: 50 };
  const key = 'page:' + JSON.stringify(filter) + ':' + (snapshot.runtime?.revision || 0);
  if (!cache.pages[key]) load(env, key, 'history?' + new URLSearchParams({ session_id: env.session_id || '', ...filter }), (c, data) => { c.pages = { [key]: data }; });
  return { data: cache.pages[key], error: cache.errors[key], retry: () => { delete cache.errors[key]; env.paint?.(); } };
}
export function groupRecords(env, snapshot, groupId) {
  const cache = cacheOf(env), current = cache.details[groupId];
  const live = snapshot.tasks.some(t => t.group_id === groupId && ['queued', 'running'].includes(t.task_status));
  const version = `${snapshot.runtime?.revision || 0}:${env.state.recordVersions?.[groupId] || 0}`;
  const key = 'group:' + groupId;
  if (!current || ((live || current.live) && current.version !== version)) {
    load(env, key, 'group?' + new URLSearchParams({ session_id: env.session_id || '', group_id: groupId }), (c, data) => {
      c.details[groupId] = { ...data, live: data.tasks.some(t => ['queued', 'running'].includes(t.task_status)), version };
    });
  }
  return { data: current, error: cache.errors[key], retry: () => { delete cache.errors[key]; env.paint?.(); } };
}
export function taskGroupRecord(env, taskId, ready) {
  const cache = cacheOf(env), key = 'task:' + taskId;
  load(env, key, 'records?' + new URLSearchParams({ session_id: env.session_id || '', task_ids: taskId }), (c, data) => {
    const group = data.groups.find(g => g.tasks.some(t => t.id === taskId));
    if (group) ready(group.group.id);
    else c.errors[key] = '任务不存在';
  });
  return cache.errors[key];
}
