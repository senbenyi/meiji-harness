import { promptRecordLabel, verdictLabel } from '../shared/run-names.js'
import { element } from './panel-dom.js'
import { openStepPrompts } from './task-prompt.js'
import { runStepStatusLabels } from '../shared/run-view.js'
import { targetLabel, stepLabel } from './run-labels.js'
export function renderRunProgress(run, { loadPrompts, loadResponses } = {}) {
  const view = element('div')
  for (const step of run.steps) {
    const section = element('section', '', 'episode-summary-task')
    section.append(element('h4', `${targetLabel(step.target)}：${runStepStatusLabels[step.status]}`), element('p', stepLabel(step)))
    if (step.output?.passed !== undefined) section.append(element('p', verdictLabel(step,step.output.passed)))
    if (step.error) section.append(element('p', step.error, 'error'))
    for (const [kind, label, load] of [['prompts', promptRecordLabel(step), loadPrompts], ['responses', '查看原始返回', loadResponses]]) if (step[kind]?.length && load) {
      const button = element('button', label); button.type = 'button'; button.onclick = () => openStepPrompts(button, { title: `${targetLabel(step.target)} · ${label}`, load: () => load(run, step) }); section.append(button)
    }
    view.append(section)
  }
  return view
}
