// ID 标识实体，与有没有图片无关。附属素材的局部 ID 用所属人物和栏目限定。
export function entityCatalog(project) {
  const result = []
  for (const [group, kind] of [['characters', 'character'], ['scenes', 'scene'], ['props', 'prop']]) {
    for (const card of project.plot?.[group]?.items || []) {
      result.push({ id: card.id, name: card.name, kind: kind === 'prop' && card.category === 'clothing' ? 'clothes' : kind, ownerId: card.ownerId || null, card })
      // 历史人物快照可能带有旧部位数据，但新生成链路不再创建或引用这些实体。
    }
  }
  return result
}
export const entityLabel = entity => `【${entity.name}|${entity.id}】`
export const referencePattern = () => /【([^【】|\n]+)\|([^【】|\n]+)】/g
export function referencedEntities(text, project) {
  const catalog = new Map(entityCatalog(project).map(e => [e.id, e]))
  const found = new Map()
  for (const match of String(text).matchAll(referencePattern())) {
    const entity = catalog.get(match[2])
    if (!entity) throw new Error(`未知实体ID：${match[0]}`)
    if (entity.name !== match[1]) throw new Error(`实体名称不匹配：${match[0]}，应为${entityLabel(entity)}`)
    found.set(entity.id, entity)
  }
  if (/【[^】]*[|｜][^】]*】/.test(String(text).replace(referencePattern(), ''))) throw new Error('实体标记必须为【名字|ID】，使用半角 |')
  return [...found.values()]
}
export const entityMention = entity => `${entity.name}${entityLabel(entity)}`
// 名字可带中英文引号；仅将紧接同名同 ID 标记的前缀收拢，避免校验误报和渲染重名。
export function collapseMentions(text, project) {
  let value = String(text)
  for (const e of entityCatalog(project).sort((a, b) => b.name.length - a.name.length)) if (e.name) {
    const label = entityLabel(e)
    for (const [open, close] of [['', ''], ['“', '”'], ['‘', '’'], ['"', '"'], ["'", "'"]]) {
      value = value.split(`${open}${e.name}${close}${label}`).join(label)
    }
  }
  return value
}
