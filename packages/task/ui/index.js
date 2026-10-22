import { renderHttpDetails } from '@agent-modules/http-client/ui';
const statuses = { queued: '排队中', running: '执行中', completed: '已完成', rejected: '未通过', failed: '失败', cancelled: '已取消', ready: '待执行', done: '已完成', skipped: '已跳过' };
const asText = value => typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
import { styles } from './styles.js';

/** source 提供 history(filter)、detail(groupId) 及可选 subscribe；不绑定 URL 或业务项目。
 * presentation.inputDependencies/taskOutput(task, steps) 从本任务历史投影输入/交付结果，返回JSON数据。 */
export function createTaskHistory({ source, nodeTypes = [], title = '任务历史', onBack, copyText, onNotify,
  document = globalThis.document, pageSize = 20, initialView = {}, presentation = {} } = {}) {
  if (!source || typeof source.history !== 'function' || typeof source.detail !== 'function') throw new TypeError('需提供 history/detail 数据源');
  if (!document?.createElement) throw new TypeError('任务历史需要浏览器 document');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) throw new TypeError('pageSize 需为 1–200');
  const element = (tag, text = '', className) => {
    const node = document.createElement(tag); node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (label, action, ariaLabel) => {
    const node = element('button', label); node.type = 'button'; node.onclick = action;
    if (ariaLabel) node.setAttribute('aria-label', ariaLabel);
    return node;
  };
  const host = element('div'), root = host.attachShadow({ mode: 'open' });
  const page = element('section', '', 'page'), notice = element('p', '', 'notice muted');
  notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  root.append(element('style', styles), page);
  const state = { status: '', node_type: '', offset: 0, groupId: null, taskId: null, stepId: null, record: null, httpIndex: 0, httpTab: 'request', ...initialView };
  const expanded = new Map(), pages = new Map(), details = new Map(), dirty = new Set();
  let disposeHttp;
  let epoch = 0, disposed = false, loadedGroup = null, recordParent = state.stepId && !state.record ? 'step' : 'group';
  const taskName = task => presentation.taskName?.(task) ?? task.name;
  const stepName = (step, task) => presentation.stepName?.(step, task) ?? step.name;
  const sourceName = value => presentation.sourceLabel?.(value) ?? ({ session: '会话发起', panel: '面板发起', api: 'API 发起' }[value] || value);
  const diagnosis = (step, task) => {
    const value = presentation.review?.(step, task) || {};
    return { rejected: step.step_status === 'rejected' || value.rejected === true, reason: step.error_reason || value.reason || '', type: value.type || '' };
  };
  const reasonText = (label, reason, type = '') => `${label}${type ? `（${type}）` : ''}：${reason}`;
  const write = copyText ?? (text => document.defaultView.navigator.clipboard.writeText(text));
  const copy = (label, read) => {
    const node = button('复制', async event => {
      event.stopPropagation();
      try { await write(read()); onNotify?.(`${label}已复制`, { kind: 'success' }); }
      catch { onNotify?.(`${label}复制失败，请重试`, { kind: 'error' }); }
    }, `复制${label}`);
    node.className = 'copy'; return node;
  };
  const identity = (label, id) => {
    const row = element('div', '', 'meta run-id-row'); row.dataset.recordId = id;
    const control = copy(`${label} ID`, () => id); control.classList.add('run-id-copy');
    row.append(element('span', `${label} ID：`), element('code', id), control); return row;
  };
  const status = value => element('span', statuses[value] || value, `task-history-status is-${value}`);
  const card = (label, value) => {
    const node = element('section', '', 'run-record-card'), row = element('div', '', 'run-record-head');
    row.append(element('h4', label), copy(label, () => asText(value)));
    node.append(row, element('pre', asText(value))); return node;
  };
  const header = (label, back, taskStatus) => {
    disposeHttp?.(); disposeHttp = null;
    const node = element('header', '', 'task-history-header');
    if (back) {
      const control = button('←', back, '返回'); control.className = 'task-history-back'; control.title = '返回'; node.append(control);
    }
    const heading = element('h2', label); heading.title = label;
    const reload = button('刷新', () => refresh({ reload: true })); reload.className = 'task-history-refresh';
    node.append(heading); if (taskStatus) node.append(status(taskStatus)); node.append(reload); page.replaceChildren(node, notice); notice.textContent = '';
  };
  const metadata = (value, label = '任务执行信息') => {
    const node = element('details', '', 'metadata muted');
    node.append(element('summary', label), element('pre', asText(value))); return node;
  };
  const jsonRecord = (label, value, className, open = false) => {
    const node = element('details', '', `metadata muted ${className}`);
    const heading = element('summary', '', 'run-record-head');
    heading.append(element('span', label), copy(label, () => JSON.stringify(value, null, 2)));
    node.open = open;
    node.append(heading, element('pre', JSON.stringify(value, null, 2)));
    return node;
  };
  const showGroup = (groupId, taskId = null) => {
    state.groupId = groupId; state.taskId = taskId; state.stepId = null; state.record = null; loadedGroup = null; return refresh();
  };
  const showList = () => { state.groupId = null; state.taskId = null; state.stepId = null; state.record = null; loadedGroup = null; return refresh(); };
  const groupBack = () => { state.stepId = null; state.record = null; return refresh(); };
  const stepBack = () => { state.record = null; if (recordParent === 'group') state.stepId = null; return refresh(); };
  const showRecord = (stepId, kind) => { recordParent = state.stepId ? 'step' : 'group'; state.stepId = stepId; state.record = kind; state.httpIndex = 0; state.httpTab = 'request'; return refresh(); };
  const reasonBlock = value => {
    const block = element('div', '', 'run-step-error');
    const control = copy('原因', () => value); control.textContent = '复制原因';
    block.append(element('p', value, 'error'), control); return block;
  };

  function renderList(data) {
    header(title, onBack);
    const filters = element('div', '', 'filters');
    const filter = (key, label, entries) => {
      const wrap = element('label'), select = element('select');
      select.setAttribute('aria-label', label);
      for (const [value, name] of entries) { const option = element('option', name); option.value = value; select.append(option); }
      select.value = state[key];
      select.onchange = () => { state[key] = select.value; state.offset = 0; refresh(); };
      wrap.append(element('span', label), select); filters.append(wrap);
    };
    filter('node_type', '节点类型', [['', '全部节点类型'], ...nodeTypes.map(node => [node.type, node.label])]);
    filter('status', '任务状态', [['', '全部状态'], ...['queued', 'running', 'completed', 'rejected', 'failed', 'cancelled'].map(key => [key, statuses[key]])]);
    page.append(filters, element('p', `${data.total} 个任务`, 'muted'));
    const list = element('div', '', 'task-history-list');
    page.append(list);
    if (!data.tasks.length) page.append(element('p', '暂无任务记录', 'muted'));
    for (const task of data.tasks) {
      const node = element('article', '', 'task-history-item run-list-row'), heading = element('div', '', 'run-list-heading');
      const open = () => showGroup(task.group_id, task.id);
      node.tabIndex = 0; node.setAttribute('role', 'button');
      node.setAttribute('aria-label', `查看任务：${taskName(task)}`);
      node.onclick = event => { if (!event.target.closest('button')) open(); };
      node.onkeydown = event => {
        if (event.target === node && ['Enter', ' '].includes(event.key)) { event.preventDefault(); open(); }
      };
      heading.append(button(taskName(task), open, `打开任务：${taskName(task)}`), status(task.task_status));
      const type = nodeTypes.find(node => node.type === task.node_type)?.label || task.node_type;
      node.append(heading, identity('任务', task.id), element('p', `类型：${type}`, 'meta'),
        element('p', `${sourceName(task.source)} · ${task.created_at || ''}`, 'meta'), element('p', task.end_reason || '', 'error'));
      list.append(node);
    }
    const paging = element('div', '', 'actions');
    if (data.offset > 0) paging.append(button('上一页', () => { state.offset = Math.max(0, state.offset - pageSize); refresh(); }));
    if (data.offset + data.limit < data.total) paging.append(button('下一页', () => { state.offset += pageSize; refresh(); }));
    page.append(paging);
  }
  function recordLinks(step) {
    const actions = element('div', '', 'run-record-links');
    if (step.executor === 'ai' && (step.has_prompt || step.prompt != null)) actions.append(button('查看提示词', () => showRecord(step.id, 'prompt')));
    actions.append(button('查看 HTTP', () => showRecord(step.id, 'http')));
    return actions;
  }
  function stepCard(step, task) {
    const verdict = diagnosis(step, task);
    const node = element('li', '', 'run-step-card');
    node.dataset.stepId = step.id; node.dataset.stepNumber = String(step.seq);
    node.classList.toggle('is-failed', verdict.rejected || step.step_status === 'failed');
    node.classList.toggle('is-expanded', expanded.get(step.id) || false);
    const summary = element('div', '', 'run-step-summary'), row = element('div', '', 'run-step-heading');
    const toggle = button(expanded.get(step.id) ? '收起' : '展开', event => {
      event.preventDefault();
      const open = !expanded.get(step.id); expanded.set(step.id, open);
      node.classList.toggle('is-expanded', open); toggle.textContent = open ? '收起' : '展开';
      toggle.setAttribute('aria-expanded', String(open));
    });
    toggle.className = 'run-step-toggle'; toggle.setAttribute('aria-expanded', String(expanded.get(step.id) || false));
    const body = element('div', '', 'run-step-detail');
    body.id = `step-detail-${step.id}`; toggle.setAttribute('aria-controls', body.id);
    row.append(element('strong', `${step.seq}. ${stepName(step, task)}`),
      element('span', step.executor === 'ai' ? 'AI' : '程序', `run-step-executor is-${step.executor}`),
      status(verdict.rejected ? 'rejected' : step.step_status), toggle);
    summary.append(row, identity('步骤', step.id));
    if (verdict.reason) body.append(reasonBlock(reasonText(verdict.rejected ? '未通过原因' : step.step_status === 'failed' ? '失败原因' : '原因', verdict.reason, verdict.type)));
    body.append(element('p', `${step.started_at || '未开始'} → ${step.ended_at || '未结束'}`, 'meta run-step-time'));
    const result = card('步骤结果', step.result); result.classList.add('run-step-result');
    result.querySelector('button').textContent = '复制结果';
    body.append(result, recordLinks(step));
    node.append(summary, body); return node;
  }
  function inputDependencies(task, steps) {
    const value = presentation.inputDependencies?.(task, steps) ?? task.metadata?.input_dependencies
      ?? steps.find(step => step.prompt?.input != null)?.prompt.input ?? null;
    return jsonRecord('输入依赖', value, 'run-input-dependencies');
  }
  function renderDetail(data) {
    const step = state.stepId && data.steps.find(row => row.id === state.stepId);
    if (state.stepId && !step) throw new Error('步骤不存在');
    if (step) {
      if (state.taskId && state.taskId !== step.task_id) throw new Error('步骤不属于当前任务');
      state.taskId = step.task_id;
    }
    if (state.record) return renderRecord(step);
    if (step) {
      const task = data.tasks.find(t => t.id === step.task_id), verdict = diagnosis(step, task);
      header(`${taskName(task)} · 第 ${step.seq} 步 ${stepName(step, task)}`, groupBack);
      page.append(identity('步骤', step.id), status(verdict.rejected ? 'rejected' : step.step_status), element('p', `${step.started_at || '未开始'} → ${step.ended_at || '未结束'}`, 'muted'));
      if (verdict.reason) page.append(reasonBlock(reasonText(verdict.rejected ? '未通过原因' : step.step_status === 'failed' ? '失败原因' : '原因', verdict.reason, verdict.type)));
      page.append(card('步骤结果', step.result), metadata(step.metadata, '步骤执行信息'));
      page.append(recordLinks(step)); return;
    }
    const task = data.tasks.find(task => task.id === state.taskId) || (!state.taskId ? data.tasks[0] : null);
    if (!task) throw new Error('任务不存在');
    state.taskId = task.id;
    header(taskName(task), showList, task.task_status);
    {
      const node = element('section', '', 'run-task-card');
      node.dataset.taskId = task.id;
      const type = nodeTypes.find(node => node.type === task.node_type)?.label || task.node_type;
      node.append(identity('任务', task.id), element('p', `类型：${type}`, 'meta'),
        element('p', `${sourceName(task.source)} · ${task.created_at || ''}`, 'meta'));
      if (task.end_reason) {
        const latestReview = data.steps.filter(st => st.task_id === task.id && st.kind === 'review' && diagnosis(st, task).type).sort((a, b) => b.seq - a.seq)[0];
        node.append(reasonBlock(reasonText(task.task_status === 'failed' ? '失败原因' : task.task_status === 'rejected' ? '未通过原因' : '原因', task.end_reason,
          task.task_status === 'rejected' && latestReview ? diagnosis(latestReview, task).type : '')));
      }
      const list = element('ol', '', 'run-step-list');
      const steps = data.steps.filter(st => st.task_id === task.id).sort((a, b) => a.seq - b.seq);
      node.append(inputDependencies(task, steps));
      for (const step of steps) list.append(stepCard(step, task));
      const output = { status: task.task_status, reason: task.end_reason || '',
        ...presentation.taskOutput?.(task, steps),
      };
      if (!Object.hasOwn(output, 'result')) output.result = null;
      node.append(list, jsonRecord('任务输出', output, 'run-task-output', true));
      page.append(node);
    }

  }
  function renderRecord(step) {
    const task = loadedGroup.tasks.find(t => t.id === step.task_id);
    header(`${taskName(task)} · 第 ${step.seq} 步 ${stepName(step, task)} · ${state.record === 'prompt' ? '提示词' : 'HTTP'}`, stepBack);
    const records = element('div', '', 'run-record-page'); page.append(records);
    records.append(identity('步骤', step.id));
    if (state.record === 'prompt') {
      if (!step.prompt || !step.prompt.messages?.length) return records.append(element('p', '此步骤没有提示词', 'muted'));
      records.append(identity('提示词', step.prompt.id), element('p', `模型：${step.prompt.model || '未指定'}`, 'muted'));
      const messages = step.prompt.messages;
      const bar = element('div', '', 'run-record-head run-record-actions');
      bar.append(element('h3', '提示词'), copy('全部提示词', () => messages.map((message, i) => `${i + 1}. ${message.role}:\n${asText(message.content)}`).join('\n\n')));
      records.append(bar);
      for (const [i, message] of messages.entries()) { const messageCard = card(`${i + 1}. ${message.role}`, message.content); messageCard.querySelector('button').remove(); records.append(messageCard); }
      return;
    }
    const body = element('div', '', 'http-details'); records.append(body);
    disposeHttp = renderHttpDetails(body, { transfers: step.http || [], document, copyText: write, onNotify,
      initialIndex: state.httpIndex, initialTab: state.httpTab,
      onChange: ({ index, tab }) => { state.httpIndex = index; state.httpTab = tab; },
    });
  }
  async function refresh({ reload = false } = {}) {
    if (disposed) return;
    const token = ++epoch;
    let fallback;
    try {
      if (state.taskId && !state.groupId) {
        header('正在定位任务', showList);
        if (typeof source.resolveTask !== 'function') throw new Error('数据源需提供 resolveTask(taskId) 以支持任务入口');
        const groupId = await source.resolveTask(state.taskId);
        if (disposed || token !== epoch) return;
        if (!groupId) throw new Error('任务不存在');
        state.groupId = groupId;
      }
      const filter = { unit: 'task', status: state.status, node_type: state.node_type, offset: state.offset, limit: pageSize };
      const key = JSON.stringify(filter);
      fallback = state.groupId ? details.get(state.groupId) : pages.get(key);
      if (!reload && fallback && !dirty.has(state.groupId)) {
        if (state.groupId) { loadedGroup = fallback; renderDetail(fallback); } else renderList(fallback);
        return;
      }
      header(state.groupId ? '任务详情' : title, state.groupId || state.taskId ? showList : onBack);
      page.append(element('p', '正在读取…', 'muted'));
      const data = state.groupId ? await source.detail(state.groupId)
        : await source.history(filter);
      if (disposed || token !== epoch) return;
      if (!data) throw new Error('任务不存在');
      if (state.groupId) { loadedGroup = data; details.set(state.groupId, data); dirty.delete(state.groupId); renderDetail(data); }
      else { pages.set(key, data); renderList(data); }
    } catch (error) {
      if (disposed || token !== epoch) return;
      if (fallback) {
        if (state.groupId) { loadedGroup = fallback; renderDetail(fallback); } else renderList(fallback);
      } else header('读取失败', state.groupId || state.taskId ? showList : onBack);
      page.append(element('p', error.message || String(error), 'error'), button('重新加载', () => refresh({ reload: true })));
    }
  }
  const unsubscribe = source.subscribe?.(() => {
    pages.clear();
    for (const [id, detail] of details) {
      if (detail.tasks.some(task => ['queued', 'running'].includes(task.task_status))) dirty.add(id);
    }
    return refresh();
  });
  const ready = refresh();
  return { element: host, ready, refresh: () => refresh({ reload: true }),
    openGroup: showGroup,
    openTask(taskId) { state.taskId = taskId; state.groupId = null; state.stepId = null; state.record = null; return refresh(); },
    dispose() {
    if (disposed) return; disposed = true; epoch++; disposeHttp?.(); unsubscribe?.(); host.remove();
  } };
}
