import { element } from './panel-dom.js'
import { renderSteps, taskStatusLabels, targetLabel, skillsLine } from './task-nodes.js'
import { outlineText } from '../shared/story-outline.js'
const time = value => value ? new Date(value).toLocaleString() : '—'

export function renderTaskDetails(task, { loadPrompts, loadArtifact, stop, openOperation, focusFailure = false } = {}) {
  const view = element('article', '', 'task-detail')
  const head = element('div', '', 'task-history-row')
  head.append(element('strong', task.label || task.type), element('span', taskStatusLabels[task.status] || task.status, `task-history-status is-${task.status}`))
  if (openOperation && task.operationId) { const button = element('button', '所属操作'); button.onclick = () => openOperation(task.operationId); head.append(button) }
  if (stop && ['queued', 'running'].includes(task.status)) { const button = element('button', '停止', 'task-history-stop'); button.onclick = () => stop(task); head.append(button) }
  head.append(element('span', task.actor === 'human' ? '人工操作' : '模型任务', 'meta'))
  view.append(head, element('p', `任务编号：${task.id}`, 'meta'), element('p', `开始：${time(task.startedAt)}　结束：${time(task.endedAt)}`, 'meta'))
  if (task.opinion) view.append(element('p', `修改意见：${task.opinion}`))
  if (task.requirements) view.append(element('p', `生成要求：${task.requirements}`))
  if (task.error && !task.nodes?.some(node => node.error === task.error || node.reasons?.includes(task.error))) view.append(element('p', task.error, 'error'))
  const skills = skillsLine(task.skills); if (skills) view.append(skills)
  if (task.queuePosition) view.append(element('p', `排队第 ${task.queuePosition} 位`, 'meta'))
  const nodes = renderSteps(task.nodes, { live: ['queued', 'running'].includes(task.status), loadPrompts: loadPrompts && (node => loadPrompts(task, node)) })
  view.append(nodes)
  for (const output of task.artifacts || []) {
    const snapshot = element('details', '', 'task-history-snapshot')
    snapshot.dataset.artifactId = output.artifactId
    snapshot.append(element('summary', `${output.target === 'seconds-response' ? '每秒指令原始响应' : targetLabel(output.target)} · V${output.version} · 内容快照`))
    const content = element('pre'); snapshot.append(content)
    let loaded = false
    snapshot.ontoggle = async () => {
      if (!snapshot.open || loaded) return
      content.textContent = '加载中…'
      try { const result = await loadArtifact(output.artifactId); const data = result.artifact.content
        content.textContent = output.target === 'outline' && data && typeof data === 'object' ? outlineText(data) : typeof data === 'string' ? data : JSON.stringify(data, null, 2)
        loaded = true
      } catch (error) { content.textContent = error.message }
    }
    view.append(snapshot)
  }
  if (focusFailure) queueMicrotask(() => {
    const failed = [...view.querySelectorAll('.task-step')].reverse().find(node => node.classList.contains('is-failed') || node.querySelector('.is-fail'))
    failed?.scrollIntoView?.({ block: 'center' })
  })
  return view
}

export function renderOperationDetails(operation, options = {}) {
  if (operation.tasks.length === 1) return renderTaskDetails({ ...operation.tasks[0], queuePosition: operation.queuePosition }, options)
  const view = element('article', '', 'operation-detail')
  const head = element('div', '', 'task-history-row')
  head.append(element('strong', operation.label || operation.action), element('span', taskStatusLabels[operation.status] || operation.status, `task-history-status is-${operation.status}`))
  view.append(head, element('p', `操作编号：${operation.id}`, 'meta'))
  if (options.stop && ['queued', 'running'].includes(operation.status)) { const button = element('button', '停止操作'); button.onclick = () => options.stop(operation); head.append(button) }
  for (const task of operation.tasks) view.append(renderTaskDetails(task, options))
  return view
}

export function renderExecutionDetail({ load, back, title = '任务详情', ...options }) {
  const view = element('section', '', 'task-history-page')
  const header = element('div', '', 'task-history-header'), backButton = element('button', '← 返回')
  backButton.onclick = back; header.append(backButton, element('h2', title))
  const body = element('div'); view.append(header, body)
  let requestId = 0
  view.refresh = async () => {
    const id = ++requestId
    try { const result = await load(); if (id !== requestId) return
      const expanded = new Set([...body.querySelectorAll('details[data-artifact-id][open]')].map(item => item.dataset.artifactId))
      body.replaceChildren(result.operation ? renderOperationDetails(result.operation, options) : renderTaskDetails(result.task, options))
      for (const item of body.querySelectorAll('details[data-artifact-id]')) if (expanded.has(item.dataset.artifactId)) item.open = true
    } catch (error) { if (id === requestId) body.replaceChildren(element('p', error.message, 'error')) }
  }
  void view.refresh()
  return view
}
