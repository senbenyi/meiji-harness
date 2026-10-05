import { element } from './panel-dom.js'
import { renderOperationDetails } from './task-detail.js'
import { tickElapsed } from './task-nodes.js'
export function renderCurrentTasks(project, { load, loadPrompts, loadResponses, loadArtifact, stop, back, openHistory, openOperation }) {
  const view = element('section', '', 'task-history-page current-task-page'), header = element('div', '', 'task-history-header')
  const backButton = element('button', '← 返回'), history = element('button', '查看任务历史 →'), refresh = element('button', '刷新')
  backButton.onclick = back; history.onclick = openHistory
  header.append(backButton, element('h2', '当前任务'), history, refresh)
  const message = element('p', '', 'meta'), list = element('div', '', 'task-history-list'); view.append(header, element('p', `${project.title || '项目'} · ${project.episodeNumber ? `第 ${project.episodeNumber} 集` : '全部剧集'}`, 'meta'), message, list)
  let requestId = 0
  view.refresh = async () => { const id = ++requestId; refresh.disabled = true
    try { const result = await load(); if (id !== requestId) return; list.replaceChildren(); message.textContent = result.operations.length ? '' : '当前没有进行中或排队中的任务'
      for (const operation of result.operations) { const detail = renderOperationDetails(operation, { loadPrompts, loadResponses, loadArtifact, stop, openOperation }); detail.classList.add('task-history-item', 'current-task'); list.append(detail) }
    } catch (error) { if (id === requestId) message.textContent = error.message }
    finally { if (id === requestId) refresh.disabled = false }
  }
  refresh.onclick = view.refresh
  const timer = setInterval(() => { if (view.isConnected) tickElapsed(view); else clearInterval(timer) }, 1000)
  void view.refresh(); return view
}
