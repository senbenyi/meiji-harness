import { DomainNotFoundError, DomainValidationError } from '../domain/errors.js'
import { createPromptSnapshot } from './snapshot.js'

const COLLECTIONS = {
  character: 'characters',
  location: 'locations',
  asset: 'assets',
  continuity: 'shots',
}

function promptText(entity) {
  for (const key of ['prompt', 'visualPrompt', 'visualStyle', 'appearance', 'description', 'name', 'title']) {
    if (typeof entity?.[key] === 'string' && entity[key].trim()) return entity[key].trim()
  }
  return ''
}

function resolveReference(project, binding) {
  const kind = String(binding?.kind || '')
  const collection = COLLECTIONS[kind]
  if (!collection) throw new DomainValidationError(`invalid reference binding kind: ${kind || '(empty)'}`)
  const entityId = String(binding.entityId || '')
  if (!entityId) throw new DomainValidationError('reference binding entityId required')
  const entity = project[collection]?.[entityId]
  if (!entity) throw new DomainNotFoundError(`${collection} not found: ${entityId}`)

  const assetId = binding.assetId || (kind === 'asset' ? entityId : kind === 'continuity' ? entity.approvedAssetId : null)
  const asset = assetId ? project.assets?.[assetId] : null
  if (assetId && !asset) throw new DomainNotFoundError(`assets not found: ${assetId}`)
  if (asset && asset.status !== 'approved') throw new DomainValidationError(`reference asset must be approved: ${asset.id}`)
  if (binding.required === true && (kind === 'asset' || binding.assetId) && !asset) throw new DomainValidationError(`required reference asset missing: ${entityId}`)

  return {
    kind,
    entityId,
    role: String(binding.role || ''),
    required: binding.required === true,
    assetId: asset?.id || null,
    assetHash: asset?.contentHash || '',
    promptText: promptText(entity),
  }
}

const H3_REF_SECTIONS = ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music']
const H3_I2V_SECTIONS = ['integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music']

function hasSections(prompt, sections) {
  return sections.every((section) => new RegExp(`(^|\\n)\\s*${section}\\s*:`, 'm').test(prompt))
}

/** 把领域分镜编译成 H3 可执行 Prompt IR；已结构化输入保持不变。 */
export function compileH3Prompt({ capability, prompt, references = [], storyStyle = '' }) {
  const source = String(prompt || '').trim()
  if (!String(capability || '').startsWith('video.')) return source
  const isI2V = capability === 'video.image2video'
  const required = isI2V ? H3_I2V_SECTIONS : H3_REF_SECTIONS
  if (hasSections(source, required)) return source

  const subjects = references.map((ref, index) => {
    const role = ref.role || ref.kind
    const detail = ref.promptText || ref.entityId
    return `<Subject ${index + 1}> is the ${role} reference from <Picture ${index + 1}>: ${detail}.`
  }).join('\n') || '<Subject 1> is the primary subject described by the shot.'
  const style = storyStyle ? ` Preserve the project visual style: ${storyStyle}.` : ''

  if (isI2V) {
    return [
      'For the target video, <Picture 1> defines the opening frame and must remain aligned with the first shot.',
      'integrated_multimodal_description:',
      `[Shot 1] ${source}${style}`,
      'overall_soundscape:',
      'Preserve diegetic ambience and any dialogue explicitly described in the shot; do not invent narration.',
      'non_diegetic_music:',
      'N/A',
    ].join('\n')
  }

  return [
    'subject_definitions:',
    subjects,
    'summary:',
    `[reference generation] ${source}`,
    'retention_analysis:',
    references.length
      ? references.map((_, index) => `<Picture ${index + 1}>: preserve the bound subject identity and role throughout [Shot 1].`).join('\n')
      : '<Subject 1>: preserve identity, costume, and scene continuity throughout [Shot 1].',
    'detailed_description:',
    `[Shot 1] ${source}${style}`,
    'overall_soundscape:',
    'Preserve diegetic ambience and any dialogue explicitly described in the shot; do not invent narration.',
    'non_diegetic_music:',
    'N/A',
  ].join('\n')
}

export function compilePromptSnapshot({ project, shotId, capability, tier = 'default', workflowFingerprint = '', prompt, negativePrompt, parameters = {} }) {
  const shot = project.shots?.[shotId]
  if (!shot) throw new DomainNotFoundError(`shots not found: ${shotId}`)
  const references = (shot.referenceBindings || []).map((binding) => resolveReference(project, binding))
  const basePrompt = String(prompt ?? shot.prompt ?? '')
  if (!basePrompt.trim()) throw new DomainValidationError(`shot prompt required: ${shotId}`)
  const storyStyle = promptText(project.storyBible)
  const referenceContext = references.map((item) => item.promptText).filter(Boolean)
  const isVideo = String(capability || '').startsWith('video.')
  const combinedPrompt = [basePrompt.trim(), ...(isVideo ? [] : [storyStyle]), ...referenceContext].filter(Boolean).join('\n')
  const compiledPrompt = compileH3Prompt({ capability, prompt: combinedPrompt, references, storyStyle })

  return createPromptSnapshot({
    projectRevision: project.revision,
    shotId,
    prompt: compiledPrompt,
    negativePrompt: negativePrompt ?? shot.negativePrompt ?? '',
    references: references.map(({ promptText: _promptText, ...reference }) => reference),
    parameters,
    capabilityKey: `${capability}:${tier || 'default'}`,
    workflowFingerprint,
  })
}
