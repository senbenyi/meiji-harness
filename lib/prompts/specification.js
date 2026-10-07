import { createHash } from 'node:crypto'
import { DomainValidationError } from '../domain/errors.js'
import { productionOutputSchema } from '../script/production-schemas.js'

export const ENTITY_COLLECTIONS = { character: 'characters', location: 'locations', prop: 'props', variant: 'assetVariants' }
export const IMAGE_DETAILS = ['subject', 'appearance', 'composition', 'lighting', 'style', 'constraints']
export const VIDEO_DETAILS = ['subject', 'action', 'camera', 'timing', 'continuity', 'sound']
export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const entityFor = (project, kind, id) => project[ENTITY_COLLECTIONS[kind]]?.[id]
export const scriptFingerprint = (episode) => digest([episode?.script, episode?.sourceSpans, episode?.analysisProposalId])

// A shot uses one visible state per asset; base definitions remain in its dependency graph.
export function visibleReferenceBindings(project, shot) {
  const bindings = shot.referenceBindings || []
  const overridden = new Set()
  for (const binding of bindings.filter((item) => item.kind === 'variant')) {
    const variant = entityFor(project, 'variant', binding.entityId)
    if (!variant) throw new DomainValidationError(`衍生资产不存在：${binding.entityId}`)
    const key = `${variant.parentKind}:${variant.parentId}`
    if (overridden.has(key)) throw new DomainValidationError(`同一镜头不能同时使用本体的多个视觉状态：${variant.parentId}`)
    overridden.add(key)
  }
  return bindings
    .filter((binding) => !overridden.has(`${binding.kind}:${binding.entityId}`))
    .map((binding) => ({
      ...binding,
      // A shot owns the stable semantic reference. The entity owns whichever
      // approved image currently realizes that reference.
      assetId: entityFor(project, binding.kind, binding.entityId)?.referenceAssetId || null,
    }))
}

export function validateGeneration(value, purpose) {
  if (!value || typeof value.prompt !== 'string' || !value.prompt.trim()) throw new DomainValidationError(`${purpose} 提示词尚未编写`)
  for (const key of purpose === 'video' ? VIDEO_DETAILS : IMAGE_DETAILS) {
    if (typeof value.details?.[key] !== 'string' || !value.details[key].trim()) throw new DomainValidationError(`${purpose} 提示词缺少 ${key}`)
  }
  if (typeof value.negativePrompt !== 'string') throw new DomainValidationError('negativePrompt 必须为字符串，无需时填空字符串')
  return structuredClone(value)
}

/** Source-grounded recovery for a missing creative prompt; never invents story facts. */
export function groundedGenerationFallback(purpose, input) {
  const subject = String(input.subject || '').trim()
  const description = String(input.description || subject).trim()
  const constraints = String(input.constraints || '严格保持已批准设定与引用，不添加文字、水印或未提供的内容').trim()
  const value = purpose === 'video'
    ? {
        prompt: [description, input.action, input.camera, input.timing, input.continuity, input.sound].filter(Boolean).join('；'),
        negativePrompt: '身份漂移，场景跳变，动作断裂，镜头抖动，文字，水印',
        details: {
          subject: subject || description,
          action: String(input.action || description),
          camera: String(input.camera || '保持既定镜头构图与机位'),
          timing: String(input.timing || '按既定镜头时长完成动作'),
          continuity: String(input.continuity || constraints),
          sound: String(input.sound || '无额外声音'),
        },
      }
    : {
        prompt: [subject, description, input.composition, input.lighting, input.style, constraints].filter(Boolean).join('；'),
        negativePrompt: '低清晰度，身份漂移，结构错误，多余人物，文字，水印',
        details: {
          subject: subject || description,
          appearance: description,
          composition: String(input.composition || '完整清晰展示主体，构图稳定'),
          lighting: String(input.lighting || '沿用场景既定光照'),
          style: String(input.style || '沿用项目既定视觉风格'),
          constraints,
        },
      }
  return validateGeneration(value, purpose)
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
  if (!entity.episodeId && !entity.scriptRefs?.length) throw new DomainValidationError(`${entity.id} 缺少正式剧本资产提取依据`)
  if (value.status !== 'ready' || value.basis !== generationBasis(project, entity, purpose)) throw new DomainValidationError(`${entity.id} 的${purpose === 'video' ? '视频' : '图片'}提示词需更新`)
  for (const ref of entity.scriptRefs || []) {
    if (ref.fingerprint !== scriptFingerprint(project.episodes[ref.episodeId])) throw new DomainValidationError(`${entity.id} 的剧本资产提取已过期`)
  }
  return value
}

export function generationSchema(purpose) {
  return productionOutputSchema(purpose === 'video' ? 'video-generation' : 'image-generation')
}
