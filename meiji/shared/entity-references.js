// ID 标识实体，与有没有图片无关。附属素材的局部 ID 用所属人物和栏目限定。
export function entityCatalog(project) {
  const result = []
  for (const [group, kind] of [['characters', 'character'], ['scenes', 'scene'], ['props', 'prop']]) {
    for (const card of project.plot?.[group]?.items || []) {
      result.push({ id: card.id, name: card.name, kind: kind === 'prop' && card.category === 'clothing' ? 'clothes' : kind, ownerId: card.ownerId || null, card })
      if (kind === 'character') for (const slot of ['props', 'clothes', 'hairstyles']) {
        for (const part of card[slot] || []) result.push({ id: `${card.id}.${slot}.${part.id}`, name: part.name, kind: slot, ownerId: card.id, card: part })
      }
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
export function entityInstructions(project) {
  return `【实体引用清单】\n${entityCatalog(project).map(e => `${entityLabel(e)}${e.ownerId ? `（所属人物 ${e.ownerId}）` : ''}`).join('\n') || '无已登记实体'}\n镜头表及每秒分镜在人物、场景、道具、服装出现的正文位置使用【名字|ID】。ID仅从清单选择，不自行编造；没有参考图也照常引用。台词原文不插标记，单独标记说话人。仅被台词提及的人物不当作出镜人物；不存在的道具卡可写普通描述，不虚构ID。`
}
