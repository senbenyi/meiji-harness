import { syncConsumedReviewInputs } from './workflow-review.js'
import { setCardExpanded } from './shot-card-state.js'
import { assertDrama } from '../shared/drama-model.js'
export function createModelStore() {
  const values = new Map(), listeners = new Set()
  return {
    get: id => values.get(id),
    accept(project) {
      assertDrama(project)
      const previous = values.get(project.id)
      if (previous && previous.revision > project.revision) return previous
      if (previous && previous.revision === project.revision) return previous
      values.set(project.id, project)
      for (const callback of listeners) callback(project)
      return project
    },
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback) },
  }
}
// 各页面拿到的是剧集视图（project-overview-view.js 的 episodeWork，没有 schemaVersion 与 episodes）；
// 重绘与写入模型存储必须使用完整项目：完整项目原样返回，剧集视图按 id 取回存储中的完整项目。
export function rootProject(store, project) {
  if (!project) return null
  return Array.isArray(project.episodes) ? project : store.get(project.id) || null
}
// Retain unchanged components, and hold an actively edited component until it is saved.
export function renderModelView(container, next) {
  const root = container.getRootNode(), active = root.activeElement
  const selection = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null
  const scroll = container.parentElement?.scrollTop
  const old = new Map([...container.querySelectorAll('[data-model-key]')].map(el => [el.dataset.modelKey, el]))
  for (const incoming of next.querySelectorAll('[data-model-key]')) {
    const previous = old.get(incoming.dataset.modelKey)
    if (!previous || !next.contains(incoming)) continue
    const oldDetails = previous.matches('details') ? [previous] : [...previous.querySelectorAll('details')]
    const newDetails = incoming.matches('details') ? [incoming] : [...incoming.querySelectorAll('details')]
    newDetails.forEach((detail, index) => { if (oldDetails[index]) detail.open = oldDetails[index].open })
    if (previous.dataset.expanded && incoming.classList.contains('collapsible-shot')) setCardExpanded(incoming, previous.dataset.expanded === 'true')
    syncConsumedReviewInputs(previous, incoming)
    const editing = previous.contains(active) && active?.matches('input,textarea')
    if (previous.isEqualNode(incoming) || editing || previous.querySelector('[data-dirty="true"]')) incoming.replaceWith(previous)
  }
  container.replaceChildren(next)
  if (active?.isConnected) {
    active.focus({ preventScroll: true })
    if (selection && active.setSelectionRange) active.setSelectionRange(...selection)
  }
  if (container.parentElement && scroll !== undefined) container.parentElement.scrollTop = scroll
}
