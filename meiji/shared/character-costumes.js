const invalid = message => { throw Object.assign(new Error(message), { status: 400 }) }
const signature = item => JSON.stringify([item.name, item.description, item.context])

// ID 属于一套服装，编辑和跨集复用时保持；空 ID 仅用于新增。
export function normalizeCostumes(value = [], previous = []) {
  if (!Array.isArray(value)) invalid('服装必须为数组')
  const ids = new Set()
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) invalid('服装条目格式无效')
    const row = {}
    for (const key of ['name', 'description', 'context']) {
      if (typeof item[key] !== 'string' || item[key].length > 10000 || key !== 'context' && !item[key].trim()) invalid('服装需填写名称、描述，适用场景须为文字')
      row[key] = item[key].trim()
    }
    if (item.id != null && (typeof item.id !== 'string' || item.id && !/^[A-Za-z0-9_-]{1,100}$/.test(item.id))) invalid('服装 ID 无效')
    row.id = item.id || previous.find(old => signature(old) === signature(row))?.id || crypto.randomUUID()
    if (ids.has(row.id)) invalid('服装 ID 重复')
    ids.add(row.id)
    return { id: row.id, name: row.name, description: row.description, context: row.context }
  })
}

// 仅在创建/编辑资料时确定默认项；读取与生成不能按数组顺序重新猜选。
export function wardrobeFields(input, previous = {}) {
  const costumes = normalizeCostumes(input.costumes ?? previous.costumes, previous.costumes)
  let defaultCostumeId = input.defaultCostumeId ?? previous.defaultCostumeId
  if (input.defaultCostumeId !== undefined && typeof input.defaultCostumeId !== 'string') invalid('默认服装 ID 无效')
  if (input.defaultCostumeId && !costumes.some(row => row.id === input.defaultCostumeId)) invalid('默认服装不存在')
  if (!costumes.some(row => row.id === defaultCostumeId)) {
    defaultCostumeId = costumes.find(row => row.description === (input.costume ?? previous.costume))?.id || costumes[0]?.id || ''
  }
  return { costumes, defaultCostumeId }
}

// AI 提取只追加新服装，不改写已有 ID 下的人工资料。
export function mergeCostumes(previous = [], incoming = []) {
  const result = structuredClone(previous)
  for (const row of normalizeCostumes(incoming, previous)) {
    const existing = result.find(item => item.id === row.id)
    if (existing && signature(existing) !== signature(row)) invalid(`不得改写已有服装：${row.id}`)
    if (!existing && !result.some(item => signature(item) === signature(row))) result.push(row)
  }
  return result
}

export const costumesText = items => (items || []).map(item => `${item.id} · ${item.name}：${item.description}${item.context ? `（${item.context}）` : ''}`).join('\n')

// 主图可保留为人物参考；每套服装必须有与当前描述匹配的独立图片。
export function costumePicture(costume, image) {
  const picture = image?.costumes?.[costume.id]
  return picture?.description === costume.description ? picture : null
}
export function characterImagesReady(costumes, image) {
  const usable = value => Boolean(value?.assetId || value?.localPath || value?.url)
  return usable(image) && (costumes || []).every(costume => usable(costumePicture(costume, image)))
}
