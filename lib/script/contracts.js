import { DomainValidationError } from '../domain/errors.js'

export const DEVELOPMENT_PROPOSAL_KINDS = ['content_analysis', 'asset_design', 'asset_extraction', 'asset_prompt', 'shot_prompts', 'episode_plan', 'episode_draft', 'episode_script']

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainValidationError(`${label} must be an object`)
  return value
}

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new DomainValidationError(`${label} must be a non-empty string`)
  return value.trim()
}

function list(value, label) {
  if (!Array.isArray(value)) throw new DomainValidationError(`${label} must be an array`)
  return value
}

function citations(value = [], label = 'citations') {
  return list(value, label).map((item, index) => {
    object(item, `${label}[${index}]`)
    const start = Number(item.start)
    const end = Number(item.end)
    if (!item.sourceId || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
      throw new DomainValidationError(`${label}[${index}] must contain sourceId and a valid start/end range`)
    }
    return { sourceId: String(item.sourceId), start, end }
  })
}

function requiredCitations(value, label) {
  const normalized = citations(value, label)
  if (!normalized.length) throw new DomainValidationError(`${label} must not be empty`)
  return normalized
}

function contentAnalysis(payload) {
  object(payload, 'content analysis')
  object(payload.storyBible, 'content analysis storyBible')
  return {
    summary: text(payload.summary, 'content analysis summary'),
    storyBible: structuredClone(payload.storyBible),
    characters: list(payload.characters || [], 'content analysis characters').map((item, index) => {
      object(item, `characters[${index}]`)
      return { ...structuredClone(item), id: text(item.id, `characters[${index}].id`), name: text(item.name, `characters[${index}].name`) }
    }),
    locations: list(payload.locations || [], 'content analysis locations').map((item, index) => {
      object(item, `locations[${index}]`)
      return { ...structuredClone(item), id: text(item.id, `locations[${index}].id`), name: text(item.name, `locations[${index}].name`) }
    }),
    beats: list(payload.beats || [], 'content analysis beats').map((item) => structuredClone(object(item, 'content analysis beat'))),
    citations: requiredCitations(payload.citations, 'content analysis citations'),
  }
}

function episodePlan(payload) {
  object(payload, 'episode plan')
  const episodes = list(payload.episodes, 'episode plan episodes')
  if (!episodes.length) throw new DomainValidationError('episode plan episodes must not be empty')
  const normalized = {
    episodes: episodes.map((item, index) => {
      object(item, `episodes[${index}]`)
      const order = Number(item.order)
      if (!Number.isInteger(order) || order < 1) throw new DomainValidationError(`episodes[${index}].order must be a positive integer`)
      return {
        ...structuredClone(item),
        id: text(item.id, `episodes[${index}].id`),
        order,
        title: text(item.title, `episodes[${index}].title`),
        outline: text(item.outline, `episodes[${index}].outline`),
        sourceSpans: requiredCitations(item.sourceSpans, `episodes[${index}].sourceSpans`),
      }
    }),
  }
  if (new Set(normalized.episodes.map((item) => item.id)).size !== normalized.episodes.length) throw new DomainValidationError('episode plan episode ids must be unique')
  if (new Set(normalized.episodes.map((item) => item.order)).size !== normalized.episodes.length) throw new DomainValidationError('episode plan episode orders must be unique')
  normalized.episodes.sort((a, b) => a.order - b.order)
  return normalized
}

function episodeScript(payload) {
  object(payload, 'episode script')
  const shots = list(payload.shots, 'episode script shots')
  if (!shots.length) throw new DomainValidationError('episode script shots must not be empty')
  const normalized = {
    episodeId: text(payload.episodeId, 'episode script episodeId'),
    ...(payload.draftProposalId ? { draftProposalId: text(payload.draftProposalId, 'episode script draftProposalId') } : {}),
    script: text(payload.script, 'episode script script'),
    sourceSpans: requiredCitations(payload.sourceSpans, 'episode script sourceSpans'),
    shots: shots.map((item, index) => {
      object(item, `shots[${index}]`)
      const order = Number(item.order ?? index + 1)
      const duration = Number(item.duration ?? item.durationSeconds)
      if (!Number.isInteger(order) || order < 1) throw new DomainValidationError(`shots[${index}].order must be a positive integer`)
      if (!(duration > 0)) throw new DomainValidationError(`shots[${index}].duration must be greater than zero`)
      return {
        ...structuredClone(item),
        order,
        duration,
        title: text(item.title || `镜头 ${order}`, `shots[${index}].title`),
        shotDescription: text(item.shotDescription, `shots[${index}].shotDescription`),
        prompt: String(item.prompt || item.shotDescription).trim(),
        audioDialogue: item.audioDialogue == null ? null : String(item.audioDialogue),
        audioNotes: item.audioNotes == null ? null : String(item.audioNotes),
        referenceBindings: Array.isArray(item.referenceBindings) ? structuredClone(item.referenceBindings) : [],
      }
    }),
  }
  if (new Set(normalized.shots.map((item) => item.order)).size !== normalized.shots.length) throw new DomainValidationError('episode script shot orders must be unique')
  const draftIds = normalized.shots.map((item) => String(item.id || item.order))
  if (new Set(draftIds).size !== draftIds.length) throw new DomainValidationError('episode script shot ids must be unique')
  normalized.shots.sort((a, b) => a.order - b.order)
  return normalized
}

export function validateSourceRefs(value) {
  const refs = list(value, 'sourceRefs')
  if (!refs.length) throw new DomainValidationError('sourceRefs must not be empty')
  return refs.map((item, index) => {
    object(item, `sourceRefs[${index}]`)
    const sourceId = text(item.sourceId, `sourceRefs[${index}].sourceId`)
    const contentHash = text(item.contentHash, `sourceRefs[${index}].contentHash`)
    return { sourceId, contentHash }
  })
}

export function validateDevelopmentPayload(kind, payload) {
  if (!DEVELOPMENT_PROPOSAL_KINDS.includes(kind)) throw new DomainValidationError(`unsupported development proposal kind: ${kind}`)
  if (['asset_extraction', 'asset_prompt', 'shot_prompts'].includes(kind)) return structuredClone(object(payload, kind))
  if (kind === 'content_analysis') return contentAnalysis(payload)
  if (kind === 'asset_design') {
    object(payload, 'asset design')
    return {
      analysisProposalId: text(payload.analysisProposalId, 'asset design analysisProposalId'),
      ...Object.fromEntries(['characters', 'locations'].map((key) => [key, list(payload[key], key).map((item) => {
        object(item, key)
        if (Object.keys(item).some((field) => !['id', 'visualDescription'].includes(field))) throw new DomainValidationError('asset design may only change visualDescription')
        return { id: text(item.id, `${key}.id`), visualDescription: text(item.visualDescription, `${key}.visualDescription`) }
      })])),
    }
  }
  if (kind === 'episode_plan') return episodePlan(payload)
  if (kind === 'episode_draft') {
    object(payload, 'episode draft')
    if ('shots' in payload) throw new DomainValidationError('script subagent cannot submit shots')
    return { episodeId: text(payload.episodeId, 'episode draft episodeId'), script: text(payload.script, 'episode draft script'), beatIds: list(payload.beatIds, 'episode draft beatIds').map((id) => text(id, 'beat id')), sourceSpans: requiredCitations(payload.sourceSpans, 'episode draft sourceSpans') }
  }
  return episodeScript(payload)
}

export function developmentCitations(kind, payload) {
  if (kind === 'content_analysis') return payload.citations
  if (['asset_design', 'asset_extraction', 'asset_prompt', 'shot_prompts'].includes(kind)) return []
  if (kind === 'episode_plan') return payload.episodes.flatMap((episode) => episode.sourceSpans)
  return payload.sourceSpans
}
