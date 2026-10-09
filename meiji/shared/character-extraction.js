import { characterLibraryTarget } from './library-rules.js'

const cardState = new Set(['id', 'type', 'image', 'status', 'revision', 'baseRevision', 'check', 'review', 'operation', 'error', 'parts', 'draft', 'localPath', 'ref'])

// 本轮开始时的库目录随角色节点保存；新资料发布入库不会改变本轮的已有/新增分类。
export function characterExtractionProject(project, node) {
  if (!Array.isArray(node?.extractionLibraryIds)) return project
  const ids = new Set(node.extractionLibraryIds)
  return { ...project, library: { ...project.library, characters: (project.library?.characters || []).filter(entry => ids.has(entry.id)) } }
}

export function characterExtractionDirectory(project) {
  return (project.library?.characters || []).map(entry => ({ libraryId: entry.id, name: entry.name, aliases: entry.aliases || [], costumes: (entry.variants.find(item => item.id === entry.defaultVariantId) || entry.variants[0])?.fields.costumes || [] }))
}

export function characterExtractionFacts(project, content) {
  const ids = new Set((content?.items || []).map(item => item?.libraryId).filter(Boolean))
  return (project.library?.characters || []).filter(entry => ids.has(entry.id)).map(entry => {
    const fields = (entry.variants.find(variant => variant.id === entry.defaultVariantId) || entry.variants[0])?.fields || {}
    return { libraryId: entry.id, name: entry.name, aliases: entry.aliases || [], role: fields.role || '', identity: fields.identity || '' }
  })
}

// 只在提取/审核边界检查模型引用，不改变删除等流程的共享匹配算法。
export function characterExtractionTarget(project, item) {
  const target = characterLibraryTarget(project, item)
  const id = item.libraryId || item.ref?.libraryId
  if (target && id && ![target.entry.name, ...(target.entry.aliases || [])].some(name => [item.name, item.sourceName].includes(name))) {
    throw new Error(`人物名称与库条目不一致：${item.name} → ${id}（${target.entry.name}）`)
  }
  return target
}

// 待审与修订的表示和生成协议一致；程序展开的外貌、声音和图片不是模型生成稿。
// 无法解析的失败稿原样保留，让现有程序校验与修订处理格式问题。
export function characterExtractionContent(project, value) {
  let node = value
  if (typeof value === 'string') {
    try { node = JSON.parse(value) } catch { return value }
  }
  if (!Array.isArray(node?.items)) return value
  const view = characterExtractionProject(project, node)
  const ids = Array.isArray(node.extractionLibraryIds) ? new Set(node.extractionLibraryIds) : null
  return { items: node.items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const id = item.libraryId || item.ref?.libraryId
    const newlyPublished = ids && id && !ids.has(id)
    const input = newlyPublished ? { ...item, libraryId: '', ref: undefined } : item
    const content = Object.fromEntries(Object.entries(item).filter(([key]) => !cardState.has(key)))
    let target
    try { target = characterExtractionTarget(view, input) }
    catch { return { ...content, ...(id ? { libraryId: id } : {}) } }
    if (target) {
      const known = target.variant.fields.costumes || []
      const added = (item.costumes || []).filter(row => !known.some(old => old.id === row.id))
      return { name: item.sourceName || item.name, presence: item.presence || 'visible', libraryId: target.entry.id, ...(added.length ? { costumes: added } : {}) }
    }
    if (newlyPublished) content.libraryId = ''
    return content
  }) }
}
