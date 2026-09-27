import { appendWorkflowReview, reviewFields } from './workflow-review.js'
import { pictureOf } from './drama-model.js'
import { element, appendJsonCopy } from './dom.js'
import { stillCards, characterSheet } from './asset-cards.js'

export function characterCard(project, item, actions, context) {
  const card = element('article', '', 'character-card')
  const open = element('button', '', 'character-open')
  open.type = 'button'
  open.setAttribute('aria-label', `人物详情：${item.name}`)
  open.onclick = () => context.onOpenCharacter?.(project.episodeId, item.id)
  const src = pictureOf(item).localPath || (pictureOf(item).imageUrl?.startsWith('/') ? pictureOf(item).imageUrl : '')
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
  const refresh = element('button', '', 'character-refresh')
  refresh.type = 'button'
  const pending = project.activity === `image:${item.id}`
  refresh.disabled = Boolean(project.activity)
  refresh.setAttribute('aria-label', `${pending ? '正在生成' : 'AI生成'}人物图片：${item.name}`)
  refresh.title = pending ? '正在生成图片' : 'AI生成角色图片'
  refresh.textContent = pending ? '生成中' : 'AI生成'
  const error = element('p', '', 'character-error')
  error.hidden = true
  error.setAttribute('role', 'alert')
  refresh.onclick = async () => {
    if (refresh.disabled) return
    refresh.disabled = true
    refresh.textContent = '生成中'
    error.hidden = true
    try { await actions.beginImage(project, 'image', { itemId: item.id, itemName: item.name, ...reviewFields(card) }) }
    catch (reason) {
      refresh.disabled = false
      refresh.textContent = 'AI生成'
      error.textContent = reason.message
      error.hidden = false
    }
  }
  card.append(open, refresh, error)
  appendWorkflowReview(card, item.image, Boolean(item.image?.content), Boolean(project.activity), refresh)
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
  page.append(element('p', '人物资料与形象管理', 'meta'))
  const hint = element('p', project.activityError || '', 'hint warn')
  hint.hidden = !hint.textContent
  hint.setAttribute('role', 'status')
  page.append(hint, ...stillCards(project, [item], actions, hint))
  const address = element('section', '', 'character-image-url')
  address.append(element('h3', '人物图片 URL'))
  if (/^https?:\/\//.test(String(pictureOf(item).imageUrl || ''))) {
    const link = element('a', pictureOf(item).imageUrl)
    link.href = actions.characterImageUrl(project, item.id)
    link.target = '_blank'
    link.rel = 'noopener'
    link.title = '验证并查看已上传的图片'
    address.append(link, element('p', '点击地址验证访问并查看图片。', 'meta'))
  } else address.append(element('p', '尚无已上传的图片 URL，请先确认上传图片。', 'meta'))
  page.append(address)
  return page
}
