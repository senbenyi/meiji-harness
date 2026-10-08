// 项目库纯规则；图片沿用内容节点，保存与占用由操作/项目存储入口负责。
import { node, setContent } from './drama-model.js'

export const libraryKinds = {
  characters: { prefix: 'R', label: '角色', variant: '造型', identity: ['nationality', 'gender', 'required'], fields: ['role', 'era', 'age', 'costume', 'height', 'build', 'features', 'appearance', 'prop', 'identity', 'look', 'voiceDescription'] },
  scenes: { prefix: 'L', label: '场景', variant: '状态', identity: [], fields: ['landmark', 'light', 'space', 'look'] },
  props: { prefix: 'T', label: '道具', variant: '样式', identity: ['category', 'ownerLibraryId'], fields: ['description', 'evidence'] },
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const bad = message => { throw Object.assign(new Error(message), { status: 400 }) }
export function kindOf(kind) { return libraryKinds[kind] || bad('库类型无效') }
export function libraryTarget(project, kind, ref) {
  kindOf(kind)
  const entry = project.library?.[kind]?.find(item => item.id === ref?.libraryId)
  const variant = entry && kind === 'characters'
    ? entry.variants.find(item => item.id === entry.defaultVariantId) || entry.variants[0]
    : entry?.variants.find(item => item.id === ref?.variantId)
  return entry && variant ? { entry, variant } : null
}
// 同一角色先按明确关联查找，其次逐字匹配名称/别名；不猜测身份。
export function characterLibraryTarget(project, card) {
  const id = card.libraryId || card.ref?.libraryId
  const names = [card.name, card.sourceName].filter(Boolean)
  const matches = (project.library?.characters || []).filter(entry => id ? entry.id === id : [entry.name, ...(entry.aliases || [])].some(name => names.includes(name)))
  if (matches.length > 1) bad(`人物名称或别名匹配多个项目角色：${card.name}`)
  if (!matches.length) {
    if (id) bad(`库条目不存在：${id}`)
    return null
  }
  const target = libraryTarget(project, 'characters', { libraryId: matches[0].id })
  if (!target) bad(`角色库资料不存在：${matches[0].id}`)
  return target
}
export function libraryLinks(project, kind, libraryId, variantId) {
  return (project.episodes || []).flatMap(episode => (episode.plot[kind]?.items || []).filter(card => card.ref?.libraryId === libraryId && (!variantId || card.ref.variantId === variantId)).map(card => ({ episodeId: episode.id, cardId: card.id, name: card.name })))
}
export function libraryDirectory(project, kind) {
  return (project.library?.[kind] || []).map(({ id, name, aliases, nationality, gender, category, ownerLibraryId, defaultVariantId, variants }) => {
    const rows = kind === 'characters' ? variants.filter(item => item.id === defaultVariantId).slice(0, 1) : variants
    return { id, name, aliases, nationality, gender, category, ownerLibraryId, defaultVariantId,
      ...(kind === 'characters' ? {} : { variants: rows.map(({ id, label, fields, image }) => ({ id, label, fields, hasImage: Boolean(image?.content?.assetId || image?.content?.localPath || image?.content?.url) })) }) }
  })
}
export const requiredCharacters = project => (project.library?.characters || []).filter(item => item.required).map(item => ({ ...libraryDirectory(project, 'characters').find(row => row.id === item.id), required: true }))
function fieldsOf(kind, fields) { return Object.fromEntries(kindOf(kind).fields.map(key => [key, String(fields[key] || '').trim()])) }
function entryFields(kind, fields) { return Object.fromEntries(kindOf(kind).identity.map(key => [key, key === 'required' ? fields[key] === true : String(fields[key] || '').trim()])) }
function variantOf(entry, kind, input, createdFrom) {
  const id = `${entry.id}-${Math.max(0, ...entry.variants.map(item => Number(item.id.split('-').at(-1)) || 0)) + 1}`
  const image = node(`image:${id}`)
  if (input.image?.content) setContent(image, structuredClone(input.image.content), { passed: true, failures: [] })
  return { id, label: String(input.variantLabel || input.label || '默认').trim() || '默认', fields: fieldsOf(kind, input.fields || input), image, ...(createdFrom ? { createdFrom } : {}) }
}
export function createLibraryEntry(project, kind, input, createdFrom) {
  const spec = kindOf(kind), list = project.library[kind]
  const name = String(input.name || '').trim()
  if (!name || name.length > 100) bad('库条目名称需为 1–100 字')
  const aliases = [...new Set((Array.isArray(input.aliases) ? input.aliases : []).map(value => String(value).trim()).filter(Boolean))]
  if (aliases.length > 50 || aliases.some(value => value.length > 100)) bad('别名过长或过多')
  if (list.some(entry => [entry.name, ...entry.aliases].some(value => [name, ...aliases].includes(value)))) bad('库条目名称或别名重复')
  const id = spec.prefix + String(Math.max(0, ...list.map(item => Number(item.id.slice(1)) || 0)) + 1).padStart(2, '0')
  const entry = { id, name, aliases, ...entryFields(kind, input), variants: [], defaultVariantId: null }
  const variant = variantOf(entry, kind, input, createdFrom)
  entry.variants.push(variant); entry.defaultVariantId = variant.id; list.push(entry)
  return { entry, variant }
}
export function addLibraryVariant(project, kind, libraryId, input, createdFrom) {
  if (kind === 'characters') bad('人物不支持多造型')
  const entry = project.library[kind].find(item => item.id === libraryId)
  if (!entry) bad('库条目不存在')
  const variant = variantOf(entry, kind, input, createdFrom); entry.variants.push(variant)
  return { entry, variant }
}
export function applyLibraryCard(project, kind, card, target, linkedBy = card.ref?.linkedBy || 'human') {
  const { entry, variant } = target
  const next = { ...card, ...variant.fields, ...entryFields(kind, entry), name: entry.name, ref: { libraryId: entry.id, variantId: variant.id, linkedBy } }
  delete next.required; delete next.ownerLibraryId
  if (kind === 'props') {
    const owner = [...project.plot?.characters?.items || [], ...project.plot?.scenes?.items || []].find(item => item.ref?.libraryId === entry.ownerLibraryId)
    if (owner) next.ownerId = owner.id
  }
  next.image = structuredClone(card.image || node(`image:${card.id}`))
  if (!same(next.image.content, variant.image.content)) {
    if (next.image.operation && next.image.operation.phase !== 'awaiting-confirmation') throw Object.assign(new Error('关联图片正在执行，无法同步'), { status: 409, code: 'CONTENT_BUSY' })
    setContent(next.image, structuredClone(variant.image.content), { passed: variant.image.content ? Boolean(variant.image.content.localPath || variant.image.content.url || variant.image.content.assetId) : null, failures: [] })
    next.image.operation = null
  }
  return next
}
export function mergeLibraryGroup(project, kind, group) {
  const next = structuredClone(project)
  next.library ||= { characters: [], scenes: [], props: [] }
  next.plot[kind] = { ...group, items: group.items.map(card => {
    let target, linkedBy = 'model'
    if (card.libraryId) {
      const entry = next.library[kind].find(item => item.id === card.libraryId)
      if (!entry) bad(`库条目不存在：${card.libraryId}`)
      target = kind === 'characters' || card.variantId ? libraryTarget(next, kind, { libraryId: card.libraryId, variantId: card.variantId }) : addLibraryVariant(next, kind, entry.id, { ...card, image: null }, { episodeId: project.episodeId, cardId: card.id })
      if (!target) bad(`库变体不存在：${card.variantId}`)
    } else {
      if (card.variantId) bad('变体 ID 必须带库条目 ID')
      const entry = next.library[kind].find(entry => [entry.name, ...entry.aliases].includes(card.name))
      if (entry) { target = libraryTarget(next, kind, { libraryId: entry.id, variantId: entry.defaultVariantId }); linkedBy = 'name' }
      else {
        const owner = [...next.plot.characters.items, ...next.plot.scenes.items].find(item => item.id === card.ownerId)
        target = createLibraryEntry(next, kind, { ...card, ownerLibraryId: owner?.ref?.libraryId || '' }, { episodeId: project.episodeId, cardId: card.id })
      }
    }
    // 旧库缺少声线时一次性采用本次资料，随后跨集统一复用。
    if (kind === 'characters' && card.presence !== 'voice' && !target.variant.fields.look && card.look) target.variant.fields = { ...fieldsOf(kind, card), voiceDescription: target.variant.fields.voiceDescription || card.voiceDescription || '' }
    if (kind === 'characters' && !target.variant.fields.voiceDescription && card.voiceDescription) target.variant.fields.voiceDescription = card.voiceDescription
    const result = applyLibraryCard(next, kind, card, target, linkedBy)
    for (const key of ['libraryId', 'variantId', 'variantLabel']) delete result[key]
    return result
  }) }
  return { plot: next.plot, library: next.library }
}
export function editLinkedCard(project, kind, itemId, fields, { newVariant = false } = {}) {
  const next = structuredClone(project), card = next.plot[kind].items.find(item => item.id === itemId)
  if (!card) bad('卡片不存在')
  let target = libraryTarget(next, kind, card.ref)
  if (!target) { Object.assign(card, fields); return { plot: next.plot } }
  if (newVariant) target = addLibraryVariant(next, kind, target.entry.id, { ...card, ...fields, image: null }, { episodeId: project.episodeId, cardId: card.id })
  else {
    Object.assign(target.entry, entryFields(kind, { ...target.entry, ...fields }))
    if (fields.name) target.entry.name = fields.name
    Object.assign(target.variant.fields, fieldsOf(kind, { ...target.variant.fields, ...fields }))
  }
  Object.assign(card, applyLibraryCard(next, kind, card, target, 'human'))
  return { plot: next.plot, library: next.library }
}
// 同次项目保存同步库变更，并把已确认的关联卡片图片写回库。草稿和图片状态变化不触发写回。
export function syncLibraryChanges(before, after) {
  const next = structuredClone(after)
  if (!next.library) return next
  for (const kind of Object.keys(libraryKinds)) {
    for (const episode of next.episodes) for (const card of (episode.plot[kind]?.items || [])) {
      const old = before.episodes.find(item => item.id === episode.id)?.plot[kind]?.items.find(item => item.id === card.id)
      const target = libraryTarget(next, kind, card.ref)
      if (!old || !target || !same(old.ref, card.ref) || same(old.image?.content, card.image?.content)) continue
      if (target.variant.image.operation) throw Object.assign(new Error('库图片正在执行，无法替换'), { status: 409 })
      setContent(target.variant.image, structuredClone(card.image.content), { passed: Boolean(card.image.content?.assetId || card.image.content?.localPath || card.image.content?.url), failures: [] })
    }
    for (const episode of next.episodes) for (let i = 0; i < (episode.plot[kind]?.items || []).length; i++) {
      const card = (episode.plot[kind]?.items || [])[i], target = libraryTarget(next, kind, card.ref)
      if (!card.ref) continue
      if (!target) bad('卡片关联的库条目或变体不存在')
      const old = libraryTarget(before, kind, card.ref)
      if (!old || !same(old.entry, target.entry) || !same(old.variant, target.variant)) (episode.plot[kind]?.items || [])[i] = applyLibraryCard(episode, kind, card, target)
    }
  }
  return next
}
