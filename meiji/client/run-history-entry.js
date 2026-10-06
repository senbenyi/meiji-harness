import { element } from './panel-dom.js'
import { historyScopes } from '../shared/run-view.js'
export function historyEntry(project, actions, scope = '') {
  const label = historyScopes[scope.split(':')[0]]?.[0]
  const button = element('button', scope.includes(':') || scope.includes(',') ? '历史' : label ? `查看${label}任务历史 →` : '查看任务历史 →', 'task-history-entry')
  button.type = 'button'; button.onclick = () => actions.openHistory(project, scope)
  return button
}
export { skillsLine } from './run-labels.js'
