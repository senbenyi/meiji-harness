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
export const entityMention = entity => `${entity.name}${entityLabel(entity)}`
// 正文写法「名字【名字|ID】」：替换或校验前先收拢成单独标记，避免名字重复出现。
export function collapseMentions(text, project) {
  let value = String(text)
  for (const e of entityCatalog(project).sort((a, b) => b.name.length - a.name.length)) if (e.name) value = value.split(entityMention(e)).join(entityLabel(e))
  return value
}
const kindLabels = { character: '人物', scene: '场景', prop: '道具', clothes: '服装', props: '人物持物', hairstyles: '人物发型' }
export function entityInstructions(project) {
  const catalog = entityCatalog(project)
  if (!catalog.length) return '【实体引用清单】\n本集无已登记的人物、场景或道具，正文直接描述。'
  const lines = Object.entries(kindLabels).flatMap(([kind, label]) => {
    const items = catalog.filter(e => e.kind === kind)
    return items.length ? [`${label}：${items.map(e => `${entityMention(e)}${e.ownerId && kind !== 'character' && kind !== 'scene' ? `（属 ${e.ownerId}）` : ''}`).join('、')}`] : []
  })
  const sample = ['character', 'scene', 'prop'].map(kind => catalog.find(e => e.kind === kind)).filter(Boolean).map(entityMention).join('、')
  return `【实体引用清单】\n${lines.join('\n')}\n正文每次提到以上人物、场景、道具或服装，都按清单原样写作「名字【名字|ID】」，例如 ${sample}。清单外的物件写普通描述；台词原文不插标记，说话人单独标注；仅被台词提及的人物不算出镜。`
}

