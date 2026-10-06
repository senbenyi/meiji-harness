import { createHash } from 'node:crypto'
import { DomainValidationError } from '../domain/errors.js'

export const ENTITY_COLLECTIONS = { character: 'characters', location: 'locations', prop: 'props', variant: 'assetVariants' }
export const IMAGE_DETAILS = ['subject', 'appearance', 'composition', 'lighting', 'style', 'constraints']
export const VIDEO_DETAILS = ['subject', 'action', 'camera', 'timing', 'continuity', 'sound']
export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const entityFor = (project, kind, id) => project[ENTITY_COLLECTIONS[kind]]?.[id]
export const scriptFingerprint = (episode) => digest([episode?.script, episode?.sourceSpans, episode?.analysisProposalId])

export function validateGeneration(value, purpose) {
  if (!value || typeof value.prompt !== 'string' || !value.prompt.trim()) throw new DomainValidationError(`${purpose} 提示词尚未编写`)
  for (const key of purpose === 'video' ? VIDEO_DETAILS : IMAGE_DETAILS) {
    if (typeof value.details?.[key] !== 'string' || !value.details[key].trim()) throw new DomainValidationError(`${purpose} 提示词缺少 ${key}`)
  }
  if (typeof value.negativePrompt !== 'string') throw new DomainValidationError('negativePrompt 必须为字符串，无需时填空字符串')
  return structuredClone(value)
}

export function generationBasis(project, entity, purpose) {
  const references = (entity.referenceBindings || []).filter((item) => ENTITY_COLLECTIONS[item.kind]).map((item) => {
    const reference = entityFor(project, item.kind, item.entityId)
    return [item.kind, item.entityId, reference?.generation?.version, reference?.generation?.prompt]
  })
  const parent = entity.parentKind && entityFor(project, entity.parentKind, entity.parentId)
  return digest({ purpose, description: entity.description, name: entity.name, parent: parent && [parent.id, parent.generation?.version, parent.generation?.prompt],
    changes: entity.changes, preserve: entity.preserve, scriptRefs: entity.scriptRefs,
    script: entity.episodeId && scriptFingerprint(project.episodes[entity.episodeId]),
    shotDescription: entity.shotDescription, duration: entity.duration, audioDialogue: entity.audioDialogue, audioNotes: entity.audioNotes, references })
}

export function authoredGeneration(project, entity, purpose, value, previous, role) {
  const valid = validateGeneration(value, purpose)
  return { prompt: valid.prompt.trim(), negativePrompt: valid.negativePrompt, details: valid.details,
    status: 'ready', version: Number(previous?.version || 0) + 1, role, basis: generationBasis(project, entity, purpose) }
}

export function assertGenerationReady(project, entity, purpose) {
  const value = entity?.[entity.episodeId ? purpose === 'video' ? 'videoGeneration' : 'imageGeneration' : 'generation']
  validateGeneration(value, purpose)
  if (value.status !== 'ready' || value.basis !== generationBasis(project, entity, purpose)) throw new DomainValidationError(`${entity.id} 的${purpose === 'video' ? '视频' : '图片'}提示词需更新`)
  for (const ref of entity.scriptRefs || []) {
    if (ref.fingerprint !== scriptFingerprint(project.episodes[ref.episodeId])) throw new DomainValidationError(`${entity.id} 的剧本资产提取已过期`)
  }
  return value
}

export function generationSchema(purpose) {
  const fields = purpose === 'video' ? VIDEO_DETAILS : IMAGE_DETAILS
  return { type: 'object', additionalProperties: false, required: ['prompt', 'negativePrompt', 'details'], properties: {
    prompt: { type: 'string', description: '完整可直接生成的提示词，展开全部细节，不写引用占位符' }, negativePrompt: { type: 'string' },
    details: { type: 'object', additionalProperties: false, required: fields, properties: Object.fromEntries(fields.map((key) => [key, { type: 'string' }])) },
  } }
}
