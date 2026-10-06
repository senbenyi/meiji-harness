import { element } from './panel-dom.js'
import { openStepPrompts } from './task-prompt.js'
import { runStepStatusLabels } from '../shared/run-view.js'
import { targetLabel, stepLabel } from './run-labels.js'
export function renderRunProgress(run, { loadPrompts, loadResponses } = {}) {
  const view = element('div')
  for (const step of run.steps) {
    const section = element('section', '', 'episode-summary-task')
    section.append(element('h4', `${targetLabel(step.target)}：${runStepStatusLabels[step.status]}`), element('p', stepLabel(step)))
    if (step.output?.passed !== undefined) section.append(element('p', step.output.passed ? '审核通过' : '审核未通过'))
    if (step.error) section.append(element('p', step.error, 'error'))
    for (const [kind, label, load] of [['prompts', '查看提示词', loadPrompts], ['responses', '查看原始返回', loadResponses]]) if (step[kind]?.length && load) {
      const button = element('button', label); button.type = 'button'; button.onclick = () => openStepPrompts(button, { title: `${targetLabel(step.target)} · ${label}`, load: () => load(run, step) }); section.append(button)
    }
    view.append(section)
  }
  return view
}
