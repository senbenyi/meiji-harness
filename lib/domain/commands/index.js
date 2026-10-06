import { randomUUID } from 'node:crypto'
import { DomainNotFoundError, DomainValidationError } from '../errors.js'
import { assertDeliverableReady, assertRightsGate, assertTimelineAssets, assertProductionStages, isPreparedImage, preparationSignature } from '../policies.js'
import { invalidateDependents } from '../invalidation.js'
import { transition } from '../state-machines.js'
import { validatePromptSnapshot } from '../../prompts/snapshot.js'
import { developmentCitations, validateDevelopmentPayload, validateSourceRefs } from '../../script/contracts.js'
import { productionCommandHandlers } from '../production.js'
import { assertReworkIdle, editableValues } from '../rework.js'
import { reworkTasks } from '../../production/rework.js'

const now = () => new Date().toISOString()
const idOf = (payload, field) => String(payload[field] || payload.id || randomUUID())

function required(project, collection, id) {
  const entity = project[collection]?.[id]
  if (!entity) throw new DomainNotFoundError(`${collection} not found: ${id}`)
  return entity
}

function upsert(project, collection, payload, defaults = {}) {
  const id = idOf(payload, `${collection.replace(/s$/, '')}Id`)
  const timestamp = now()
  project[collection][id] = {
    ...defaults,
    ...project[collection][id],
    ...payload,
    id,
    updatedAt: timestamp,
    createdAt: project[collection][id]?.createdAt || timestamp,
  }
  return { id }
}

function createOutbox(project, type, payload, commandId) {
  const id = randomUUID()
  project.outboxEvents[id] = {
    id, type, payload, status: 'pending', retryCount: 0, maxRetries: 5,
    lastError: null, externalRef: null, commandId, createdAt: now(), processedAt: null,
  }
  return id
}

function currentSourceRefs(project, value) {
  const refs = validateSourceRefs(value)
  for (const ref of refs) {
    const source = required(project, 'sourceDocuments', ref.sourceId)
    if (source.supersededBy || source.contentHash !== ref.contentHash) throw new DomainValidationError(`source document hash is stale: ${ref.sourceId}`)
  }
  return refs
}

function developmentProposalInput(project, kind, rawPayload, rawSourceRefs) {
  const sourceRefs = currentSourceRefs(project, rawSourceRefs)
  const sourceIds = sourceRefs.map((ref) => ref.sourceId)
  const payload = validateDevelopmentPayload(kind, rawPayload)
  for (const citation of developmentCitations(kind, payload)) {
    if (!sourceIds.includes(citation.sourceId)) throw new DomainValidationError(`citation source is not declared in sourceRefs: ${citation.sourceId}`)
    const source = required(project, 'sourceDocuments', citation.sourceId)
    if (citation.end > source.characters) throw new DomainValidationError(`citation exceeds source length: ${citation.sourceId}`)
  }
  return { payload, sourceRefs, sourceIds }
}

function invalidateEpisodeShots(project, episode, reason) {
  const shotIds = [...(episode.shotIds || [])]
  for (const shotId of shotIds) {
    const shot = project.shots[shotId]
    if (shot && shot.status !== 'invalidated') project.shots[shotId] = transition(shot, 'shot', 'invalidated', { invalidationReason: reason })
  }
  invalidateDependents(project, shotIds, reason)
  return shotIds
}

function applyDevelopmentProposal(project, proposal, timestamp) {
  const { payload, sourceRefs, sourceIds } = developmentProposalInput(project, proposal.kind, proposal.payload, proposal.sourceRefs)

  if (proposal.kind === 'content_analysis') {
    const previousBible = project.storyBible
    if (previousBible) invalidateDependents(project, [previousBible.id], 'content analysis replaced')
    if (previousBible) for (const episode of Object.values(project.episodes)) {
      if (episode.id !== 'legacy-main') invalidateEpisodeShots(project, episode, 'content analysis replaced')
    }
    project.storyBible = {
      ...previousBible, ...payload.storyBible,
      id: payload.storyBible.id || previousBible?.id || randomUUID(),
      summary: payload.summary, sourceRefs, dependsOn: sourceIds, proposalId: proposal.id, updatedAt: timestamp,
    }
    for (const character of payload.characters) {
      const previous = project.characters[character.id]
      upsert(project, 'characters', { ...character, sourceRefs, dependsOn: sourceIds, proposalId: proposal.id })
      if (previous) invalidateDependents(project, [character.id], 'content analysis character changed')
    }
    for (const location of payload.locations) {
      const previous = project.locations[location.id]
      upsert(project, 'locations', { ...location, sourceRefs, dependsOn: sourceIds, proposalId: proposal.id })
      if (previous) invalidateDependents(project, [location.id], 'content analysis location changed')
    }
  } else if (proposal.kind === 'episode_plan') {
    const plannedIds = new Set(payload.episodes.map((episode) => episode.id))
    for (const previous of Object.values(project.episodes)) {
      if (previous.id === 'legacy-main' || plannedIds.has(previous.id)) continue
      project.contentRevisions ||= {}
      project.contentRevisions[`${proposal.id}:${previous.id}`] = { kind: 'outline', id: previous.id, before: structuredClone(previous), createdAt: timestamp }
      invalidateEpisodeShots(project, previous, 'episode removed by new plan')
      for (const shotId of previous.shotIds || []) project.shots[shotId].supersededBy = proposal.id
      delete project.episodes[previous.id]
    }
    for (const episode of payload.episodes) {
      const previous = project.episodes[episode.id]
      const changed = previous && (previous.outline !== episode.outline || previous.order !== episode.order || JSON.stringify(previous.beatIds) !== JSON.stringify(episode.beatIds) || JSON.stringify(previous.sourceSpans) !== JSON.stringify(episode.sourceSpans))
      if (changed && previous.status === 'cancelled') throw new DomainValidationError(`episode plan cannot replace terminal episode: ${previous.status}`)
      if (changed) invalidateEpisodeShots(project, previous, 'episode plan replaced')
      upsert(project, 'episodes', {
        ...episode, sourceRefs, dependsOn: sourceIds, proposalId: proposal.id,
        ...(changed ? { script: null, shotIds: [], sceneSequence: [], status: 'planning' } : {}),
      }, { status: 'draft', shotIds: [] })
    }
  } else {
    const episode = required(project, 'episodes', payload.episodeId)
    if (payload.script === episode.outline) throw new DomainValidationError('formal script cannot be replaced by episode outline')
    if (episode.beatIds?.length) {
      const covered = new Set(payload.shots.flatMap((shot) => shot.beatIds || []))
      if (episode.beatIds.some((id) => !covered.has(id)) || [...covered].some((id) => !episode.beatIds.includes(id))) throw new DomainValidationError('episode shots do not cover the planned story beats')
    }
    if (episode.status === 'cancelled') throw new DomainValidationError(`episode script cannot replace terminal episode: ${episode.status}`)
    invalidateEpisodeShots(project, episode, 'episode script replaced')

    const scriptVersion = Number(episode.scriptVersion || 0) + 1
    const idMap = new Map(payload.shots.map((shot) => [String(shot.id || shot.order), `${episode.id}-script-v${String(scriptVersion).padStart(3, '0')}-shot-${String(shot.order).padStart(3, '0')}`]))
    const shotIds = payload.shots.map((shot) => idMap.get(String(shot.id || shot.order)))
    for (const [index, shot] of payload.shots.entries()) {
      const id = shotIds[index]
      const continuityFrom = shot.continuityFrom == null ? null : idMap.get(String(shot.continuityFrom))
      if (shot.continuityFrom != null && !continuityFrom) throw new DomainValidationError(`shot continuityFrom is not in proposal: ${shot.continuityFrom}`)
      const bindings = shot.referenceBindings || []
      const bindingDependencies = bindings.flatMap((binding) => [binding?.entityId, binding?.assetId]).filter(Boolean).map(String)
      project.shots[id] = {
        ...shot, id, episodeId: episode.id, status: 'planned', continuityFrom, scriptVersion,
        referenceBindings: bindings, dependsOn: [...new Set([...sourceIds, ...bindingDependencies, ...(continuityFrom ? [continuityFrom] : [])])],
        attemptIds: [], assetIds: [], approvedAssetId: null, sourceRefs, proposalId: proposal.id, analysisProposalId: project.storyBible?.proposalId,
        createdAt: timestamp, updatedAt: timestamp,
      }
    }
    project.episodes[episode.id] = {
      ...episode, script: payload.script, sourceSpans: payload.sourceSpans, sourceRefs,
      shotIds, sceneSequence: shotIds, scriptVersion, status: 'storyboard', proposalId: proposal.id, analysisProposalId: project.storyBible?.proposalId, updatedAt: timestamp,
    }
  }
}

function applyReviewDecision(project, task, { decision, decisionId = randomUUID(), reason = '', answerer = 'user', timestamp = now() }) {
  const proposal = task.targetType === 'development_proposal' ? required(project, 'developmentProposals', task.targetId) : null
  if (proposal && decision === 'approved') applyDevelopmentProposal(project, proposal, timestamp)
  project.reviewDecisions[decisionId] = {
    id: decisionId, reviewTaskId: task.id, decision, reason, answerer,
    targetRevision: project.revision, createdAt: timestamp,
  }
  project.reviewTasks[task.id] = transition(task, 'review', decision, { decisionId })
  if (proposal) {
    project.developmentProposals[proposal.id] = { ...proposal, status: decision, decisionId, updatedAt: timestamp }
  }
  if (task.targetType === 'asset' && project.assets[task.targetId]) {
    const asset = project.assets[task.targetId]
    project.assets[asset.id] = transition(asset, 'asset', decision, decision === 'approved' ? { approvedAt: timestamp } : {})
    const shot = Object.values(project.shots).find((item) => item.assetIds?.includes(task.targetId))
    if (shot) {
      project.shots[shot.id] = transition(shot, 'shot', decision === 'approved' ? 'approved' : 'ready', {
        approvedAssetId: decision === 'approved' ? task.targetId : null,
      })
    }
  }
  return decisionId
}

export const commandHandlers = {
  ...productionCommandHandlers,
  registerSourceDocument(project, payload) {
    const id = idOf(payload, 'sourceId')
    if (project.sourceDocuments[id]) throw new DomainValidationError(`source document is immutable and already exists: ${id}`)
    if (!payload.logicalKey || !payload.contentHash || !(Number(payload.bytes) > 0) || !(Number(payload.characters) > 0)) throw new DomainValidationError('source document descriptor is incomplete')
    const timestamp = now()
    project.sourceDocuments[id] = {
      id, title: String(payload.title || id), format: payload.format || 'text', logicalKey: payload.logicalKey,
      contentHash: payload.contentHash, bytes: Number(payload.bytes), characters: Number(payload.characters), createdAt: timestamp, updatedAt: timestamp,
    }
    return { sourceId: id, contentHash: payload.contentHash }
  },

  submitDevelopmentProposal(project, payload) {
    const id = idOf(payload, 'proposalId')
    if (project.developmentProposals[id]) throw new DomainValidationError(`development proposal already exists: ${id}`)
    const { payload: normalizedPayload, sourceRefs } = developmentProposalInput(project, payload.kind, payload.payload, payload.sourceRefs)
    const timestamp = now()
    const reviewTaskId = randomUUID()
    project.developmentProposals[id] = {
      id, kind: payload.kind, status: 'awaiting_human', sourceRefs, payload: normalizedPayload,
      reviewTaskId, decisionId: null, createdAt: timestamp, updatedAt: timestamp,
    }
    project.reviewTasks[reviewTaskId] = {
      id: reviewTaskId, targetType: 'development_proposal', targetId: id, status: 'awaiting_human',
      automatedChecks: [], decisionId: null, createdAt: timestamp, updatedAt: timestamp,
    }
    return { proposalId: id, reviewTaskId }
  },

  updateProductionSpec(project, payload) {
    project.productionSpec = { ...project.productionSpec, ...payload }
    if (project.status === 'draft') {
      const updated = transition(project, 'project', 'active')
      Object.assign(project, updated)
    }
    return { productionSpec: project.productionSpec }
  },

  upsertStoryBible(project, payload) {
    const previous = project.storyBible
    project.storyBible = { ...previous, ...payload, id: payload.id || previous?.id || randomUUID(), updatedAt: now() }
    const invalidated = previous ? invalidateDependents(project, [previous.id], 'story bible changed') : []
    if (previous && ['summary', 'visualStyle'].some((key) => payload[key] !== undefined && payload[key] !== previous[key])) {
      for (const episode of Object.values(project.episodes)) {
        if (episode.id === 'legacy-main') continue
        invalidated.push(...invalidateEpisodeShots(project, episode, 'story bible changed'))
        project.episodes[episode.id] = { ...project.episodes[episode.id], analysisProposalId: null }
      }
    }
    return { storyBibleId: project.storyBible.id, invalidated }
  },

  editProductionContent(project, payload, meta) {
    assertReworkIdle(project)
    const { kind, id } = payload
    const values = kind === 'source' ? payload.values : editableValues(project, payload, payload.values || {})
    const timestamp = now()
    project.contentRevisions ||= {}
    const before = kind === 'analysis' ? project.storyBible : kind === 'character' ? project.characters[id] : kind === 'location' ? project.locations[id] : kind === 'outline' || kind === 'script' ? project.episodes[id] : ['shot', 'video'].includes(kind) ? project.shots[id] : kind === 'source' ? project.sourceDocuments[id] : project.productionSpec
    project.contentRevisions[meta.commandId] = { kind, id, before: structuredClone(before), createdAt: timestamp }
    if (kind === 'analysis') commandHandlers.upsertStoryBible(project, { summary: values.summary })
    else if (kind === 'character') commandHandlers.upsertCharacter(project, { id, ...values })
    else if (kind === 'location') commandHandlers.upsertLocation(project, { id, ...values })
    else if (kind === 'outline' || kind === 'script') {
      const episode = required(project, 'episodes', id)
      if (kind === 'outline') {
        if (values.outline !== episode.outline) {
          invalidateEpisodeShots(project, episode, 'episode outline edited')
          project.episodes[id] = { ...episode, ...values, script: null, status: 'planning', updatedAt: timestamp }
        } else project.episodes[id] = { ...episode, ...values, updatedAt: timestamp }
      } else {
        const proposal = { id: `${meta.commandId}:proposal`, kind: 'episode_script', sourceRefs: episode.sourceRefs, payload: { episodeId: id, script: values.script, sourceSpans: episode.sourceSpans, shots: values.shots } }
        applyDevelopmentProposal(project, proposal, timestamp)
        project.developmentProposals[proposal.id] = { ...proposal, status: 'approved', createdAt: timestamp, approvedBy: 'user-edit' }
      }
    } else if (['shot', 'video'].includes(kind)) {
      const shot = required(project, 'shots', id)
      const { script, ...shotValues } = values
      const narrativeChanged = ['shotDescription', 'audioDialogue', 'audioNotes', 'duration'].some((key) => shotValues[key] !== undefined && shotValues[key] !== shot[key])
      const episode = required(project, 'episodes', shot.episodeId)
      if (narrativeChanged && (!script || script === episode.script)) throw new DomainValidationError('镜头内容已改变，请同步修改本集正式剧本后保存')
      commandHandlers.upsertShot(project, { ...shotValues, id, episodeId: shot.episodeId })
      if (script && script !== episode.script) project.episodes[episode.id] = { ...project.episodes[episode.id], script, updatedAt: timestamp }
    } else if (kind === 'delivery') {
      project.title = values.title
      if (project.productionSpec.assemblyStrategy !== values.strategy) {
        project.productionSpec.assemblyStrategy = values.strategy
        invalidateDependents(project, Object.keys(project.timelines), 'assembly settings edited')
      }
    } else if (kind === 'source') {
      const source = required(project, 'sourceDocuments', id)
      commandHandlers.registerSourceDocument(project, values)
      project.sourceDocuments[id] = { ...source, supersededBy: values.sourceId }
      project.activeSourceId = values.sourceId
      invalidateDependents(project, [id], 'source replaced')
    }
    return { kind, id, saved: true }
  },

  requestProductionRework(project, payload, meta) {
    assertReworkIdle(project)
    const runId = `rework:${meta.commandId}`
    const tasks = reworkTasks(project, { ...payload, runId })
    const invalidateAsset = (id) => {
      const asset = project.assets[id]
      if (asset && !['invalidated', 'archived'].includes(asset.status)) project.assets[id] = transition(asset, 'asset', 'invalidated')
      if (asset) invalidateDependents(project, [id], 'regeneration requested')
    }
    for (const task of tasks) {
      if (task.kind === 'render-reference') {
        const entity = project[task.input.preparationKind === 'character' ? 'characters' : 'locations'][task.scopeId]
        invalidateAsset(entity.referenceAssetId)
      } else if (['render-shot', 'render-storyboard'].includes(task.kind)) {
        const shot = project.shots[task.scopeId]
        invalidateAsset(task.kind === 'render-shot' ? shot.approvedAssetId : shot.storyboardAssetId)
        if (task.kind === 'render-shot' && shot.status !== 'invalidated') project.shots[shot.id] = transition(shot, 'shot', 'invalidated')
      }
    }
    if (payload.kind === 'delivery') invalidateDependents(project, Object.keys(project.timelines), 'new assembly requested')
    if (project.status === 'completed') Object.assign(project, transition(project, 'project', 'active'))
    return productionCommandHandlers.createProductionRun(project, { runId, mode: ['analysis', 'outline', 'script'].includes(payload.kind) ? 'text' : 'fast', tasks })
  },

  replacePreparationImage(project, payload, meta) {
    assertReworkIdle(project)
    const { kind, id, values } = payload
    if (!['character', 'location', 'storyboard'].includes(kind)) throw new DomainValidationError('此步骤不支持替换图片')
    const entity = required(project, kind === 'character' ? 'characters' : kind === 'location' ? 'locations' : 'shots', id)
    if (!values?.logicalKey || !values.contentHash || !(values.bytes > 0)) throw new DomainValidationError('图片文件不完整')
    invalidateDependents(project, [id], 'reference image replaced')
    const assetId = `${meta.commandId}:image`
    project.assets[assetId] = { id: assetId, kind: 'image', status: 'approved', ...values, dependsOn: [id], provenance: { provider: 'user-upload', preparationKind: kind, preparationSignature: preparationSignature(entity), title: entity.name || entity.title }, createdAt: now() }
    commandHandlers.bindPreparationAsset(project, { kind, entityId: id, assetId })
    return { assetId }
  },

  upsertCharacter(project, payload) {
    const previousId = payload.characterId || payload.id
    const previous = previousId ? project.characters[previousId] : null
    const result = upsert(project, 'characters', payload)
    const invalidated = previous ? invalidateDependents(project, [result.id], 'character changed') : []
    return { ...result, invalidated }
  },
  upsertCharacterState(project, payload) {
    if (!payload.characterId || !project.characters[payload.characterId]) throw new DomainValidationError('characterId must reference an existing character')
    return upsert(project, 'characterStates', payload)
  },
  upsertLocation(project, payload) {
    const previous = payload.locationId || payload.id ? project.locations[payload.locationId || payload.id] : null
    const result = upsert(project, 'locations', payload)
    const invalidated = previous ? invalidateDependents(project, [result.id], 'location changed') : []
    return { ...result, invalidated }
  },
  upsertEpisode(project, payload) { return upsert(project, 'episodes', payload, { status: 'draft', shotIds: [] }) },
  upsertShot(project, payload) {
    if (!payload.episodeId || !project.episodes[payload.episodeId]) throw new DomainValidationError('episodeId must reference an existing episode')
    const existing = project.shots[payload.shotId || payload.id]
    const bindings = Array.isArray(payload.referenceBindings) ? payload.referenceBindings : existing?.referenceBindings || []
    const bindingDependencies = bindings.flatMap((binding) => [binding?.entityId, binding?.assetId]).filter(Boolean).map(String)
    const dependsOn = [...new Set([...(payload.dependsOn || existing?.dependsOn || []), ...bindingDependencies])]
    // If shot changes episode, remove from old episode's shotIds
    if (existing && existing.episodeId && existing.episodeId !== payload.episodeId) {
      const oldEpisode = project.episodes[existing.episodeId]
      if (oldEpisode) oldEpisode.shotIds = oldEpisode.shotIds.filter((id) => id !== existing.id)
    }
    const result = upsert(project, 'shots', { ...payload, referenceBindings: bindings, dependsOn }, { status: 'planned', attemptIds: [], assetIds: [], dependsOn: [], referenceBindings: [] })
    const episode = project.episodes[payload.episodeId]
    if (!episode.shotIds.includes(result.id)) episode.shotIds = [...episode.shotIds, result.id]
    const changed = existing && ['prompt', 'shotDescription', 'duration', 'audioDialogue', 'audioNotes', 'referenceBindings', 'characterIds'].some((key) => payload[key] !== undefined && JSON.stringify(payload[key]) !== JSON.stringify(existing[key]))
    if (changed) {
      const updated = project.shots[result.id]
      if (updated.status !== 'invalidated') project.shots[result.id] = transition(updated, 'shot', 'invalidated')
      invalidateDependents(project, [result.id], 'shot content changed')
    }
    return result
  },
  batchUpsertShots(project, payload) {
    if (!Array.isArray(payload.shots) || payload.shots.length === 0) throw new DomainValidationError('shots must be a non-empty array')
    const results = payload.shots.map((shot) => commandHandlers.upsertShot(project, shot))
    return { ids: results.map((result) => result.id) }
  },

  createGenerationAttempt(project, payload, meta) {
    assertRightsGate(project, 'generate')
    let shot = required(project, 'shots', payload.shotId)
    if (String(payload.capability).startsWith('video.')) assertProductionStages(project, shot.id)
    if (shot.status === 'planned') shot = transition(shot, 'shot', 'ready')
    if (!['ready', 'rejected', 'invalidated', 'review', 'generating'].includes(shot.status)) throw new DomainValidationError(`shot is not ready for generation: ${shot.status}`)
    const id = String(payload.attemptId || `${shot.id}-attempt-${String((shot.attemptIds || []).length + 1).padStart(3, '0')}`)
    const timestamp = now()
    const inputSnapshot = payload.inputSnapshot ? validatePromptSnapshot(payload.inputSnapshot) : null
    if (inputSnapshot && inputSnapshot.shotId !== shot.id) throw new DomainValidationError('prompt snapshot shotId does not match attempt shotId')
    if (inputSnapshot && inputSnapshot.projectRevision !== project.revision) throw new DomainValidationError('prompt snapshot projectRevision is stale')
    if (inputSnapshot && !inputSnapshot.capabilityKey.startsWith(`${payload.capability}:`)) throw new DomainValidationError('prompt snapshot capability does not match attempt capability')
    project.attempts[id] = {
      id, shotId: shot.id, capability: payload.capability, workflowId: payload.workflowId || null,
      status: 'created', idempotencyKey: payload.idempotencyKey || meta.commandId, promptId: null,
      requestHash: payload.requestHash || inputSnapshot?.snapshotHash || null, inputSnapshot,
      error: null, outputAssetIds: [], createdAt: timestamp, updatedAt: timestamp,
    }
    project.shots[shot.id] = shot.status === 'generating'
      ? { ...shot, attemptIds: [...new Set([...(shot.attemptIds || []), id])], updatedAt: timestamp }
      : transition(shot, 'shot', 'generating', { attemptIds: [...new Set([...(shot.attemptIds || []), id])] })
    return { attemptId: id }
  },

  bindPreparationAsset(project, payload) {
    const asset = required(project, 'assets', payload.assetId)
    const collection = payload.kind === 'character' ? 'characters' : payload.kind === 'location' ? 'locations' : payload.kind === 'storyboard' ? 'shots' : null
    if (!collection) throw new DomainValidationError('preparation kind must be character, location or storyboard')
    const entity = required(project, collection, payload.entityId)
    if (!isPreparedImage(project, asset.id, preparationSignature(entity))) throw new DomainValidationError('preparation image must be approved and match the current entity')
    if (collection === 'shots') {
      entity.storyboardAssetId = asset.id
      entity.dependsOn = [...new Set([...(entity.dependsOn || []), asset.id])]
    } else {
      entity.referenceAssetId = asset.id
      for (const shot of Object.values(project.shots)) {
        shot.referenceBindings = (shot.referenceBindings || []).map((binding) => binding.kind === payload.kind && binding.entityId === entity.id ? { ...binding, assetId: asset.id } : binding)
        if (shot.referenceBindings.some((binding) => binding.assetId === asset.id)) shot.dependsOn = [...new Set([...(shot.dependsOn || []), asset.id])]
      }
    }
    return { entityId: entity.id, assetId: asset.id }
  },

  markAttemptSubmitted(project, payload, meta) {
    const attempt = required(project, 'attempts', payload.attemptId)
    const submitting = attempt.status === 'created' ? transition(attempt, 'attempt', 'submitting') : attempt
    const next = transition(submitting, 'attempt', payload.submissionUnknown ? 'submission_unknown' : 'queued', {
      promptId: payload.promptId || null,
      externalRef: payload.externalRef || payload.promptId || null,
      submittedAt: now(),
    })
    project.attempts[attempt.id] = next
    const outboxEventId = createOutbox(project, 'generation.submitted', { projectId: project.id, attemptId: attempt.id }, meta.commandId)
    return { attemptId: attempt.id, status: next.status, outboxEventId }
  },

  advanceGenerationAttempt(project, payload) {
    const attempt = required(project, 'attempts', payload.attemptId)
    const next = transition(attempt, 'attempt', payload.status, payload.detail || {})
    project.attempts[attempt.id] = next
    return { attemptId: attempt.id, status: next.status }
  },

  cancelGenerationAttempt(project, payload) {
    const attempt = required(project, 'attempts', payload.attemptId)
    project.attempts[attempt.id] = transition(attempt, 'attempt', 'cancelled', { cancelReason: payload.reason || '' })
    return { attemptId: attempt.id, status: 'cancelled' }
  },

  recoverGenerationAttempt(project, payload) {
    const attempt = required(project, 'attempts', payload.attemptId)
    const retryDownload = attempt.status === 'failed' && attempt.failureClass === 'download_failure' && attempt.promptId
    if (!['submission_unknown', 'queued', 'running', 'downloading'].includes(attempt.status) && !retryDownload) {
      throw new DomainValidationError(`attempt does not require recovery: ${attempt.status}`)
    }
    if (payload.decision === 'fail') {
      project.attempts[attempt.id] = transition(attempt, 'attempt', 'failed', { error: payload.reason || 'recovery marked failed' })
    } else if (payload.decision === 'cancel') {
      project.attempts[attempt.id] = transition(attempt, 'attempt', 'cancelled', { cancelReason: payload.reason || 'recovery cancelled' })
    } else if (payload.decision === 'resume') {
      if (String(attempt.capability).startsWith('video.')) assertProductionStages(project, attempt.shotId)
      if (attempt.status === 'submission_unknown' && !payload.externalRef && !attempt.externalRef) {
        throw new DomainValidationError('submission_unknown requires an externally confirmed reference before resume')
      }
      const targetStatus = attempt.status === 'submission_unknown' ? 'queued' : retryDownload ? 'downloading' : attempt.status
      const detail = { externalRef: payload.externalRef || attempt.externalRef, recoveryDecision: 'resume', error: null }
      project.attempts[attempt.id] = targetStatus === attempt.status
        ? { ...attempt, ...detail, updatedAt: now() }
        : transition(attempt, 'attempt', targetStatus, detail)
      if (retryDownload) {
        const shot = required(project, 'shots', attempt.shotId)
        if (shot.status === 'ready') project.shots[shot.id] = transition(shot, 'shot', 'generating')
      }
    } else {
      throw new DomainValidationError('recovery decision must be resume, fail or cancel')
    }
    return { attemptId: attempt.id, status: project.attempts[attempt.id].status }
  },

  completeGenerationAttempt(project, payload, meta) {
    const attempt = required(project, 'attempts', payload.attemptId)
    if (!['running', 'downloading'].includes(attempt.status)) throw new DomainValidationError(`attempt cannot complete from ${attempt.status}`)
    const assetId = idOf(payload, 'assetId')
    const timestamp = now()
    project.assets[assetId] = {
      id: assetId, kind: payload.kind || 'video', status: 'candidate', logicalKey: payload.logicalKey,
      contentHash: payload.contentHash, bytes: payload.bytes || 0, media: payload.media || {},
      sourceIds: [attempt.id, ...(payload.sourceIds || [])], dependsOn: [...new Set([attempt.shotId, ...(payload.sourceIds || [])])],
      provenance: payload.provenance || {}, createdAt: timestamp, updatedAt: timestamp,
    }
    project.attempts[attempt.id] = transition(attempt, 'attempt', 'completed', {
      outputAssetIds: [...(attempt.outputAssetIds || []), assetId], completedAt: timestamp,
    })
    const shot = required(project, 'shots', attempt.shotId)
    const shotDetail = { assetIds: [...new Set([...(shot.assetIds || []), assetId])] }
    project.shots[shot.id] = shot.status === 'review'
      ? { ...shot, ...shotDetail, updatedAt: timestamp }
      : transition(shot, 'shot', 'review', shotDetail)
    const reviewTaskId = randomUUID()
    project.reviewTasks[reviewTaskId] = {
      id: reviewTaskId, targetType: 'asset', targetId: assetId, status: 'awaiting_human',
      automatedChecks: [], decisionId: null, createdAt: timestamp, updatedAt: timestamp,
    }
    const outboxEventId = createOutbox(project, 'generation.completed', { projectId: project.id, attemptId: attempt.id, assetId }, meta.commandId)
    return { attemptId: attempt.id, assetId, reviewTaskId, outboxEventId }
  },

  failGenerationAttempt(project, payload) {
    const attempt = required(project, 'attempts', payload.attemptId)
    const shot = required(project, 'shots', attempt.shotId)
    project.attempts[attempt.id] = transition(attempt, 'attempt', 'failed', {
      error: String(payload.error || 'generation failed'),
      failureClass: payload.failureClass || 'remote_failure', retryable: payload.retryable === true,
      failureStage: payload.failureStage || '',
    })
    const ACTIVE_ATTEMPT_STATES = ['created', 'submitting', 'submission_unknown', 'queued', 'running', 'downloading']
    const hasOtherActive = Object.values(project.attempts).some(
      (a) => a.shotId === shot.id && a.id !== attempt.id && ACTIVE_ATTEMPT_STATES.includes(a.status),
    )
    if (!hasOtherActive && shot.status === 'generating') {
      project.shots[shot.id] = transition(shot, 'shot', 'ready')
    }
    return { attemptId: attempt.id }
  },

  createReviewTask(project, payload) {
    const existing = Object.values(project.reviewTasks).find((t) => t.targetId === payload.targetId && ['pending', 'automated_check', 'awaiting_human'].includes(t.status))
    if (existing) return { reviewTaskId: existing.id, reused: true }
    const id = idOf(payload, 'reviewTaskId')
    project.reviewTasks[id] = {
      id, targetType: payload.targetType, targetId: payload.targetId, status: 'awaiting_human',
      automatedChecks: [], decisionId: null, createdAt: now(), updatedAt: now(),
    }
    return { reviewTaskId: id }
  },

  recordAutomatedCheck(project, payload) {
    const task = required(project, 'reviewTasks', payload.reviewTaskId)
    const check = {
      id: payload.checkId || randomUUID(), adapter: payload.adapter, schemaVersion: payload.schemaVersion,
      inputHash: payload.inputHash, result: payload.result, report: payload.report || {}, createdAt: now(),
    }
    const failed = payload.result !== 'pass'
    const timestamp = now()
    const checking = task.status === 'automated_check' ? task : transition(task, 'review', 'automated_check')
    const checked = {
      ...checking,
      automatedChecks: [...(task.automatedChecks || []), check],
    }
    if (failed) {
      applyReviewDecision(project, checked, {
        decision: 'rejected', reason: `auto-rejected by ${payload.adapter}`,
        answerer: `automated:${payload.adapter}`, timestamp,
      })
    } else {
      project.reviewTasks[task.id] = transition(checked, 'review', 'awaiting_human')
    }
    return { reviewTaskId: task.id, checkId: check.id, autoRejected: failed }
  },

  recordReviewDecision(project, payload) {
    const task = required(project, 'reviewTasks', payload.reviewTaskId)
    if (task.status !== 'awaiting_human') throw new DomainValidationError(`review task is not awaiting human: ${task.status}`)
    if (!['approved', 'rejected'].includes(payload.decision)) throw new DomainValidationError('decision must be approved or rejected')
    const id = idOf(payload, 'decisionId')
    applyReviewDecision(project, task, {
      decision: payload.decision, decisionId: id, reason: payload.reason || '', answerer: payload.answerer || 'user',
    })
    return { decisionId: id }
  },

  approveShotAsset(project, payload) {
    const shot = required(project, 'shots', payload.shotId)
    const asset = required(project, 'assets', payload.assetId)
    const decision = required(project, 'reviewDecisions', payload.decisionId)
    const task = required(project, 'reviewTasks', decision.reviewTaskId)
    if (decision.decision !== 'approved' || task.targetId !== asset.id) throw new DomainValidationError('approved review decision for asset required')
    project.assets[asset.id] = transition(asset, 'asset', 'approved', { approvedAt: now() })
    project.shots[shot.id] = transition(shot, 'shot', 'approved', { approvedAssetId: asset.id })
    return { shotId: shot.id, assetId: asset.id }
  },

  batchRecordReviewDecisions(project, payload) {
    if (!Array.isArray(payload.decisions) || !payload.decisions.length) throw new DomainValidationError('decisions array is required')
    const results = { approved: 0, rejected: 0, skipped: 0, errors: [] }
    for (const item of payload.decisions) {
      const task = project.reviewTasks[item.reviewTaskId]
      if (!task) { results.errors.push({ reviewTaskId: item.reviewTaskId, error: 'not found' }); continue }
      if (task.status !== 'awaiting_human') { results.skipped++; results.errors.push({ reviewTaskId: item.reviewTaskId, error: `status is ${task.status}` }); continue }
      if (!['approved', 'rejected'].includes(item.decision)) { results.errors.push({ reviewTaskId: item.reviewTaskId, error: 'invalid decision' }); continue }
      applyReviewDecision(project, task, {
        decision: item.decision, reason: item.reason || '', answerer: item.answerer || payload.answerer || 'user',
      })
      results[item.decision === 'approved' ? 'approved' : 'rejected']++
    }
    return results
  },

  invalidateDependents(project, payload) {
    const sourceIds = Array.isArray(payload.sourceIds) ? payload.sourceIds : [payload.sourceId]
    return { invalidated: invalidateDependents(project, sourceIds.filter(Boolean), payload.reason || 'upstream changed') }
  },

  assembleTimeline(project, payload) {
    const assetIds = payload.assetIds || []
    assertTimelineAssets(project, assetIds)
    const id = idOf(payload, 'timelineId')
    const previous = project.timelines[id]
    if (previous) {
      project.timelines[id] = transition(previous, 'timeline', 'ready', {
        episodeId: payload.episodeId, revision: previous.revision + 1,
        assetIds: [...assetIds], dependsOn: [...assetIds], settings: payload.settings || {},
      })
    } else {
      project.timelines[id] = {
        id, episodeId: payload.episodeId, revision: 1,
        status: 'ready', assetIds: [...assetIds], dependsOn: [...assetIds],
        settings: payload.settings || {}, createdAt: now(), updatedAt: now(),
      }
    }
    // Mark shots whose approved assets are in this timeline as assembled
    for (const assetId of assetIds) {
      const shot = Object.values(project.shots).find((s) => s.approvedAssetId === assetId && s.status === 'approved')
      if (shot) project.shots[shot.id] = transition(shot, 'shot', 'assembled')
    }
    return { timelineId: id, timelineRevision: project.timelines[id].revision }
  },

  recordDeliverable(project, payload, meta) {
    assertDeliverableReady(project, payload.timelineId)
    const id = idOf(payload, 'deliverableId')
    const timestamp = now()
    project.deliverables[id] = {
      id, timelineId: payload.timelineId, timelineRevision: project.timelines[payload.timelineId].revision,
      status: payload.status || 'ready', contentHash: payload.contentHash, logicalKey: payload.logicalKey,
      qualityReport: payload.qualityReport || {}, createdAt: timestamp, updatedAt: timestamp,
      dependsOn: [payload.timelineId],
    }
    const outboxEventId = createOutbox(project, 'deliverable.ready', { projectId: project.id, deliverableId: id }, meta.commandId)
    return { deliverableId: id, outboxEventId }
  },

  completeDramaProduction(project, payload) {
    const deliverable = required(project, 'deliverables', payload.deliverableId)
    assertDeliverableReady(project, deliverable.timelineId)
    if (deliverable.status !== 'ready' || !deliverable.logicalKey || !deliverable.contentHash) throw new DomainValidationError('drama deliverable is incomplete')
    const episodes = Object.values(project.episodes).filter((episode) => episode.id !== 'legacy-main')
    const shots = episodes.flatMap((episode) => episode.shotIds)
    const timeline = project.timelines[deliverable.timelineId]
    if (!shots.length || episodes.some((episode) => !episode.shotIds.length)) throw new DomainValidationError('drama delivery is missing episodes or shots')
    for (const shotId of shots) {
      assertProductionStages(project, shotId)
      if (!timeline.assetIds.includes(project.shots[shotId].approvedAssetId)) throw new DomainValidationError(`drama delivery is missing shot: ${shotId}`)
    }
    if (project.status === 'completed') return { deliverableId: deliverable.id }
    for (const episode of episodes) project.episodes[episode.id] = { ...episode, status: 'delivered', updatedAt: now() }
    if (project.status === 'draft') Object.assign(project, transition(project, 'project', 'active'))
    Object.assign(project, transition(project, 'project', 'completed'))
    return { deliverableId: deliverable.id }
  },

  planDeliverable(project, payload, meta) {
    assertDeliverableReady(project, payload.timelineId)
    const id = idOf(payload, 'deliverableId')
    const timestamp = now()
    project.deliverables[id] = {
      id, timelineId: payload.timelineId, timelineRevision: project.timelines[payload.timelineId].revision,
      status: 'planned', preset: payload.preset || 'mp4-h264', contentHash: null, logicalKey: null,
      qualityReport: {}, dependsOn: [payload.timelineId], createdAt: timestamp, updatedAt: timestamp,
    }
    const outboxEventId = createOutbox(project, 'deliverable.export', { projectId: project.id, deliverableId: id }, meta.commandId)
    return { deliverableId: id, outboxEventId }
  },

  startDeliverableExport(project, payload) {
    const deliverable = required(project, 'deliverables', payload.deliverableId)
    project.deliverables[deliverable.id] = transition(deliverable, 'deliverable', 'exporting')
    return { deliverableId: deliverable.id }
  },

  completeDeliverableExport(project, payload) {
    const deliverable = required(project, 'deliverables', payload.deliverableId)
    project.deliverables[deliverable.id] = transition(deliverable, 'deliverable', 'ready', {
      contentHash: payload.contentHash, logicalKey: payload.logicalKey,
      qualityReport: payload.qualityReport || {},
    })
    return { deliverableId: deliverable.id }
  },

  failDeliverableExport(project, payload) {
    const deliverable = required(project, 'deliverables', payload.deliverableId)
    project.deliverables[deliverable.id] = transition(deliverable, 'deliverable', 'failed', {
      lastError: payload.error || 'unknown',
    })
    return { deliverableId: deliverable.id }
  },

  recordRights(project, payload) {
    const id = idOf(payload, 'rightsRecordId')
    project.rightsRecords[id] = {
      id, kind: payload.kind, subjectId: payload.subjectId || null, subjectAdult: payload.subjectAdult === true,
      scope: payload.scope || [], evidenceAssetIds: payload.evidenceAssetIds || [], license: payload.license || null,
      grantedAt: payload.grantedAt || now(), revokedAt: payload.revokedAt || null, createdAt: now(), updatedAt: now(),
    }
    return { rightsRecordId: id }
  },

  updateRuntimeHealth(project, payload) {
    if (!payload.capability) throw new DomainValidationError('capability required')
    project.runtimeHealth[payload.capability] = {
      capability: payload.capability, status: payload.status, verifiedAt: payload.verifiedAt || now(),
      hash: payload.hash || '', endpoint: payload.endpoint || '', detail: payload.detail || {},
    }
    return { capability: payload.capability }
  },

  replaceLegacyCanvas(project, payload) {
    project.legacyCanvas = { ...payload.canvas, schemaVersion: 1, projectId: project.id, updatedAt: now() }
    return { projectId: project.id }
  },

  markOutboxEvent(project, payload) {
    const event = required(project, 'outboxEvents', payload.eventId)
    project.outboxEvents[event.id] = transition(event, 'outbox', payload.status, {
      externalRef: payload.externalRef ?? event.externalRef,
      lastError: payload.error ?? event.lastError, retryCount: payload.retryCount ?? event.retryCount,
      processedAt: ['delivered', 'dead'].includes(payload.status) ? now() : event.processedAt,
    })
    return { eventId: event.id, status: payload.status }
  },
}

export function applyCommand(project, type, payload, meta) {
  const handler = commandHandlers[type]
  if (!handler) throw new DomainValidationError(`unknown command: ${type}`)
  return handler(project, payload || {}, meta)
}
