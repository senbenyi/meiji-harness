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

export function compilePromptSnapshot({ project, shotId, capability, tier = 'default', workflowFingerprint = '', prompt, negativePrompt, parameters = {} }) {
  const shot = project.shots?.[shotId]
  if (!shot) throw new DomainNotFoundError(`shots not found: ${shotId}`)
  const references = (shot.referenceBindings || []).map((binding) => resolveReference(project, binding))
  const basePrompt = String(prompt ?? shot.prompt ?? '')
  if (!basePrompt.trim()) throw new DomainValidationError(`shot prompt required: ${shotId}`)
  const storyStyle = promptText(project.storyBible)
  const referenceContext = references.map((item) => item.promptText).filter(Boolean)
  const compiledPrompt = [basePrompt.trim(), storyStyle, ...referenceContext].filter(Boolean).join('\n')

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
