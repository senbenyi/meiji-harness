import { ENTITY_COLLECTIONS, generationSchema, validateGeneration, scriptFingerprint } from '../prompts/specification.js'
import { productionOutputSchema } from './production-schemas.js'

export const ASSET_EXTRACTION_SCHEMA = productionOutputSchema('asset-extraction')

/** Build stable references to exact non-empty lines in the current formal scripts. */
export function assetUsageSegments(episodes) {
  return episodes.flatMap((episode) => episode.script.split(/\r?\n/).map((quote) => quote.trim()).filter(Boolean)
    .map((quote, index) => ({ id: `${episode.id}:u${String(index + 1).padStart(3, '0')}`, episodeId: episode.id, quote })))
}

/** Materialize schema-enforced usage references as exact formal-script citations. */
export function materializeAssetUsages(value, segments) {
  const byId = new Map(segments.map((segment) => [segment.id, segment]))
  for (const collection of Object.values(ENTITY_COLLECTIONS)) for (const entity of value?.[collection] || []) {
    const compatibleRef = segments.find((segment) => entity.usages?.some((usage) => usage.episodeId === segment.episodeId && usage.quote === segment.quote))?.id
    const segment = byId.get(entity.usageRef || compatibleRef)
    if (!segment) throw new Error(`资产 ${entity.id} 引用了未知 usageRef`)
    entity.usages = [{ episodeId: segment.episodeId, quote: segment.quote }]
    delete entity.usageRef
  }
  return value
}

function assetExtractionSchema(segments) {
  const schema = structuredClone(ASSET_EXTRACTION_SCHEMA)
  for (const collection of Object.values(ENTITY_COLLECTIONS)) {
    const item = schema.properties[collection].items
    delete item.properties.usages
    item.properties.usageRef = { type: 'string', enum: segments.map((segment) => segment.id) }
    item.required = item.required.map((field) => field === 'usages' ? 'usageRef' : field)
  }
  return schema
}

/** Recover only source-grounded assets when the model returns no structure. */
export function deterministicKnownAssetExtraction(episodes, existing, knownAssets = {}) {
  const segments = assetUsageSegments(episodes)
  const result = Object.fromEntries(Object.values(ENTITY_COLLECTIONS).map((collection) => [collection, []]))
  for (const [kind, collection] of Object.entries(ENTITY_COLLECTIONS)) {
    for (const entity of Object.values(existing[collection] || {})) {
      if (entity.retired || entity.provisional || !entity.id || !entity.name || !entity.description) continue
      const name = entity.name.toLocaleLowerCase()
      const usage = segments.find((segment) => segment.quote.toLocaleLowerCase().includes(name))
      if (!usage) continue
      result[collection].push({
        id: entity.id, name: entity.name, description: entity.description, usageRef: usage.id,
        ...(kind === 'variant' ? {
          parentKind: entity.parentKind, parentId: entity.parentId,
          changes: entity.changes, preserve: entity.preserve,
        } : {}),
      })
    }
  }
  if (!result.locations.length && !Object.values(knownAssets.locations || {}).length) {
    const scene = segments.find((segment) => /(?:内景|外景|场景)/.test(segment.quote))
    if (!scene) throw new Error('确定性资产恢复无法在正式剧本中定位明确场景标题')
    const name = scene.quote.replace(/^[\s—-]+|[\s—-]+$/g, '').trim()
    result.locations.push({
      id: `loc-script-${scene.episodeId}-${scene.id.split(':').at(-1)}`,
      name,
      description: `正式剧本场景标题：${name}`,
      usageRef: scene.id,
    })
  }
  return result
}

export function validateAssetExtraction(value, episodes, requirePrompts = true, options = {}) {
  const { knownAssets = {}, requireLocation = true } = options
  const ids = new Set()
  for (const collection of Object.values(ENTITY_COLLECTIONS)) {
    if (!Array.isArray(value?.[collection])) throw new Error(`缺少资产清单 ${collection}`)
    for (const entity of value[collection]) {
      if (!entity.id?.trim() || !entity.name?.trim() || !entity.description?.trim() || ids.has(entity.id)) throw new Error('资产 id、名称、描述必须完整且 id 全局唯一')
      ids.add(entity.id)
      if (requirePrompts) validateGeneration(entity.generation, 'image')
      if (!entity.usages?.length) throw new Error(`资产 ${entity.id} 缺少剧本使用位置`)
      for (const use of entity.usages) {
        if (!use.quote?.trim() || !episodes.find((ep) => ep.id === use.episodeId)?.script?.includes(use.quote)) throw new Error(`资产 ${entity.id} 引用了不存在的剧本文字`)
      }
    }
  }
  if (requireLocation && !value.locations.length) throw new Error('正式剧本必须提取场景')
  const variantErrors = []
  for (const variant of value.assetVariants) {
    if (!['character', 'location', 'prop'].includes(variant.parentKind)) {
      variantErrors.push(`衍生资产 ${variant.id} 的本体类型无效`)
      continue
    }
    const collection = ENTITY_COLLECTIONS[variant.parentKind]
    const parentExists = [...value[collection], ...Object.values(knownAssets[collection] || {})].some((entity) => entity.id === variant.parentId)
    if (!parentExists) variantErrors.push(`衍生资产本体未包含：${variant.id} -> ${collection}/${variant.parentId}`)
    if (!variant.changes?.trim()) variantErrors.push(`衍生资产 ${variant.id} 缺少变化项`)
    if (!variant.preserve?.trim()) variantErrors.push(`衍生资产 ${variant.id} 缺少保持项`)
  }
  if (variantErrors.length) throw new Error(variantErrors.join('；'))
  return value
}

export function assetExtractionRequest(episodes, existing, label = 'asset-extraction', knownAssets = {}) {
  const usageSegments = assetUsageSegments(episodes)
  const definitions = Object.fromEntries(Object.values(ENTITY_COLLECTIONS).map((collection) => [collection,
    [...new Map(Object.values(existing[collection] || {}).filter((entity) => !entity.retired).map((entity) => [entity.id, entity])).values()].map(({ id, name, description, parentKind, parentId, changes, preserve }) => ({ id, name, description, parentKind, parentId, changes, preserve }))]))
  return { label, role: 'assets', phase: '剧本资产提取', schema: assetExtractionSchema(usageSegments),
    validate: (value) => validateAssetExtraction(materializeAssetUsages(value, usageSegments), episodes, false, { knownAssets, requireLocation: false }),
    fallback: () => deterministicKnownAssetExtraction(episodes, existing, knownAssets),
    prompt: `从以下正式剧本提取实际出镜的角色、完整场景、独立使用的核心道具；识别换装、昼夜、干湿等需要的衍生状态。只返回精简中文资产清单，本次不写图片提示词。服装属于角色造型，场景固定陈设属于场景，不重复拆成道具或新场景。保留适用的已有稳定 id，所有类别 id 全局唯一。每项必须选择一个提供的正式剧本 usageRef，禁止自行抄写 quote。衍生项明确正确本体 parentKind/parentId、变化 changes 与不变项 preserve；本体必须属于本次结果或此前已通过的累计资产，不得只引用故事分析中的临时设定。每项描述仅写该资产，不复制全段剧本；原文未写的视觉设计标注为设计补充。数组和对象必须为 JSON 数组和对象，不序列化为字符串。无需衍生或道具时填空数组。已有设定：${JSON.stringify(definitions)}；正式剧本 usageRefs：${JSON.stringify(usageSegments)}` }
}

export async function extractAssetsByEpisode(episodes, existing, call) {
  const collections = Object.values(ENTITY_COLLECTIONS)
  const assets = Object.fromEntries(collections.map((collection) => [collection, []]))
  for (const episode of episodes) {
    const context = Object.fromEntries(collections.map((collection) => [collection, [...Object.values(existing[collection] || {}), ...assets[collection]]]))
    const [value] = await call([assetExtractionRequest([episode], context, `asset-extraction:${episode.id}`, assets)])
    for (const collection of collections) for (const entity of value[collection]) {
      const previous = assets[collection].find((item) => item.id === entity.id)
      if (previous && (previous.parentKind !== entity.parentKind || previous.parentId !== entity.parentId)) throw new Error(`衍生资产 ${entity.id} 跨集使用了不同本体，请使用独立 id`)
      const usages = [...new Map([...(previous?.usages || []), ...entity.usages].map((use) => [JSON.stringify(use), use])).values()]
      const next = { ...entity, usages }
      if (previous) assets[collection][assets[collection].indexOf(previous)] = next
      else assets[collection].push(next)
    }
  }
  validateAssetExtraction(assets, episodes, false)
  return assets
}

export function assetPromptRequests(assets, episodes, variants = false) {
  return Object.entries(ENTITY_COLLECTIONS).filter(([kind]) => (kind === 'variant') === variants).flatMap(([kind, collection]) => assets[collection].map((entity) => {
    const parent = entity.parentId && assets[ENTITY_COLLECTIONS[entity.parentKind]].find((item) => item.id === entity.parentId)
    return { label: `asset-prompt:${entity.id}`, role: 'assets', phase: '资产图片提示词', schema: generationSchema('image'),
      validate: (value) => validateGeneration(value, 'image'),
      prompt: `仅为此${kind}资产编写一份完整中文图片提示词。prompt 必须可直接生成，details 六项具体简明，不复制剧本，不写多个镜头。基础图为清晰参考图，角色保持完整造型；场景无人物；道具独立展示。衍生图依据本体参考图，保留身份/布局，准确应用变化。不要添加标签文字。资产：${JSON.stringify(entity)}；本体：${JSON.stringify(parent || null)}；剧本依据：${JSON.stringify(entity.usages.map((use) => ({ ...use, title: episodes.find((ep) => ep.id === use.episodeId)?.title })))}` }
  }))
}

export function applyAssetPrompts(assets, requests, values) {
  requests.forEach((request, index) => {
    const entity = Object.values(ENTITY_COLLECTIONS).flatMap((collection) => assets[collection]).find((item) => request.label === `asset-prompt:${item.id}`)
    entity.generation = values[index]
  })
}

export const assetScriptRefs = (episodes) => episodes.map((ep) => ({ episodeId: ep.id, fingerprint: scriptFingerprint(ep) })).sort((a, b) => a.episodeId.localeCompare(b.episodeId))
