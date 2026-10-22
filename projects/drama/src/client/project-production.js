import { element, backHeader } from './ui/panel-dom.js'
import { productionStages, nodeUiForStage, nodeUi } from './ui/node-registry.js'

const stages = productionStages.map(({ panel }) => [panel.key, panel.title])

// 复制meiji/client/panel-dom.js tabs与project-ui.js stageTabs，再增加键盘与窄屏支持。
function stageTabs(entries, selected, onChange, panelId) {
  const row = element('div', '', 'stage-overview')
  row.setAttribute('role', 'tablist'); row.setAttribute('aria-label', '项目制作阶段')
  const select = key => {
    onChange(key)
    const active = row.querySelector('[aria-selected="true"]')
    active.focus(); active.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }
  for (const [key, title] of entries) {
    const button = element('button', title, 'stage')
    button.type = 'button'; button.id = `${panelId}-${key}`
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', panelId)
    button.setAttribute('aria-selected', String(key === selected)); button.tabIndex = key === selected ? 0 : -1
    if (key === selected) button.setAttribute('aria-current', 'step')
    button.onclick = () => select(key)
    button.onkeydown = event => {
      const index = entries.findIndex(([id]) => id === key)
      const target = { ArrowRight: (index + 1) % entries.length, ArrowLeft: (index + entries.length - 1) % entries.length, Home: 0, End: entries.length - 1 }[event.key]
      if (target === undefined) return
      event.preventDefault(); select(entries[target][0])
    }
    row.append(button)
  }
  return row
}

export function renderProjectProduction(root, project, { state, onBack, openTasks, openRules, saveOpinion }) {
  root.classList.add('project-production')
  backHeader(root, project.basic_info.name, '返回项目详情', onBack)
  if (!stages.some(([key]) => key === state.productionTab)) state.productionTab = stages[0][0]
  const panelId = `production-${project.basic_info.id}`, body = element('div', '', 'session-body')
  body.id = panelId; body.setAttribute('role', 'tabpanel')
  const nav = stageTabs(stages, state.productionTab, key => {
    state.productionTab = key
    paint()
  }, panelId)
  root.append(nav, body)
  function paint() {
    for (const button of nav.children) {
      const active = button.id === `${panelId}-${state.productionTab}`
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1
      if (active) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current')
    }
    body.setAttribute('aria-labelledby', `${panelId}-${state.productionTab}`)
    body.replaceChildren()
    const [key] = stages.find(([key]) => key === state.productionTab)
    const options = { state, openTasks, openRules, saveOpinion }
    nodeUiForStage(key).panel.render(body, project, options)
    if (key === 'shot_design') nodeUi('clip_composition').panel.render(body, project, options)
  }
  paint()
  nav.querySelector('[aria-selected="true"]').scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}
