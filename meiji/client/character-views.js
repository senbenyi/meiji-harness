import { targetBusy } from './run-activity.js'
import { pictureOf } from '../shared/drama-model.js'
import { element, appendJsonCopy } from './panel-dom.js'
import { characterSheet, cardImageControls, cardImageGate } from './asset-cards.js'

export function characterDeleteControl(project, item, actions) {
  const row = element('div', '', 'character-card-actions'), remove = element('button', '删除人物', 'delete-content'), error = element('p', '', 'hint warn')
  remove.type='button'; remove.setAttribute('aria-label',`删除人物：${item.name}`)
  remove.title='同步删除对应项目角色及所有关联剧集人物，确认前可查看影响范围'
  remove.disabled=targetBusy(project,'project')
  error.hidden=true; error.setAttribute('role','status')
  remove.onclick=async()=>{
    if(remove.disabled)return
    remove.disabled=true;error.hidden=true
    try {
      const result=await actions.perform(project,'character-delete',{itemId:item.id,itemName:item.name})
      if(result?.cancelled)remove.disabled=false
    } catch(cause){remove.disabled=false;error.textContent=cause.message;error.hidden=false}
  }
  row.append(remove,error);return row
}

export function characterCard(project, item, actions, context) {
  const card = element('article', '', 'character-card')
  const open = element('button', '', 'character-open')
  open.type = 'button'
  open.setAttribute('aria-label', `人物详情：${item.name}`)
  open.onclick = () => context.onOpenCharacter?.(project.episodeId, item.id)
  const gate = cardImageGate(project, item, context.imageGate)
  const src = item.presence === 'voice' ? '' : gate?.previewUrl || pictureOf(item).localPath || ''
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
  if (details.声音特征) copy.append(element('span', `声音：${details.声音特征}`, 'meta character-description'))
  if (item.presence === 'voice') copy.append(element('span', '仅声音', 'meta'))
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
  footer.append(imageActions, characterDeleteControl(project,item,actions))
  appendJsonCopy(footer, item)
  open.append(copy)
  card.append(media, open, footer)
  return card
}
