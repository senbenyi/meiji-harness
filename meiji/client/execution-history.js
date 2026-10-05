import { element } from './panel-dom.js'
import { renderOperationDetails, renderTaskDetails } from './task-detail.js'
import { taskStatusLabels } from './task-nodes.js'
export const historyScopes = { summary: ['摘要', ['summary']], script: ['剧情', ['outline', 'characters', 'scenes', 'props']], outline: ['大纲', ['outline']], characters: ['人物角色', ['characters']], scenes: ['场景', ['scenes']], props: ['道具', ['props']], shots: ['镜头表', ['shots']], seconds: ['每秒指令', ['seconds:*']], film: ['成片', ['storyboard:*', 'film:*']], assembly: ['合成', ['assembly']], images: ['图片', ['image:*']] }
historyScopes['project-summary'] = ['项目摘要', ['project-summary']]
export function historyTargets(scope = '') {
  if (scope.includes(',')) return scope.split(',')
  const [kind, id] = scope.split(':')
  if (id) return kind === 'film' ? [`storyboard:${id}`, `film:${id}`] : [scope]
  return historyScopes[kind]?.[1] || []
}
export function historyEntry(project, actions, scope = '') {
  const label = historyScopes[scope.split(':')[0]]?.[0]
  const button = element('button', scope.includes(':') || scope.includes(',') ? '历史' : label ? `查看${label}任务历史 →` : '查看任务历史 →', 'task-history-entry')
  button.type = 'button'; button.onclick = () => actions.openHistory(project, scope)
  return button
}
export { skillsLine } from './task-nodes.js'
export function renderTaskHistory(project, { load, loadPrompts, loadResponses, loadArtifact, back, historyScope = '', openOperation, stop }) {
  const view = element('section', '', 'task-history-page')
  const header = element('div', '', 'task-history-header'), backButton = element('button', '← 返回'), refresh = element('button', '刷新')
  backButton.type = refresh.type = 'button'; backButton.onclick = back; header.append(backButton, element('h2', `${historyScope.includes(':') ? historyScope.split(':')[1] + ' · ' : ''}${historyScopes[historyScope.split(':')[0]]?.[0] || '内容'}任务历史`), refresh)
  const filter = element('select'); filter.setAttribute('aria-label', '按任务状态筛选')
  for (const [value, label] of [['', '全部状态'], ...Object.entries(taskStatusLabels)]) { const option = element('option', label); option.value = value; filter.append(option) }
  const message = element('p', '', 'meta'), list = element('div', '', 'task-history-list')
  view.append(header, element('p', `${project.title || '项目'} · ${project.episodeId ? '本集' : '全部剧集'}`, 'meta'), filter, message, list)
  let records = [], tasksOnly = false, requestId = 0
  const draw = () => {
    const expanded = new Set([...list.querySelectorAll('details[data-task-id][open]')].map(item => item.dataset.taskId))
    const snapshots = new Set([...list.querySelectorAll('details[data-artifact-id][open]')].map(item => item.dataset.artifactId))
    const selected = records.filter(item => !filter.value || item.status === filter.value)
    list.replaceChildren(); message.textContent = selected.length ? `${selected.length} 条记录` : records.length ? '没有符合条件的任务' : '暂无任务历史'
    for (const record of selected) {
      const item = element('details', '', 'task-history-item'), row = element('summary', '', 'task-history-row')
      item.dataset.taskId = record.id; item.open = expanded.has(record.id)
      row.append(element('strong', record.label || record.type || record.action), element('span', taskStatusLabels[record.status] || record.status), element('span', new Date(record.startedAt).toLocaleString(), 'meta'))
      const options = { loadPrompts, loadResponses, loadArtifact: loadArtifact || load, openOperation, stop }
      item.append(row, tasksOnly ? renderTaskDetails(record, options) : renderOperationDetails(record, options)); list.append(item)
    }
    for (const snapshot of list.querySelectorAll('details[data-artifact-id]')) if (snapshots.has(snapshot.dataset.artifactId)) snapshot.open = true
  }
  filter.onchange = draw
  view.refresh = async () => { const id = ++requestId; refresh.disabled = true
    try { const result = await load(); if (id !== requestId) return; tasksOnly = Boolean(result.tasks); records = result.operations || result.tasks || []; draw() }
    catch (error) { if (id === requestId) message.textContent = `加载失败：${error.message}。点击刷新重试。` }
    finally { if (id === requestId) refresh.disabled = false }
  }
  refresh.onclick = view.refresh; void view.refresh(); return view
}
