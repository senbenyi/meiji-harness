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

/** 把领域分镜及原生声音要求编译成 H3 可执行 Prompt IR。 */
export function compileH3Prompt({ capability, prompt, references = [], storyStyle = '', audioDialogue = '', audioNotes = '', audioStrategy = 'native', speakers = [] }) {
  let source = String(prompt || '').trim()
  if (!String(capability || '').startsWith('video.')) return source
  if (audioStrategy === 'silent') source = source.replace(/<d>[^]*?<\/d>/g, 'remains silent')
  const isI2V = capability === 'video.image2video'
  const required = isI2V ? H3_I2V_SECTIONS : H3_REF_SECTIONS
  const silent = audioStrategy === 'silent'
  const dialogue = silent ? [] : String(audioDialogue || '').split('\n').map((line, index) => {
    const match = line.trim().match(/^([^：:\n]+)[：:]\s*(.+)$/)
    const speaker = match ? match[1].trim() : ''
    const words = match ? match[2].trim() : line.trim()
    if (!words || [...source.matchAll(/<d>\s*(?:\[[^\]]+\]\s*)?([^]*?)<\/d>/g)].some((entry) => entry[1].trim() === words)) return ''
    if (words.includes('<d>')) return line.trim()
    const speakerIndex = speakers.indexOf(speaker)
    const language = /[\u3400-\u9fff]/.test(words) ? 'Chinese' : 'English'
    return `(S${speakerIndex >= 0 ? speakerIndex + 1 : index + 1}) ${speaker || 'The speaking subject'} says <d>[${language}] ${words}</d>. Only this speaker moves their mouth in sync with these words; other subjects keep their mouths closed.`
  }).filter(Boolean)
  const sound = silent
    ? 'Generate a silent video: no audible dialogue, narration, music or sound effects.'
    : [
      'Generate speech and diegetic sound natively together with the video; preserve the specified speakers and exact words. Do not invent dialogue or narration.',
      String(audioNotes || '').trim(),
    ].filter(Boolean).join('\n')
  const descriptionSection = isI2V ? 'integrated_multimodal_description' : 'detailed_description'
  if (hasSections(source, required)) {
    let compiled = source
    if (silent) return compiled.replace(/overall_soundscape\s*:[^]*?(?=\n\s*non_diegetic_music\s*:)/, () => 'overall_soundscape:\n' + sound)
      .replace(/non_diegetic_music\s*:[^]*/, 'non_diegetic_music:\nN/A')
    if (dialogue.length) compiled = compiled.replace(new RegExp(`(${descriptionSection}\\s*:[^]*?)(?=\\n\\s*overall_soundscape\\s*:)`), (section) => section + '\n' + dialogue.join('\n'))
    if (dialogue.length || (audioNotes && !source.includes(String(audioNotes).trim()))) {
      compiled = compiled.replace(/overall_soundscape\s*:/, (section) => section + '\n' + sound)
    }
    return compiled
  }

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
      ...dialogue,
      'overall_soundscape:',
      sound,
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
    ...dialogue,
    'overall_soundscape:',
    sound,
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
  const speakers = [...new Set([
    ...Object.values(project.characters || {}).map((character) => character.name).filter(Boolean),
    ...Object.values(project.shots || {}).flatMap((item) => String(item.audioDialogue || '').split('\n')
      .map((line) => line.match(/^([^：:\n]+)[：:]/)?.[1].trim()).filter(Boolean)),
  ])]
  const compiledPrompt = compileH3Prompt({
    capability, prompt: combinedPrompt, references, storyStyle,
    audioDialogue: shot.audioDialogue, audioNotes: shot.audioNotes,
    audioStrategy: project.legacyCanvas?.settings?.audioMode || project.productionSpec?.audioStrategy, speakers,
  })

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
