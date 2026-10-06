import { ENTITY_COLLECTIONS, generationSchema, validateGeneration, scriptFingerprint } from '../prompts/specification.js'

const string = { type: 'string' }
const array = (items) => ({ type: 'array', items })
const object = (properties) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
const usage = object({ episodeId: string, quote: string })
const entity = { id: string, name: string, description: string, usages: array(usage), generation: generationSchema('image') }
export const ASSET_EXTRACTION_SCHEMA = object({
  characters: array(object(entity)), locations: array(object(entity)), props: array(object(entity)),
  assetVariants: array(object({ ...entity, parentKind: { type: 'string', enum: ['character', 'location', 'prop'] }, parentId: string, changes: string, preserve: string })),
})

export function validateAssetExtraction(value, episodes) {
  const ids = new Set()
  for (const collection of Object.values(ENTITY_COLLECTIONS)) {
    if (!Array.isArray(value?.[collection])) throw new Error(`缺少资产清单 ${collection}`)
    for (const entity of value[collection]) {
      if (!entity.id?.trim() || !entity.name?.trim() || !entity.description?.trim() || ids.has(entity.id)) throw new Error('资产 id、名称、描述必须完整且 id 全局唯一')
      ids.add(entity.id)
      validateGeneration(entity.generation, 'image')
      if (!entity.usages?.length) throw new Error(`资产 ${entity.id} 缺少剧本使用位置`)
      for (const use of entity.usages) {
        if (!use.quote?.trim() || !episodes.find((ep) => ep.id === use.episodeId)?.script?.includes(use.quote)) throw new Error(`资产 ${entity.id} 引用了不存在的剧本文字`)
      }
    }
  }
  if (!value.locations.length) throw new Error('正式剧本必须提取场景')
  for (const variant of value.assetVariants) {
    if (!['character', 'location', 'prop'].includes(variant.parentKind) || !value[ENTITY_COLLECTIONS[variant.parentKind]]?.some((e) => e.id === variant.parentId) || !variant.changes?.trim() || !variant.preserve?.trim()) throw new Error(`衍生资产 ${variant.id} 缺少本体、变化或保持项`)
  }
  return value
}

export function assetExtractionRequest(episodes, existing, label = 'asset-extraction') {
  return { label, role: 'assets', phase: '资产提取与提示词', schema: ASSET_EXTRACTION_SCHEMA,
    validate: (value) => validateAssetExtraction(value, episodes),
    prompt: `从以下正式剧本逐项提取实际使用的角色、场景、道具；识别换装、昼夜、损坏等确实需要的衍生状态。保留仍适用的已有稳定 id，所有类别的 id 全局唯一。每个条目 usages 指定 episodeId 与该剧本逐字 quote，不能引用原文分析代替。每项独立编写完整图片 generation，prompt 展开 details 六项信息，不得只给名称或简介。衍生项额外写 parentKind/parentId、changes/preserve，保持本体身份与布局。基础图为清晰单主体参考图，场景避免无关人物，衍生图依据父图。原文未写的视觉设计须在 description 标注为设计补充。无需衍生或道具时相应数组为空。已有设定：${JSON.stringify(existing)}；正式剧本：${JSON.stringify(episodes.map(({ id, script }) => ({ id, script })))}` }
}

export const assetScriptRefs = (episodes) => episodes.map((ep) => ({ episodeId: ep.id, fingerprint: scriptFingerprint(ep) }))
