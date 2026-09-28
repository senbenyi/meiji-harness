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
