import { operationRequest } from './operation-request.js'
// 生成按钮与其运行中任务组成一个整体：[生成中] [查看任务] [停止]。
// 渲染时用 markTask 标记按钮对应的操作与镜头；任务列表刷新或页面重绘后，由 decorateTaskGroups 把
// 「查看任务 / 停止」放到按钮同一行。没有对应按钮的任务（如在其他页面发起）由调用方另行展示。
export function markTask(button, action, track = '') {
  const operation = operationRequest(action, { track })
  button.dataset.taskAction = operation.action
  button.dataset.taskParts = operation.parts || ''
  button.dataset.taskOnly = operation.only || ''
  button.dataset.taskTrack = track || ''
  return button
}

const matches = (button, task) => task.action === button.dataset.taskAction && String(task.track || '') === button.dataset.taskTrack && String(task.parts || '') === button.dataset.taskParts && String(task.only || '') === button.dataset.taskOnly

export function decorateTaskGroups(root, tasks = [], { open, stop } = {}) {
  const attached = new Set()
  for (const button of root.querySelectorAll('button[data-task-action]')) {
    let group = button.parentElement?.classList.contains('task-group') ? button.parentElement : null
    group?.querySelectorAll(':scope > .task-group-extra').forEach(node => node.remove())
    const task = tasks.find(item => matches(button, item))
    if (!task) { group?.classList.remove('is-running'); continue }
    attached.add(task.id)
    if (!group) {
      group = document.createElement('span')
      group.className = 'task-group'
      button.replaceWith(group)
      group.append(button)
    }
    group.classList.add('is-running')
    const view = document.createElement('button')
    view.type = 'button'
    view.className = 'task-group-extra task-group-view'
    view.textContent = task.queued ? `排队中${task.queuePosition ? ` · 第${task.queuePosition}位` : ''}` : '查看任务'
    view.title = '查看当前任务进度'
    view.onclick = () => open?.(task)
    const halt = document.createElement('button')
    halt.type = 'button'
    halt.className = 'task-group-extra task-group-stop'
    halt.textContent = task.queued ? '取消' : '停止'
    halt.setAttribute('aria-label', `停止任务${task.track ? ' · ' + task.track : ''}`)
    halt.onclick = async () => {
      halt.disabled = true
      halt.textContent = '停止中'
      try { await stop?.(task) } catch { halt.disabled = false; halt.textContent = task.queued ? '取消' : '停止' }
    }
    group.append(view, halt)
  }
  return attached
}
