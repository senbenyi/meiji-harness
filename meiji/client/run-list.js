import { element } from './panel-dom.js'
import { targetLabel } from './run-labels.js'
import { runStatusLabels, runInScope, runTargetMatches, runGoalLabel } from '../shared/run-view.js'
const time = value => value ? new Date(value).toLocaleString() : '—'
const orderByTime = (a, b) => String(b.createdAt || b.startedAt || '').localeCompare(String(a.createdAt || a.startedAt || ''))

export function renderRunList(project, { load, open, back, episodeId = '', target = '' }) {
  const view = element('section', '', 'task-history-page run-list-page')
  const head = element('div', '', 'task-history-header'), returnButton = element('button', '← 返回'), filters = element('div', '', 'run-filters')
  returnButton.onclick = back; head.append(returnButton, element('h2', project.title || project.name || '任务历史'))
  function select(label, entries) {
    const node = element('select'); node.setAttribute('aria-label', label)
    for (const [value, text] of entries) { const option = element('option', text); option.value = value; node.append(option) }
    filters.append(node); return node
  }
  const status = select('按任务状态筛选', [['', '全部状态'], ...Object.entries(runStatusLabels)])
  const targets = select('按对象筛选', [['', '全部对象']]); targets.value = target
  const episodes = select('按选集筛选', [['', '全部选集'], ...[...(project.episodes || [])].reverse().map((item, index) => [item.id, `第 ${index + 1} 集`])])
  episodes.value = episodeId
  const message = element('p', '', 'meta'), list = element('div', '', 'task-history-list')
  view.append(head, filters, message, list)

  let records = [], requestId = 0, scope = episodeId, targetFilter = target
  const draw = () => {
    const values = [...new Set(records.flatMap(run => run.targets || []))]
    if (target && !values.includes(target)) values.unshift(target)
    const selected = targetFilter
    targets.replaceChildren()
    for (const value of ['', ...values]) { const option = element('option', value ? targetLabel(value) : '全部对象'); option.value = value; targets.append(option) }
    targets.value = selected
    const rows = records.filter(run => runInScope(run, scope) && (!status.value || run.status === status.value) && (!targets.value || run.targets?.some(value => runTargetMatches(value, targets.value)))).sort(orderByTime)
    message.textContent = rows.length ? `${rows.length} 条任务` : '没有符合条件的任务'
    list.replaceChildren()
    for (const run of rows) {
      const row = element('article', '', 'task-history-item run-list-row'); row.dataset.runId = run.id; row.tabIndex = 0; row.setAttribute('role', 'link')
      const heading = element('div', '', 'run-list-heading')
      heading.append(element('strong', runGoalLabel(run, project)), element('span', runStatusLabels[run.status] || run.status, `task-history-status is-${run.status}`))
      row.append(heading, element('p', `${run.initiator === 'session' ? '会话发起' : '面板发起'} · ${run.done}/${run.total} · 待处理 ${run.pendingCount || 0}`, 'meta'), element('p', `开始：${time(run.startedAt || run.createdAt)}　结束：${time(run.endedAt)}`, 'meta'))
      const enter = () => open(run, targets.value)
      row.onclick = enter
      row.onkeydown = event => { if (event.key === 'Enter' && event.target === row) enter() }
      list.append(row)
    }
  }
  status.onchange = episodes.onchange = () => { scope = episodes.value; draw() }
  targets.onchange = () => { targetFilter = targets.value; draw() }
  view.refresh = async () => { const id = ++requestId
    try { const result = await load(); if (id !== requestId) return; records = result.runs || []; draw() }
    catch (error) { if (id === requestId) message.textContent = `加载失败：${error.message}。点击刷新重试。` }
  }
  void view.refresh(); return view
}
