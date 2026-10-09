import { element } from './panel-dom.js'
import { costumeImageControls } from './costume-image-controls.js'

export function characterWardrobe(item, pending, { onOpen, onAdd, onImageChange, onRemove, stage, busy = false } = {}) {
  const section = element('section', '', 'character-wardrobe'), head = element('div', '', 'image-text-head')
  head.append(element('h4', '服装'))
  const add = element('button', '＋ 添加服装'); add.type = 'button'; add.disabled = busy; add.onclick = onAdd
  head.append(add); section.append(head)
  const list = element('div', '', 'wardrobe-images')
  for (const costume of item.costumes || []) {
    const card = element('article', '', 'wardrobe-image')
    card.dataset.costumeId = costume.id
    card.append(costumeImageControls(item, costume, pending, { onOpen: () => onOpen?.(costume), onChange: onImageChange ? fields => onImageChange(costume, fields) : undefined, onRemove: onRemove ? () => onRemove(costume) : undefined, stage, busy }))
    const name = element('button', costume.name, 'wardrobe-name'); name.type = 'button'; name.onclick = () => onOpen?.(costume)
    card.append(name); list.append(card)
  }
  if (!item.costumes?.length) section.append(element('p', '暂无服装', 'meta'))
  section.append(list); return section
}
