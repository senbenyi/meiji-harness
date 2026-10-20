const statuses = { queued: '排队中', running: '执行中', completed: '已完成', rejected: '未通过', failed: '失败', cancelled: '已取消', ready: '待执行', done: '已完成', skipped: '已跳过' };
const asText = value => typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
import { styles } from './styles.js';

/** source 提供 history(filter)、detail(groupId) 及可选 subscribe；不绑定 URL 或业务项目。 */
export function createTaskHistory({ source, nodeTypes = [], title = '任务历史', onBack, copyText,
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
      node.disabled = true;
      try { await write(read()); node.textContent = '已复制'; notice.textContent = `${label}已复制`; }
      catch { node.textContent = '复制失败，重试'; notice.textContent = `${label}复制失败，请重试`; }
      finally { node.disabled = false; }
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
  const header = (label, back) => {
    const node = element('header', '', 'task-history-header');
    if (back) node.append(button('← 返回', back));
    node.append(element('h2', label)); page.replaceChildren(node, notice); notice.textContent = '';
  };
  const metadata = value => {
    const node = element('details', '', 'metadata muted');
    node.append(element('summary', '业务附加信息'), element('pre', asText(value))); return node;
  };
  const showGroup = groupId => {
    state.groupId = groupId; state.taskId = null; state.stepId = null; state.record = null; loadedGroup = null; return refresh();
  };
  const showList = () => { state.groupId = null; state.taskId = null; state.stepId = null; state.record = null; loadedGroup = null; return refresh(); };
  const groupBack = () => { state.stepId = null; state.record = null; return refresh(); };
  const stepBack = () => { state.record = null; if (recordParent === 'group') state.stepId = null; return refresh(); };
  const showStep = stepId => { state.stepId = stepId; state.record = null; return refresh(); };
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
    page.append(filters, element('p', `${data.total} 个任务组`, 'muted'));
    const list = element('div', '', 'task-history-list');
    page.append(list);
    if (!data.groups.length) page.append(element('p', '暂无任务记录', 'muted'));
    for (const row of data.groups) {
      const node = element('article', '', 'task-history-item run-list-row'), heading = element('div', '', 'run-list-heading');
      node.tabIndex = 0; node.setAttribute('role', 'button');
      node.setAttribute('aria-label', `查看${row.group.name}组内任务步骤详情`);
      node.onclick = event => { if (!event.target.closest('button')) showGroup(row.group.id); };
      node.onkeydown = event => {
        if (event.target === node && ['Enter', ' '].includes(event.key)) { event.preventDefault(); showGroup(row.group.id); }
      };
      heading.append(button(row.group.name, () => showGroup(row.group.id), `查看任务组：${row.group.name}`), status(row.status));
      const progress = element('progress'); progress.max = row.total_tasks || 1; progress.value = row.completed_tasks;
      progress.setAttribute('aria-label', '组内任务进度');
      const current = row.tasks.find(t => t.task_status === 'running') || row.tasks.find(t => t.task_status === 'queued');
      node.append(heading, identity('任务组', row.group.id), element('p', `${sourceName(row.group.source)} · ${row.group.created_at || ''}`, 'meta'),
        element('p', `任务完成 ${row.completed_tasks}/${row.total_tasks}${current ? ` · 当前：${taskName(current)}` : ''}`, 'meta'),
        element('p', row.reason || '', 'error'), progress);
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
    const actions = element('div', '', 'run-record-links');
    actions.append(button('查看步骤', () => showStep(step.id), `查看步骤：${step.name}`));
    body.append(actions); node.append(summary, body); return node;
  }
  function renderDetail(data) {
    const step = state.stepId && data.steps.find(row => row.id === state.stepId);
    if (state.stepId && !step) throw new Error('步骤不存在');
    if (state.record) return renderRecord(step);
    if (step) {
      const task = data.tasks.find(t => t.id === step.task_id), verdict = diagnosis(step, task);
      header(`${taskName(task)} · 第 ${step.seq} 步 ${stepName(step, task)}`, groupBack);
      page.append(identity('步骤', step.id), status(verdict.rejected ? 'rejected' : step.step_status), element('p', `${step.started_at || '未开始'} → ${step.ended_at || '未结束'}`, 'muted'));
      if (verdict.reason) page.append(reasonBlock(reasonText(verdict.rejected ? '未通过原因' : step.step_status === 'failed' ? '失败原因' : '原因', verdict.reason, verdict.type)));
      page.append(card('步骤结果', step.result), metadata(step.metadata));
      page.append(recordLinks(step)); return;
    }
    header('任务组详情', showList);
    const groupHead = element('div', '', 'run-group-head run-list-heading');
    groupHead.append(element('strong', data.group.name), status(data.status));
    page.append(groupHead, identity('任务组', data.group.id), element('p', `任务完成 ${data.completed_tasks}/${data.total_tasks}`, 'meta'), metadata(data.group.metadata));
    for (const task of data.tasks) {
      const node = element('section'), row = element('div', '', 'run-task-head run-list-heading');
      row.dataset.taskId = task.id; row.classList.toggle('is-target', state.taskId === task.id);
      row.append(element('h3', `${task.group_seq}. ${taskName(task)}`), status(task.task_status));
      node.append(row, identity('任务', task.id), element('p', `${sourceName(task.source)} · ${task.created_at || ''}`, 'meta'));
      if (task.end_reason) {
        const latestReview = data.steps.filter(st => st.task_id === task.id && st.kind === 'review' && diagnosis(st, task).type).sort((a, b) => b.seq - a.seq)[0];
        node.append(reasonBlock(reasonText(task.task_status === 'failed' ? '失败原因' : task.task_status === 'rejected' ? '未通过原因' : '原因', task.end_reason,
          task.task_status === 'rejected' && latestReview ? diagnosis(latestReview, task).type : '')));
      }
      const list = element('ol', '', 'run-step-list');
      for (const step of data.steps.filter(st => st.task_id === task.id).sort((a, b) => a.seq - b.seq)) list.append(stepCard(step, task));
      node.append(list, metadata(task.metadata));
      page.append(node);
    }
    root.querySelector('.is-target')?.scrollIntoView?.({ block: 'nearest' });
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
    const transfers = step.http || [];
    if (!transfers.length) return records.append(element('p', '此步骤没有已保存的 HTTP 记录', 'muted'));
    state.httpIndex = Math.min(state.httpIndex, transfers.length - 1);
    const choose = element('div', '', 'run-record-tabs'); choose.setAttribute('role', 'tablist'); choose.setAttribute('aria-label', '选择请求次数');
    if (transfers.length > 1) transfers.forEach((transfer, index) => {
      const tab = button(`第 ${index + 1} 次 · ${transfer.method || ''} ${transfer.path || ''}`.trim(), () => { state.httpIndex = index; refresh(); });
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(state.httpIndex === index)); choose.append(tab);
    });
    if (transfers.length > 1) records.append(choose);
    const transfer = transfers[state.httpIndex];
    records.append(identity('HTTP', transfer.id));
    if (transfer.prompt_id) records.append(element('p', `关联提示词 ID：${transfer.prompt_id}`, 'muted'));
    const tabs = element('div', '', 'run-record-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'HTTP 请求与返回');
    for (const [key, title] of [['request', '请求'], ['response', '返回']]) {
      const tab = button(title, () => { state.httpTab = key; refresh(); }); tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(state.httpTab === key)); tabs.append(tab);
    }
    records.append(tabs);
    const { request, id, prompt_id, ...response } = transfer;
    const responded = ['ok', 'status', 'body', 'error', 'bytes'].some(key => Object.hasOwn(response, key));
    records.append(state.httpTab === 'request' ? card('请求', request ?? null)
      : responded ? card('返回', response) : element('p', '尚未返回', 'muted'));
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
      const filter = { status: state.status, node_type: state.node_type, offset: state.offset, limit: pageSize };
      const key = JSON.stringify(filter);
      fallback = state.groupId ? details.get(state.groupId) : pages.get(key);
      if (!reload && fallback && !dirty.has(state.groupId)) {
        if (state.groupId) { loadedGroup = fallback; renderDetail(fallback); } else renderList(fallback);
        return;
      }
      header(state.groupId ? '任务组详情' : title, state.groupId || state.taskId ? showList : onBack);
      page.append(element('p', '正在读取…', 'muted'));
      const data = state.groupId ? await source.detail(state.groupId)
        : await source.history(filter);
      if (disposed || token !== epoch) return;
      if (!data) throw new Error('任务组不存在');
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
    if (disposed) return; disposed = true; epoch++; unsubscribe?.(); host.remove();
  } };
}
