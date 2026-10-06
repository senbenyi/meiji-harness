import { element } from './panel-dom.js'
import { targetLabel } from './run-labels.js'
import { runStatusLabels, runInScope, runTargetMatches, orderRuns, runGoalLabel, runEpisodeLabel } from '../shared/run-view.js'
const time = value => value ? new Date(value).toLocaleString() : '—'

export function renderRunList(project, { load, open, back, episodeId = '', target = '' }) {
  const view = element('section', '', 'task-history-page run-list-page')
  const head = element('div', '', 'task-history-header'), returnButton = element('button', '← 返回'), refresh = element('button', '刷新')
  returnButton.onclick = back; head.append(returnButton, element('h2', '任务历史'), refresh)
  const scopes = element('div', '', 'tabs run-scopes'), filters = element('div', '', 'run-filters')
  function select(label, entries) {
    const node = element('select'); node.setAttribute('aria-label', label)
    for (const [value, text] of entries) { const option = element('option', text); option.value = value; node.append(option) }
    filters.append(node); return node
  }
  const status = select('按任务状态筛选', [['', '全部状态'], ...Object.entries(runStatusLabels)])
  const initiator = select('按发起方筛选', [['', '全部发起方'], ['panel', '面板'], ['session', '会话']])
  const targets = select('按对象筛选', [['', '全部对象']]); targets.value = target
  const message = element('p', '', 'meta'), list = element('div', '', 'task-history-list')
  view.append(head, scopes, filters, message, list)

  let records = [], projectEvents = [], requestId = 0, scope = episodeId, targetFilter = target
  const draw = () => {
    const choices = [['', '全部'], ['project', '项目级'], ...[...(project.episodes || [])].reverse().map((item, index) => [item.id, `第 ${index + 1} 集`])]
    scopes.replaceChildren()
    for (const [id, label] of choices) {
      const count = records.filter(run => runInScope(run, id) && ['running', 'paused'].includes(run.status)).length
      const button = element('button', `${label}${count ? `（${count}）` : ''}`)
      button.setAttribute('aria-pressed', String(id === scope)); button.onclick = () => { scope = id; draw() }; scopes.append(button)
    }
    const values = [...new Set(records.flatMap(run => run.targets || []))]
    if (target && !values.includes(target)) values.unshift(target)
    const selected = targetFilter
    targets.replaceChildren()
    for (const value of ['', ...values]) { const option = element('option', value ? targetLabel(value) : '全部对象'); option.value = value; targets.append(option) }
    targets.value = selected
    const rows = records.filter(run => runInScope(run, scope) && (!status.value || run.status === status.value) && (!initiator.value || run.initiator === initiator.value) && (!targets.value || run.targets?.some(value => runTargetMatches(value, targets.value)))).sort(orderRuns)
    message.textContent = rows.length ? `${rows.length} 条任务` : '没有符合条件的任务'
    list.replaceChildren()
    let group = null
    for (const run of rows) {
      const label = runEpisodeLabel(run, project)
      if (!scope && label !== group) { list.append(element('h3', label)); group = label }
      const row = element('article', '', 'task-history-item run-list-row'); row.dataset.runId = run.id
      const button = element('button', runGoalLabel(run, project)); button.onclick = () => open(run, targets.value)
      row.append(button, element('span', `${run.initiator === 'session' ? '会话' : '面板'} · ${runStatusLabels[run.status]} · ${run.done}/${run.total} · 待处理 ${run.pendingCount || 0}`), element('p', `开始：${time(run.startedAt || run.createdAt)}　结束：${time(run.endedAt)}`, 'meta'))
      if (scope && scope !== 'project' && run.episodeId !== scope) row.append(element('p', `由${label}任务影响`, 'meta'))
      list.append(row)
    }
    if (projectEvents.length && (!scope || scope === 'project')) {
      const events = element('details', '', 'run-project-events'); events.append(element('summary', '项目事件'))
      const labels = { 'script-edit': '编辑剧本', 'script-restore': '恢复剧本版本', 'overview': '编辑项目资料', 'episode-edit': '编辑剧集', 'episode-add': '新增剧集', 'episode-delete': '删除剧集', 'outline-text': '编辑大纲', 'character-text': '编辑人物', 'scene-text': '编辑场景', 'prop-text': '编辑道具' }
      for (const event of projectEvents) events.append(element('p', `${time(event.at)} · ${labels[event.type] || event.type}${event.runId ? ' · 已记入制作任务' : ''}`, 'meta'))
      list.append(events)
    }
  }
  status.onchange = initiator.onchange = draw
  targets.onchange = () => { targetFilter = targets.value; draw() }
  view.refresh = async () => { const id = ++requestId; refresh.disabled = true
    try { const result = await load(); if (id !== requestId) return; records = result.runs || []; projectEvents = result.events || []; draw() }
    catch (error) { if (id === requestId) message.textContent = `加载失败：${error.message}。点击刷新重试。` }
    finally { if (id === requestId) refresh.disabled = false }
  }
  refresh.onclick = view.refresh; void view.refresh(); return view
}
