import { GenerationStatus } from '../shared/drama-model.js'
import { element } from './dom.js'

export function setCardExpanded(card, expanded) {
  card.dataset.expanded = String(expanded)
  const toggle = card.querySelector('.shot-collapse')
  toggle.textContent = expanded ? '收起' : '展开'
  toggle.setAttribute('aria-expanded', String(expanded))
  toggle.setAttribute('aria-label', `${expanded ? '收起' : '展开'} ${card.dataset.shotId}`)
}

export function decorateShotCard(card, model, id, first) {
  let head = card.querySelector(':scope > .shot-head, :scope > .outline-head')
  if (!head) {
    head = element('div', '', 'shot-head')
    head.append(card.querySelector('h3'))
    card.prepend(head)
  }
  head.classList.add('shot-collapse-head')
  card.classList.add('collapsible-shot')
  card.dataset.shotId = id
  const generating = model?.status === GenerationStatus.GENERATING
  const paused = model?.status === GenerationStatus.PAUSED
  const failed = !paused && !generating && (model?.check?.passed === false || Boolean(model?.error))
  const generated = Boolean(model?.content || model?.items?.length)
  const label = paused ? '暂停' : generating ? '生成中' : failed ? (model?.check?.passed === false ? '自审未通过' : '生成失败')
    : !generated ? '未生成' : model?.stale ? '已过期'
      : model?.check?.passed === true ? '已通过' : '待自审'
  card.classList.toggle('shot-unpassed', failed)
  head.append(element('span', label, 'shot-check-badge'))
  const toggle = element('button', '', 'shot-collapse')
  toggle.type = 'button'
  toggle.onclick = () => setCardExpanded(card, card.dataset.expanded !== 'true')
  head.append(toggle)
  setCardExpanded(card, first)
}
