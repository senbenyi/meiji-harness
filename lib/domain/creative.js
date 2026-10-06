import { DomainValidationError } from './errors.js'
import { invalidateDependents } from './invalidation.js'
import { validateAssetExtraction } from '../script/asset-production.js'
import { ENTITY_COLLECTIONS, authoredGeneration, scriptFingerprint, digest, entityFor, generationBasis } from '../prompts/specification.js'
import { transition } from './state-machines.js'

// Apply creative results only against the exact formal content read by the child.
export function applyCreativeProposal(project, proposal) {
  const { payload, id } = proposal
  if (proposal.kind === 'asset_prompt') {
    const entity = entityFor(project, payload.entityKind, payload.entityId)
    if (!entity || payload.basis !== generationBasis(project, entity, 'image')) throw new DomainValidationError('资产提示词编写依据已过期')
    entity.generation = authoredGeneration(project, entity, 'image', payload.generation, entity.generation, 'assets')
    invalidateDependents(project, [entity.id], 'asset prompt reauthored')
    return true
  }
  if (proposal.kind === 'asset_extraction') {
    const episodes = Object.values(project.episodes).filter((ep) => ep.id !== 'legacy-main')
    if (JSON.stringify(payload.scriptRefs) !== JSON.stringify(episodes.map((ep) => ({ episodeId: ep.id, fingerprint: scriptFingerprint(ep) })))) throw new DomainValidationError('资产提取使用了过期或不完整的正式剧本')
    validateAssetExtraction(payload, episodes)
    for (const collection of Object.values(ENTITY_COLLECTIONS)) {
      project[collection] ||= {}
      for (const previous of Object.values(project[collection])) {
        if (!payload[collection].some((entity) => entity.id === previous.id)) {
          previous.retired = true
          invalidateDependents(project, [previous.id], 'asset removed from script')
        }
      }
      for (const entity of payload[collection]) {
        const previous = project[collection][entity.id]
        const scriptRefs = payload.scriptRefs.filter((ref) => entity.usages.some((use) => use.episodeId === ref.episodeId))
        const next = { ...previous, ...entity, retired: false, scriptRefs, proposalId: id,
          dependsOn: [...scriptRefs.map((ref) => ref.episodeId), ...(entity.parentId ? [entity.parentId] : [])] }
        next.generation = authoredGeneration(project, next, 'image', entity.generation, previous?.generation, 'assets')
        project[collection][entity.id] = next
        if (previous) invalidateDependents(project, [entity.id], 'asset design replaced')
      }
    }
    return true
  }
  if (proposal.kind === 'shot_prompts') {
    const episode = project.episodes[payload.episodeId]
    if (!episode || payload.scriptFingerprint !== scriptFingerprint(episode) || payload.shotFingerprint !== shotPlanFingerprint(project, episode)) throw new DomainValidationError('提示词编写使用了过期镜头计划')
    const expected = [...episode.shotIds].sort()
    if (JSON.stringify(payload.shots?.map((s) => s.id).sort()) !== JSON.stringify(expected)) throw new DomainValidationError('提示词必须逐一覆盖本集镜头，不得遗漏、重复或越界')
    for (const item of payload.shots) {
      const shot = project.shots[item.id]
      for (const [key, purpose, role] of [['imageGeneration', 'image', 'storyboard'], ['videoGeneration', 'video', 'shot']]) {
        if (!item[key]) throw new DomainValidationError(`镜头缺少 ${key}`)
        shot[key] = authoredGeneration(project, shot, purpose, item[key], shot[key], role)
      }
      shot.prompt = shot.videoGeneration.prompt
      invalidateDependents(project, [shot.id], 'shot prompts authored')
    }
    return true
  }
  return false
}

export function shotPlanFingerprint(project, episode) {
  return digest((episode.shotIds || []).map((id) => {
    const s = project.shots[id]
    return [id, s.shotDescription, s.duration, s.audioDialogue, s.audioNotes, (s.referenceBindings || []).map(({ kind, entityId }) => [kind, entityId])]
  }))
}

export function editGeneration(project, kind, id, values) {
  const asset = kind === 'asset-prompt'
  const purpose = kind === 'video-prompt' ? 'video' : 'image'
  const target = asset ? Object.values(ENTITY_COLLECTIONS).map((key) => project[key]?.[id]).find(Boolean) : project.shots[id]
  if (!target) throw new DomainValidationError('提示词目标不存在')
  const key = asset ? 'generation' : purpose === 'video' ? 'videoGeneration' : 'imageGeneration'
  const { prompt, negativePrompt, ...details } = values
  if (JSON.stringify({ prompt, negativePrompt, details }) === JSON.stringify({ prompt: target[key]?.prompt, negativePrompt: target[key]?.negativePrompt, details: target[key]?.details })) return
  target[key] = authoredGeneration(project, target, purpose, { prompt, negativePrompt, details }, target[key], 'operator')
  if (purpose === 'video') {
    target.prompt = prompt
    const output = project.assets[target.approvedAssetId]
    if (output) {
      if (output.status !== 'invalidated') project.assets[output.id] = transition(output, 'asset', 'invalidated')
      invalidateDependents(project, [output.id], 'video prompt edited')
    }
    if (target.status !== 'invalidated') project.shots[id] = transition(target, 'shot', 'invalidated')
  } else invalidateDependents(project, [id], 'image prompt edited')
}
