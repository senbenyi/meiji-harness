import { styles } from './styles.js';
const asText = value => typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);

/** 直接渲染到调用方容器；返回销毁函数。不绑定task、项目或URL。 */
export function renderHttpDetails(container, { transfers = [], document = container.ownerDocument, copyText, onNotify,
  initialIndex = 0, initialTab = 'request', onChange, emptyText = '此步骤没有已保存的 HTTP 记录' } = {}) {
  let index = Math.max(0, Math.min(initialIndex, transfers.length - 1)), tab = initialTab, disposed = false;
  const el = (tag, text = '', cls = '') => { const node = document.createElement(tag); node.textContent = text; node.className = cls; return node; };
  const button = (label, action) => { const node = el('button', label); node.type = 'button'; node.onclick = action; return node; };
  const copy = (label, read) => {
    const node = button('复制', async () => {
      try { await (copyText ?? (text => document.defaultView.navigator.clipboard.writeText(text)))(read()); if (!disposed) onNotify?.(`${label}已复制`, { kind: 'success' }); }
      catch { if (!disposed) onNotify?.(`${label}复制失败，请重试`, { kind: 'error' }); }
    });
    node.className = 'copy'; node.setAttribute('aria-label', `复制${label}`); return node;
  };
  const paint = () => {
    container.replaceChildren();
    if (!transfers.length) { container.append(el('p', emptyText, 'muted')); return; }
    const transfer = transfers[index];
    const choose = el('div', '', 'run-record-tabs'); choose.setAttribute('role', 'tablist'); choose.setAttribute('aria-label', '选择请求次数');
    if (transfers.length > 1) {
      transfers.forEach((row, i) => { const control = button(`第 ${i + 1} 次 · ${row.method || ''} ${row.path || ''}`.trim(), () => { index = i; paint(); onChange?.({ index, tab }); }); control.setAttribute('role', 'tab'); control.setAttribute('aria-selected', String(i === index)); choose.append(control); });
      container.append(choose);
    }
    const identity = el('div', '', 'meta run-id-row'); identity.dataset.recordId = transfer.id;
    const control = copy('HTTP ID', () => transfer.id); control.classList.add('run-id-copy');
    identity.append(el('span', 'HTTP ID：'), el('code', transfer.id), control); container.append(identity);
    if (transfer.prompt_id) container.append(el('p', `关联提示词 ID：${transfer.prompt_id}`, 'muted'));
    const tabs = el('div', '', 'run-record-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'HTTP 请求与返回');
    for (const [key, label] of [['request', '请求'], ['response', '返回']]) {
      const control = button(label, () => { tab = key; paint(); onChange?.({ index, tab }); }); control.setAttribute('role', 'tab'); control.setAttribute('aria-selected', String(tab === key)); tabs.append(control);
    }
    container.append(tabs);
    const persisted = Object.hasOwn(transfer, 'returned_at');
    const { request, id, prompt_id, ...response } = transfer;
    const responded = persisted ? transfer.returned_at !== null : ['ok', 'status', 'body', 'error', 'bytes'].some(key => Object.hasOwn(response, key));
    const value = tab === 'request' ? request ?? (persisted ? { method: transfer.method, path: transfer.path, headers: transfer.headers, body: transfer.params } : null)
      : persisted ? { status: transfer.status, ok: transfer.ok, body: transfer.response, error: transfer.error } : response;
    if (tab === 'response' && !responded) { container.append(el('p', '尚未返回', 'muted')); return; }
    const label = tab === 'request' ? '请求' : '返回', card = el('section', '', 'run-record-card'), head = el('div', '', 'run-record-head');
    head.append(el('h4', label), copy(label, () => asText(value))); card.append(head, el('pre', asText(value))); container.append(card);
  };
  paint(); return () => { disposed = true; container.replaceChildren(); };
}

/** source.list({offset,limit})返回摘要数组，source.read(id)按需读取正文。 */
export function createHttpHistory({ source, document = globalThis.document, onBack, copyText, onNotify, pageSize = 20 } = {}) {
  if (!source || typeof source.list !== 'function' || typeof source.read !== 'function') throw new TypeError('需提供 list/read 数据源');
  if (!document?.createElement) throw new TypeError('HTTP记录需要浏览器 document');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 99) throw new TypeError('pageSize需为1–99');
  const el = (tag, text = '', cls = '') => { const node = document.createElement(tag); node.textContent = text; node.className = cls; return node; };
  const button = (label, action) => { const node = el('button', label); node.type = 'button'; node.onclick = action; return node; };
  const host = el('div'), root = host.attachShadow({ mode: 'open' }), page = el('section', '', 'page'); root.append(el('style', styles), page);
  let offset = 0, selected = null, epoch = 0, disposed = false, disposeDetail;
  const header = () => {
    const head = el('header', '', 'history-heading');
    if (selected || onBack) {
      const back = button('←', selected ? () => { selected = null; void refresh(); } : onBack);
      back.className = 'history-back'; back.setAttribute('aria-label', '返回'); back.title = '返回'; head.append(back);
    }
    const reload = button('刷新', () => refresh()); reload.className = 'history-refresh';
    head.append(el('h2', selected ? 'HTTP详情' : 'HTTP记录'), reload); page.replaceChildren(head);
  };
  async function refresh() {
    if (disposed) return;
    const ticket = ++epoch; disposeDetail?.(); disposeDetail = null; header(); page.append(el('p', '正在读取…', 'muted'));
    try {
      const data = selected ? await source.read(selected) : await source.list({ offset, limit: pageSize + 1 });
      if (disposed || ticket !== epoch) return;
      header();
      if (selected) {
        if (!data) throw new Error('HTTP记录不存在');
        const body = el('div', '', 'run-record-page'); page.append(body); disposeDetail = renderHttpDetails(body, { transfers: [data], document, copyText, onNotify }); return;
      }
      if (!Array.isArray(data)) throw new TypeError('HTTP列表需返回数组');
      if (!data.length) page.append(el('p', '暂无HTTP记录', 'muted'));
      const list = el('div', '', 'http-list'); page.append(list);
      for (const row of data.slice(0, pageSize)) {
        const card = button('', () => { selected = row.id; void refresh(); }); card.className = 'http-record';
        const title = row.title || (row.method === 'MODEL' ? row.path : `${row.method} ${row.path}`);
        const outcome = row.status ?? (row.returned_at ? row.ok ? '已完成' : '失败 / 中断' : '等待返回');
        card.append(el('strong', title), el('span', `${outcome} · ${row.started_at}`, 'muted'), el('code', row.id), el('span', row.error || '', 'error')); list.append(card);
      }
      const actions = el('div', '', 'actions');
      if (offset) actions.append(button('上一页', () => { offset = Math.max(0, offset - pageSize); void refresh(); }));
      if (data.length > pageSize) actions.append(button('下一页', () => { offset += pageSize; void refresh(); }));
      page.append(actions);
    } catch (error) {
      if (disposed || ticket !== epoch) return;
      header(); page.append(el('p', error.message, 'error'), button('重新加载', () => refresh()));
    }
  }
  const unsubscribe = source.subscribe?.(() => refresh());
  return { element: host, ready: refresh(), refresh, openRecord(id) { selected = id; return refresh(); }, dispose() { disposed = true; epoch++; disposeDetail?.(); unsubscribe?.(); host.remove(); } };
}
