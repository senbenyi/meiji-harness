import { cardModel, pictureOf } from '../server/models/data/drama-model.js'
import { libraryTarget } from './library-rules.js'

// 只读取既有身份/库资料，在编译副本绑定；不生成角色，不发模型或图片请求。
export function resolveStoryboardProject(project, shot, { requireParticipants = false } = {}) {
  const content = shot?.seconds?.content
  if (content?.version !== 2) return project
  if (!Array.isArray(content.participants)) {
    if (requireParticipants) throw new Error(`${shot.id} 缺少participants参与角色清单，请先补齐每秒指令`)
    return project
  }
  const next = structuredClone(project), cards = next.plot.characters.items
  let ordinal = Math.max(0, ...cards.map(card => Number(String(card.id).replace(/^C/, '')) || 0))
  const identities = new Set()
  for (const person of content.participants) {
    const matches = cards.filter(card => [card.name, card.sourceName].includes(person.name))
    if (matches.length > 1) throw new Error(`${shot.id} 参与角色「${person.name}」匹配多个人物，请明确身份关联`)
    const card = matches[0]
    let target = card?.ref ? libraryTarget(next, 'characters', card.ref) : null
    if (card?.ref && !target) throw new Error(`${shot.id} 角色「${person.name}」的库关联已失效`)
    if (!card) {
      const entries = (next.library?.characters || []).filter(entry => [entry.name, ...(entry.aliases || [])].includes(person.name))
      if (entries.length > 1) throw new Error(`${shot.id} 参与角色「${person.name}」匹配多个库人物，请明确身份关联`)
      if (entries[0]) target = libraryTarget(next, 'characters', { libraryId: entries[0].id })
    }
    if (!card && !target) throw new Error(`${shot.id} 参与角色「${person.name}」缺少人物资料，请先编辑或准备角色资料`)
    const identity = target ? `library:${target.entry.id}` : `card:${card.id}`
    if (identities.has(identity)) throw new Error(`${shot.id} 参与清单多个称谓对应同一人物「${person.name}」，请先统一每秒指令称谓`)
    identities.add(identity)
    if (target) {
      const resolved = cardModel({ ...card, ...target.variant.fields, id: card?.id || `C${String(++ordinal).padStart(2, '0')}`, name: target.entry.name, sourceName: person.name,
        type: 'role', presence: person.presence, image: target.variant.image, ref: {libraryId:target.entry.id,variantId:target.variant.id} })
      if (card) cards[cards.indexOf(card)] = resolved
      else cards.push(resolved)
    }
    const resolved = cards.find(value => [value.name, value.sourceName].includes(person.name))
    if (person.presence === 'visible' && !resolved?.look && !resolved?.appearance && !resolved?.description && !pictureOf(resolved).localPath) throw new Error(`${shot.id} 出镜角色「${person.name}」缺少外貌资料或已确认图片，请先准备人物资料`)
  }
  return next
}
