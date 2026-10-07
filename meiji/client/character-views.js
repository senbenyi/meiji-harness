import { historyEntry } from './run-history-entry.js'
import { pictureOf } from '../shared/drama-model.js'
import { element, appendJsonCopy } from './panel-dom.js'
import { stillCards, characterSheet, cardImageControls, cardImageGate } from './asset-cards.js'

export function characterCard(project, item, actions, context) {
  const card = element('article', '', 'character-card')
  const open = element('button', '', 'character-open')
  open.type = 'button'
  open.setAttribute('aria-label', `人物详情：${item.name}`)
  open.onclick = () => context.onOpenCharacter?.(project.episodeId, item.id)
  const gate = cardImageGate(project, item, context.imageGate)
  const src = gate?.previewUrl || pictureOf(item).localPath || ''
  const portrait = element(src ? 'img' : 'span', src ? '' : (item.name || '人').charAt(0), 'character-thumb')
  if (src) { portrait.src = src; portrait.alt = item.name }
  const copy = element('span', '', 'character-copy')
  const details = Object.fromEntries(characterSheet(item))
  const title = element('span', '', 'character-card-title')
  title.append(element('span', item.id, 'scene-card-id character-card-id'), element('strong', item.name))
  copy.append(title, element('span', details.身份 || '查看人物详情', 'meta character-role'))
  const facts = [details.性别, details.年龄, details.年代, details.身高].filter(Boolean).join(' · ')
  if (facts) copy.append(element('span', facts, 'meta character-facts'))
  const appearance = [details.体型, details.面相].filter(Boolean).join('，')
  if (appearance) copy.append(element('span', appearance, 'meta character-description'))
  const media = element('div', '', 'character-card-media')
  const imageOpen = element('button', '', 'character-portrait-open')
  imageOpen.type = 'button'
  imageOpen.setAttribute('aria-label', `人物图片详情：${item.name}`)
  imageOpen.onclick = open.onclick
  imageOpen.append(portrait)
  media.append(imageOpen)
  const footer = element('div', '', 'character-card-footer')
  const imageActions = element('div', '', 'character-card-actions')
  imageActions.append(...cardImageControls(project, item, actions, gate))
  footer.append(imageActions)
  appendJsonCopy(footer, item)
  open.append(copy)
  card.append(media, open, footer)
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
  if (item && actions.openHistory) head.append(historyEntry(project, actions, `characters,image:${item.id}`))
  page.append(head)
  if (!item) {
    page.append(element('p', '该人物已不存在，请返回列表重新选择。', 'notice'))
    return page
  }
  // 错误显示在对应内容与图片节点上；这里只承载本页的即时提示。
  const hint = element('p', '', 'hint warn')
  hint.hidden = !hint.textContent
  hint.setAttribute('role', 'status')
  page.append(hint, ...stillCards(project, [item], actions, hint, { editable: true, imageGate: context.detailGate }))
  return page
}
