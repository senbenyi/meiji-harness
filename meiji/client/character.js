import { pictureOf } from '../shared/drama-model.js'
import { element, appendJsonCopy } from './dom.js'
import { stillCards, characterSheet } from './asset-cards.js'

export function characterCard(project, item, actions, context) {
  const card = element('article', '', 'character-card')
  const open = element('button', '', 'character-open')
  open.type = 'button'
  open.setAttribute('aria-label', `人物详情：${item.name}`)
  open.onclick = () => context.onOpenCharacter?.(project.episodeId, item.id)
  const src = pictureOf(item).localPath || ''
  const portrait = element(src ? 'img' : 'span', src ? '' : (item.name || '人').charAt(0), 'character-thumb')
  if (src) { portrait.src = src; portrait.alt = item.name }
  const copy = element('span', '', 'character-copy')
  const details = Object.fromEntries(characterSheet(item))
  copy.append(element('strong', item.name), element('span', details.身份 || '查看人物详情', 'meta character-role'))
  const facts = [details.性别, details.年龄, details.年代, details.身高].filter(Boolean).join(' · ')
  if (facts) copy.append(element('span', facts, 'meta character-facts'))
  const appearance = [details.体型, details.面相].filter(Boolean).join('，')
  if (appearance) copy.append(element('span', appearance, 'meta character-description'))
  open.append(portrait, copy)
  card.append(open)
  appendJsonCopy(card, item)
  return card
}

export function renderCharacterDetail(project, itemId, actions, context) {
  const page = element('section', '', 'session-project character-detail')
  const head = element('div', '', 'episode-bar')
  const back = element('button', '←', 'episode-back')
  back.type = 'button'
  back.setAttribute('aria-label', '返回人物列表')
  back.onclick = () => context.onBackCharacter?.()
  const item = project?.plot?.characters?.items?.find(item => item.id === itemId)
  head.append(back, element('h2', item ? `${item.name} · 人物详情` : '人物详情'))
  page.append(head)
  if (!item) {
    page.append(element('p', '该人物已不存在，请返回列表重新选择。', 'notice'))
    return page
  }
  const hint = element('p', /^(自检|自审)未通过/.test(project.activityError || '') ? '' : project.activityError || '', 'hint warn')
  hint.hidden = !hint.textContent
  hint.setAttribute('role', 'status')
  page.append(hint, ...stillCards(project, [item], actions, hint, { editable: true, imageGate: context.detailGate }))
  return page
}
