// 「当前任务」页：本集（或本项目）进行中与排队中的任务，显示步骤清单、当前步骤执行情况与排队位置，可停止任务。
// 数据来自 GET /plugins/meiji/tasks/current；页面由 app.js 在收到 /events 推送时调用 view.refresh() 刷新，不另行轮询。
import { element } from './dom.js'
import { renderSteps, taskStatusLabels, tickElapsed } from './task-steps.js'

const time = value => value ? new Date(value).toLocaleString() : '—'

export function renderCurrentTasks(project, { load, loadPrompts, stop, back, openHistory }) {
  const view = element('section', '', 'task-history-page current-task-page')
  const header = element('div', '', 'task-history-header')
  const backButton = element('button', '← 返回')
  backButton.type = 'button'
  backButton.onclick = back
  const refresh = element('button', '刷新')
  refresh.type = 'button'
  header.append(backButton, element('h2', '当前任务'), refresh)
  const scope = project.episodeId ? project.episodeNumber ? `第 ${project.episodeNumber} 集` : '本集' : '全部剧集'
  const message = element('p', '', 'meta')
  message.setAttribute('role', 'status')
  const list = element('div', '', 'task-history-list')
  view.append(header, element('p', `${project.title || '项目'} · ${scope}`, 'meta'), message, list)
  let requestId = 0
  const draw = tasks => {
    list.replaceChildren()
    message.textContent = tasks.length ? '' : '当前没有进行中或排队中的任务'
    if (!tasks.length && openHistory) {
      const history = element('button', '查看任务历史 →', 'task-history-entry')
      history.type = 'button'
      history.onclick = openHistory
      list.append(history)
    }
    for (const task of tasks) {
      const card = element('article', '', `task-history-item current-task is-${task.status}`)
      const row = element('div', '', 'task-history-row')
      row.append(element('strong', task.label || task.action), element('span', taskStatusLabels[task.status] || task.status, `task-history-status is-${task.status}`))
      if (task.queuePosition) row.append(element('span', `排队第 ${task.queuePosition} 位`, 'meta current-task-queue'))
      row.append(element('span', `开始 ${time(task.startedAt)}`, 'meta'))
      const stopButton = element('button', '停止', 'current-task-stop')
      stopButton.type = 'button'
      stopButton.onclick = async () => {
        stopButton.disabled = true
        try { await stop(task); message.textContent = '已发送停止请求' }
        catch (error) { message.textContent = `停止失败：${error.message}`; stopButton.disabled = false }
      }
      row.append(stopButton)
      const detail = element('div', '', 'task-history-detail')
      if (task.error) detail.append(element('p', task.error, 'error'))
      detail.append(renderSteps(task.steps, { live: true, loadPrompts: loadPrompts && (step => loadPrompts(task, step)) }))
      card.append(row, detail)
      list.append(card)
    }
  }
  view.refresh = async () => {
    const id = ++requestId
    refresh.disabled = true
    try {
      const result = await load()
      if (id === requestId) draw(result.tasks)
    } catch (error) { if (id === requestId) message.textContent = `加载失败：${error.message}。点击刷新重试。` }
    finally { if (id === requestId) refresh.disabled = false }
  }
  refresh.onclick = view.refresh
  // 当前步骤的已用时间按本地时钟每秒更新；页面离开（不在文档中）后停止。
  const timer = setInterval(() => { if (view.isConnected) tickElapsed(view); else clearInterval(timer) }, 1000)
  void view.refresh()
  return view
}
