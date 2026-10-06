import { libraryKinds, kindOf, libraryTarget, libraryLinks, createLibraryEntry, addLibraryVariant, applyLibraryCard } from '../../../../shared/library-rules.js'
import { node, setContent, cardModel, finish } from '../../../../shared/drama-model.js'
import { pictureReference, savePicture, readImageDraft, pictureTargetSnapshot } from '../../../data/image-storage.js'
import { openIncoming } from '../../steps/shared/incoming.js'
import { readFile, rm } from 'node:fs/promises'
import { decodeImageData } from '../../../media/decode-image-data.js'

const invalid = message => { throw Object.assign(new Error(message), { status: 400 }) }
async function photo(c) {
  const op = c.operation
  if (op.assetId) {
    const file = await c.library.file(op.category, op.assetId)
    if (!file.metadata.mime.startsWith('image/')) invalid('请选择图片素材')
    return { ...pictureReference(file.metadata), source: 'photo' }
  }
  if (!op.data && !op.incomingId) return null
  const incoming = op.incomingId ? await openIncoming(c.home, op.incomingId) : null
  const decoded = incoming ? { bytes: await readFile(incoming.file), mime: incoming.mime } : decodeImageData(op.data, op.mime)
  const saved = await savePicture(c.home, decoded.bytes, decoded.mime, op.libraryKind, op.fields?.name || '指定照片', { source: 'photo' })
  if (incoming) await rm(incoming.directory, { recursive: true, force: true })
  return { ...saved, source: 'photo' }
}
export async function opProjectLibrary(c) {
  const { operation: op, projects, project } = c, kind = op.libraryKind, spec = kindOf(kind)
  if (kind === 'characters' && ['entry-variant-add', 'entry-variant-delete'].includes(op.action)) invalid('人物不支持多造型')
  const image = await photo(c)
  if (['entry-image-confirm', 'entry-image-discard'].includes(op.action)) {
    const pending = project.pendingImages?.[op.draftId], target = pending && libraryTarget(project, pending.libraryKind, pending)
    if (!pending || !target || pending.libraryKind !== kind) invalid('候选图已处理或不属于目标库')
    const type = kind === 'characters' ? 'role' : kind === 'scenes' ? 'scene' : 'prop'
    const card = applyLibraryCard(project, kind, cardModel({ id: pending.variantId, type }), target)
    if (pictureTargetSnapshot(card) !== pending.target && op.action === 'entry-image-confirm') throw Object.assign(new Error('变体已修改，请放弃旧候选图'), { status: 409 })
    const file = await readImageDraft(c.home, op.draftId)
    if (file.metadata.projectId !== project.id || file.metadata.itemId !== pending.variantId) invalid('候选图归属无效')
    const reference = op.action === 'entry-image-confirm' ? { ...await savePicture(c.home, file.bytes, file.metadata.mime, kind, target.entry.name, file.metadata), source: 'ai' } : null
    await projects.save(project.id, root => { const current = libraryTarget(root, kind, pending); if (reference) setContent(current.variant.image, reference, { passed: true, failures: [] }); finish(current.variant.image, { passed: Boolean(reference || current.variant.image.content), failures: [] }); delete root.pendingImages[op.draftId]; return root })
    await rm(file.directory, { recursive: true, force: true }); return c.trace
  }
  const result = await projects.save(project.id, root => {
    const next = structuredClone(root), list = next.library[kind]
    const entry = list.find(item => item.id === op.libraryId)
    const target = entry && libraryTarget(next, kind, { libraryId: entry.id, variantId: op.variantId || entry.defaultVariantId })
    const input = { ...op.fields, ...(image ? { image: { content: image } } : {}) }
    if (op.action === 'entry-create') createLibraryEntry(next, kind, input)
    else if (op.action === 'entry-variant-add') addLibraryVariant(next, kind, op.libraryId, input)
    else if (op.action === 'card-link' || op.action === 'card-unlink') {
      const episode = next.episodes.find(item => item.id === op.episodeId), card = episode?.plot[kind].items.find(item => item.id === op.itemId)
      if (!card) invalid('卡片不存在')
      if (op.action === 'card-unlink') delete card.ref
      else {
        if (!target) invalid('关联的条目或变体不存在')
        const linked = op.newVariant ? addLibraryVariant(next, kind, entry.id, { ...card, ...input, image: null }, { episodeId: episode.id, cardId: card.id }) : target
        Object.assign(card, applyLibraryCard(episode, kind, card, linked, 'human'))
      }
    } else {
      if (!entry || !target) invalid('库条目或变体不存在')
      if (target.variant.image.operation && ['entry-edit', 'entry-image', 'entry-image-clear', 'entry-delete', 'entry-variant-delete', 'entry-merge'].includes(op.action)) throw Object.assign(new Error('库图片正在执行，无法修改'), { status: 409 })
      if (op.action === 'entry-edit') {
        const fields = op.fields || {}
        if (fields.name != null) {
          const name = String(fields.name).trim()
          if (!name || name.length > 100 || list.some(item => item !== entry && [item.name, ...item.aliases].includes(name))) invalid('名称为空、过长或重复')
          entry.name = name
        }
        if (fields.aliases != null) {
          if (!Array.isArray(fields.aliases) || fields.aliases.some(value => typeof value !== 'string' || !value.trim() || value.length > 100)) invalid('别名格式无效')
          const aliases = [...new Set(fields.aliases.map(value => value.trim()))]
          if (list.some(item => item !== entry && [item.name, ...item.aliases].some(value => aliases.includes(value)))) invalid('别名重复')
          entry.aliases = aliases
        }
        for (const key of spec.identity) if (fields[key] !== undefined) entry[key] = key === 'required' ? fields[key] === true : String(fields[key]).trim()
        if (fields.defaultVariantId) {
          if (!entry.variants.some(variant => variant.id === fields.defaultVariantId)) invalid('默认变体不存在')
          entry.defaultVariantId = fields.defaultVariantId
        }
        for (const key of spec.fields) if (fields[key] !== undefined) {
          if (typeof fields[key] !== 'string' || fields[key].length > 10000) invalid('变体字段格式无效')
          target.variant.fields[key] = fields[key].trim()
        }
        if (fields.variantLabel) target.variant.label = String(fields.variantLabel).trim()
        if (image) setContent(target.variant.image, image, { passed: true, failures: [] })
      } else if (op.action === 'entry-image' || op.action === 'entry-image-clear') {
        if (target.variant.image.operation) throw Object.assign(new Error('图片正在执行'), { status: 409 })
        if (op.action === 'entry-image' && !image) invalid('请选择照片')
        setContent(target.variant.image, image, { passed: image ? true : null, failures: [] })
      } else if (op.action === 'entry-delete' || op.action === 'entry-variant-delete') {
        const variantId = op.action === 'entry-variant-delete' ? target.variant.id : null
        if (libraryLinks(next, kind, entry.id, variantId).length) throw Object.assign(new Error('存在关联卡片，请先解除关联'), { status: 409 })
        if (variantId) {
          if (entry.variants.length === 1) invalid('条目至少保留一个变体')
          entry.variants = entry.variants.filter(item => item.id !== variantId)
          if (entry.defaultVariantId === variantId) entry.defaultVariantId = entry.variants[0].id
        } else {
          if (next.library.props.some(item => item.ownerLibraryId === entry.id)) throw Object.assign(new Error('条目仍是道具归属，请先修改归属'), { status: 409 })
          next.library[kind] = list.filter(item => item.id !== entry.id)
        }
      } else if (op.action === 'entry-merge') {
        const destination = list.find(item => item.id === op.destinationId)
        if (!destination || destination === entry) invalid('请选择同类目标条目')
        const ids = new Map()
        if (kind === 'characters') {
          for (const variant of entry.variants) ids.set(variant.id, destination.defaultVariantId)
          const source = entry.variants.find(item => item.id === entry.defaultVariantId) || entry.variants[0]
          const targetVariant = destination.variants.find(item => item.id === destination.defaultVariantId) || destination.variants[0]
          if (source && targetVariant) targetVariant.fields = { ...source.fields, ...targetVariant.fields }
        } else for (const variant of entry.variants) {
          const added = addLibraryVariant(next, kind, destination.id, { fields: variant.fields, label: variant.label, image: variant.image }, variant.createdFrom)
          ids.set(variant.id, added.variant.id)
        }
        destination.aliases = [...new Set([...destination.aliases, entry.name, ...entry.aliases])].filter(name => name !== destination.name)
        if (kind === 'characters') destination.required ||= entry.required
        for (const episode of next.episodes) for (const card of episode.plot[kind].items) if (card.ref?.libraryId === entry.id) {
          const ref = { libraryId: destination.id, variantId: ids.get(card.ref.variantId), linkedBy: 'human' }
          Object.assign(card, applyLibraryCard(episode, kind, card, libraryTarget(next, kind, ref), 'human'))
          if (kind === 'characters') Object.assign(card, (entry.variants.find(item => item.id === entry.defaultVariantId) || entry.variants[0])?.fields || {})
        }
        for (const prop of next.library.props) if (prop.ownerLibraryId === entry.id) prop.ownerLibraryId = destination.id
        next.library[kind] = list.filter(item => item.id !== entry.id)
      } else invalid('不支持的库操作')
    }
    return next
  })
  c.trace.result = { library: result.library[kind] }; c.note(`${spec.label}库已保存`); return c.trace
}
const labels = { 'entry-image-confirm': '确认库图片', 'entry-image-discard': '放弃库图片', 'entry-create': '新建库条目', 'entry-edit': '编辑库条目', 'entry-variant-add': '新增库变体', 'entry-variant-delete': '删除库变体', 'entry-delete': '删除库条目', 'entry-merge': '合并库条目', 'entry-image': '指定库照片', 'entry-image-clear': '清除库照片', 'card-link': '关联项目库', 'card-unlink': '解除库关联' }
export const operations = Object.fromEntries(Object.entries(labels).map(([id, label]) => [id, { label, scope: 'project', lock: 'project', agent: false, stage: 'project', step: () => ({ kind: 'save', target: 'library' }), run: opProjectLibrary }]))
