import { productionStageIssues, isPreparedImage, preparationSignature } from './policies.js'
import { ENTITY_COLLECTIONS, entityFor, assertGenerationReady } from '../prompts/specification.js'

function promptState(project, target, purpose) {
  try { assertGenerationReady(project, target, purpose); return 'ready' } catch { return 'stale' }
}

function assetTaskStatus(task) {
  if (!task) return 'pending'
  if (task.status === 'completed') return 'ready'
  if (['ready', 'leased', 'running'].includes(task.status)) return 'active'
  if (['failed', 'blocked'].includes(task.status)) return 'failed'
  return 'pending'
}

function taskProgress(items) {
  return { completed: items.filter((task) => task.status === 'completed').length, total: items.length }
}

// Stage progress describes production artifacts; content quality is a separate review.
export function productionProgress(project) {
  if (!Object.keys(project.sourceDocuments || {}).length) return null
  const episodes = Object.values(project.episodes).filter((episode) => episode.id !== 'legacy-main')
  const shots = episodes.flatMap((episode) => (episode.shotIds || []).map((id) => project.shots[id])).filter(Boolean)
  const authoredBindings = [...new Map([...shots.flatMap((shot) => shot.referenceBindings || []), ...Object.entries(ENTITY_COLLECTIONS).flatMap(([kind, collection]) => Object.values(project[collection] || {}).filter((entity) => !entity.retired).map((entity) => ({ kind, entityId: entity.id, assetId: entity.referenceAssetId })))]
    .filter((binding) => ENTITY_COLLECTIONS[binding.kind])
    .map((binding) => [`${binding.kind}:${binding.entityId}`, binding])).values()]
  const allTasks = Object.values(project.productionTasks || {})
  const textRoot = Object.values(project.productionRuns || {})
    .filter((run) => run.mode === 'text' && run.id.includes(':text:') && !run.id.includes(':scripts'))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
  const tasks = textRoot
    ? allTasks.filter((task) => task.runId === textRoot.id || task.runId.startsWith(`${textRoot.id}:`))
    : allTasks
  const assetExtractionTasks = tasks.filter((task) => task.input?.label?.startsWith('asset-extraction'))
  const assetPromptTasks = tasks.filter((task) => task.input?.label?.startsWith('asset-prompt:'))
  const assetPromptTaskByEntity = new Map(assetPromptTasks.map((task) => [task.input.label.slice('asset-prompt:'.length), task]))
  const mediaRuns = Object.values(project.productionRuns || {})
    .filter((run) => run.mode !== 'text' && run.taskIds?.some((id) => ['render-reference', 'render-storyboard', 'render-shot', 'concat-video', 'deliver-drama'].includes(project.productionTasks?.[id]?.kind)))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  const latest = mediaRuns.find((run) => run.status === 'active')
    || mediaRuns.find((run) => run.taskIds?.some((id) => ['render-shot', 'deliver-drama'].includes(project.productionTasks?.[id]?.kind)))
    || mediaRuns[0]
  const mediaTasks = allTasks.filter((task) => task.runId === latest?.id)
  // The asset stage owns every current asset extracted from the formal scripts.
  // Do not shrink its denominator later to only the references used by planned shots.
  const bindings = authoredBindings
  const current = (id) => {
    const proposal = project.developmentProposals[id]
    return proposal?.status === 'approved' && proposal.sourceRefs?.every((ref) => !project.sourceDocuments[ref.sourceId]?.supersededBy && project.sourceDocuments[ref.sourceId]?.contentHash === ref.contentHash)
  }
  const readyDeliverables = Object.values(project.deliverables).filter((item) => item.status === 'ready' && item.logicalKey && item.contentHash && project.timelines[item.timelineId]?.assetIds.every((id) => project.assets[id]?.status === 'approved'))
  const assetPromptReady = bindings.filter((binding) => {
    try { assertGenerationReady(project, entityFor(project, binding.kind, binding.entityId), 'image'); return true } catch { return false }
  }).length
  const assetReferenceTasks = mediaTasks.filter((task) => task.kind === 'render-reference')
  const assetReferenceTaskByEntity = new Map(assetReferenceTasks.map((task) => [task.scopeId, task]))
  const assetItemBindings = [...bindings]
  const knownAssetIds = new Set(assetItemBindings.map((binding) => binding.entityId))
  for (const task of assetPromptTasks) {
    const entityId = task.input.label.slice('asset-prompt:'.length)
    if (knownAssetIds.has(entityId)) continue
    const kind = Object.keys(ENTITY_COLLECTIONS).find((candidate) => entityFor(project, candidate, entityId))
      || ({ char: 'character', loc: 'location', prop: 'prop', var: 'variant' }[entityId.split('-')[0]])
    if (kind) assetItemBindings.push({ kind, entityId })
  }
  const extractionProgress = taskProgress(assetExtractionTasks)
  const assetTotal = extractionProgress.total && extractionProgress.completed < extractionProgress.total
    ? 0
    : Math.max(assetItemBindings.length, assetPromptTasks.length)
  const assetAction = (() => {
    const extraction = extractionProgress
    const prompts = taskProgress(assetPromptTasks)
    const references = taskProgress(assetReferenceTasks)
    if (extraction.total && extraction.completed < extraction.total) return { key: 'extraction', label: '正在从正式剧本提取资产', ...extraction }
    if (prompts.total && prompts.completed < prompts.total) return { key: 'prompts', label: '正在编写资产图片提示词', ...prompts }
    if (references.total && references.completed < references.total) return { key: 'references', label: '正在生成资产参考图', ...references }
    if (references.total) return { key: 'references', label: '资产参考图已生成', ...references }
    if (prompts.total) return { key: 'prompts', label: '资产提示词已编写', ...prompts }
    return { key: 'extraction', label: '等待提取资产', ...extraction }
  })()
  const assetItems = assetItemBindings.map((binding) => {
    const entity = entityFor(project, binding.kind, binding.entityId)
    const promptTask = assetPromptTaskByEntity.get(binding.entityId)
    const referenceTask = assetReferenceTaskByEntity.get(binding.entityId)
    const referenceReady = Boolean(entity && isPreparedImage(project, entity.referenceAssetId, preparationSignature(entity)))
    let promptStatus = assetTaskStatus(promptTask)
    try { assertGenerationReady(project, entity, 'image'); promptStatus = 'ready' } catch {}
    return {
      kind: binding.kind,
      entityId: binding.entityId,
      name: entity?.name || binding.entityId,
      promptStatus,
      referenceStatus: referenceReady ? 'ready' : assetTaskStatus(referenceTask),
    }
  })
  const rawStages = [
    ['analysis', 1, Number(Boolean(project.storyBible?.summary && current(project.storyBible.proposalId))), tasks.filter((task) => ['source-summary', 'story-reconcile'].some((label) => task.input?.label?.startsWith(label)))],
    ['scripts', episodes.length, episodes.filter((episode) => episode.script && current(episode.proposalId) && episode.analysisProposalId === project.storyBible?.proposalId).length, tasks.filter((task) => task.input?.label?.startsWith('episode-script:') || task.input?.label === 'episode-plan')],
    ['assets', assetTotal, bindings.filter((binding) => {
      const entity = entityFor(project, binding.kind, binding.entityId)
      try { assertGenerationReady(project, entity, 'image') } catch { return false }
      return entity && isPreparedImage(project, entity.referenceAssetId, preparationSignature(entity))
    }).length, [...tasks.filter((task) => task.input?.label?.startsWith('asset-extraction') || task.input?.label?.startsWith('asset-prompt:') || task.input?.phase === 'assets'), ...mediaTasks.filter((task) => task.kind === 'render-reference')]],
    ['storyboard', shots.length, shots.filter((shot) => { try { assertGenerationReady(project, shot, 'image'); return isPreparedImage(project, shot.storyboardAssetId, preparationSignature(shot)) } catch { return false } }).length, [...tasks.filter((task) => task.input?.label?.startsWith('episode-storyboard:') || task.input?.label?.startsWith('image-prompts:') || task.input?.phase === 'prompts'), ...mediaTasks.filter((task) => task.kind === 'render-storyboard')]],
    ['media', shots.length, shots.filter((shot) => project.assets[shot.approvedAssetId]?.status === 'approved' && !productionStageIssues(project, shot.id).length).length, mediaTasks.filter((task) => task.kind === 'render-shot')],
    ['delivery', 1, Number(readyDeliverables.length > 0), mediaTasks.filter((task) => ['concat-video', 'deliver-drama'].includes(task.kind))],
  ]
  let previousCompleted = true
  const stages = rawStages.map(([key, total, completed, items]) => {
    const completedEmptyAssetStage = key === 'assets' && total === 0
      && tasks.some((task) => task.input?.label === 'asset-references-ready' && task.status === 'completed')
    const ownStatus = (total > 0 && completed === total) || completedEmptyAssetStage
      ? 'completed'
      : items.some((task) => ['failed', 'blocked'].includes(task.status))
        ? 'blocked'
        : items.some((task) => ['ready', 'leased', 'running'].includes(task.status))
          ? 'active'
          : 'pending'
    const unlocked = previousCompleted
    const status = unlocked ? ownStatus : 'locked'
    const stage = {
      key, total, completed, status,
      errors: unlocked ? items.filter((task) => task.error).map((task) => ({ taskId: task.id, error: task.error })) : [],
      ...(key === 'assets' ? { detail: { extracted: bindings.length, promptReady: Math.max(assetPromptReady, taskProgress(assetPromptTasks).completed), referenceApproved: completed, action: assetAction, items: assetItems } } : {}),
    }
    previousCompleted = previousCompleted && status === 'completed'
    return stage
  })
  return { status: stages.every((stage) => stage.status === 'completed') ? 'completed' : stages.some((stage) => stage.status === 'blocked') ? 'blocked' : 'active', qualityReview: 'not_performed', stages, deliverables: readyDeliverables.map(({ id, logicalKey }) => ({ id, logicalKey })) }
}

export function projectSummary(project) {
  return {
    id: project.id,
    revision: project.revision,
    status: project.status,
    title: project.title,
    episodeCount: Object.keys(project.episodes).length,
    shotCount: Object.keys(project.shots).length,
    pendingReviews: Object.values(project.reviewTasks).filter((task) => ['pending', 'automated_check', 'awaiting_human'].includes(task.status)).length,
    activeAttempts: Object.values(project.attempts).filter((attempt) => !['completed', 'failed', 'cancelled'].includes(attempt.status)).length,
    deadLetters: Object.values(project.outboxEvents).filter((event) => event.status === 'dead').length,
    updatedAt: project.updatedAt,
  }
}

export function canvasReadModel(project) {
  const nodes = []
  const production = productionProgress(project)
  const assetProgressItems = new Map((production?.stages?.find((stage) => stage.key === 'assets')?.detail?.items || []).map((item) => [item.entityId, item]))
  const projectedAssetIds = new Set()
  const blockedStages = new Set((production?.stages || []).filter((stage) => stage.status === 'blocked').map((stage) => stage.key))
  const snapshots = new Map(Object.values(project.assets).map((asset) => [asset.logicalKey, (asset.sourceIds || []).map((id) => project.attempts[id]?.inputSnapshot).find(Boolean)]))
  const withSnapshot = (node) => snapshots.get(node.media) ? { ...node, presentation: { ...node.presentation, inputSnapshot: snapshots.get(node.media) } } : node
  const episodes = Object.values(project.episodes).filter((episode) => episode.id !== 'legacy-main')
    .sort((a, b) => (a.order || 0) - (b.order || 0))
  const visibleRuns = Object.values(project.productionRuns || {}).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 5)
  const activeRun = visibleRuns.find((run) => run.status === 'active') || visibleRuns[0]
  const orderedRuns = activeRun ? [activeRun, ...visibleRuns.filter((run) => run.id !== activeRun.id)] : visibleRuns
  const presentation = {
    title: project.title,
    activeRunId: activeRun?.id || null,
    runs: orderedRuns.map((run) => ({ id: run.id, mode: run.mode, kind: project.productionTasks[run.taskIds[0]]?.kind, status: run.status, completed: run.completedTaskIds.length, total: run.taskIds.length, errors: run.taskIds.map((id) => project.productionTasks[id]?.error).filter(Boolean) })),
    episodes: episodes.map((episode, index) => ({ id: episode.id, title: episode.title, number: index + 1, shotCount: episode.shotIds?.length || 0 })),
  }
  const shotInfo = (shot) => ({ role: 'shot', shotId: shot.id, episodeId: shot.episodeId, shotNumber: (project.episodes[shot.episodeId]?.shotIds || []).indexOf(shot.id) + 1 || shot.order, description: shot.shotDescription || shot.prompt || '', plannedDuration: shot.duration, imageGeneration: shot.imageGeneration, videoGeneration: shot.videoGeneration, imagePromptStatus: promptState(project, shot, 'image'), videoPromptStatus: promptState(project, shot, 'video'), historical: !(project.episodes[shot.episodeId]?.shotIds || []).includes(shot.id) })
  const imageOwners = new Map()
  const videoOwners = new Map()
  const add = (id, stage, title, content, extra = {}) => nodes.push({ id, stage, kind: 'text', title, content, text: content, group: title, domainProjection: true, ...extra })
  for (const source of Object.values(project.sourceDocuments || {})) {
    const sourceName = source.title || '小说素材'
    const filename = `${sourceName.replace(/\.(?:txt|md|markdown)$/i, '')}.txt`
    add(`domain:source:${source.id}`, 'analysis', '小说素材', `${filename} · ${source.characters} 字符`, { presentation: { role: 'source', sourceId: source.id, historical: Boolean(source.supersededBy) }, params: { contentHash: source.contentHash } })
  }
  if (project.storyBible) add('domain:analysis', 'analysis', '故事概述', project.storyBible.summary || JSON.stringify(project.storyBible, null, 2), { presentation: { role: 'analysis' } })
  for (const [kind, collection] of Object.entries(ENTITY_COLLECTIONS)) {
    for (const entity of Object.values(project[collection] || {})) {
      if (entity.retired || (entity.provisional && !assetProgressItems.has(entity.id))) continue
      let promptStatus = 'ready'
      try { assertGenerationReady(project, entity, 'image') } catch { promptStatus = entity.generation ? 'stale' : 'pending' }
      const progressItem = assetProgressItems.get(entity.id)
      promptStatus = progressItem?.promptStatus || promptStatus
      const info = { role: entity.provisional || promptStatus !== 'ready' ? 'asset-task' : 'entity', entityId: entity.id, entityKind: kind, referenceAssetId: entity.referenceAssetId, generation: entity.generation, promptStatus, referenceStatus: progressItem?.referenceStatus || (entity.referenceAssetId ? 'ready' : 'pending'), usages: entity.usages, parentId: entity.parentId }
      if (entity.referenceAssetId) imageOwners.set(entity.referenceAssetId, info)
      add(`domain:${kind}:${entity.id}`, 'assets', entity.name || entity.id, entity.visualDescription || entity.description || entity.appearance || entity.prompt || entity.name || '', { presentation: info, params: { entityId: entity.id, assetType: kind } })
      projectedAssetIds.add(entity.id)
    }
  }
  for (const item of assetProgressItems.values()) {
    if (projectedAssetIds.has(item.entityId)) continue
    add(`domain:asset-task:${item.entityId}`, 'assets', item.name, '', {
      status: item.promptStatus === 'active' || item.referenceStatus === 'active' ? 'running' : 'pending',
      presentation: { role: 'asset-task', entityId: item.entityId, entityKind: item.kind, promptStatus: item.promptStatus, referenceStatus: item.referenceStatus },
      params: { entityId: item.entityId, assetType: item.kind },
    })
  }
  for (const episode of episodes) {
    if (episode.outline) add(`domain:plan:${episode.id}`, 'analysis', episode.title || '分集规划', episode.outline, { presentation: { role: 'outline', episodeId: episode.id } })
    if (episode.script) {
      const draft = project.developmentProposals[episode.proposalId]
      const currentDraft = draft?.kind === 'episode_draft' && draft.status === 'approved' && episode.analysisProposalId === project.storyBible?.proposalId && draft.sourceRefs.every((ref) => !project.sourceDocuments[ref.sourceId]?.supersededBy && project.sourceDocuments[ref.sourceId]?.contentHash === ref.contentHash)
      const stale = !currentDraft && productionStageIssues(project, episode.shotIds?.[0], { images: false, storyboard: false }).some((issue) => ['analysis', 'scripts'].includes(issue.stage))
      add(`domain:script:${episode.id}`, 'scripts', episode.title || '分集剧本', episode.script, { status: stale ? 'invalidated' : 'ready', presentation: { role: 'script', episodeId: episode.id } })
    }
  }
  for (const shot of Object.values(project.shots)) {
    if (shot.episodeId === 'legacy-main' || shot.supersededBy) continue
    if (project.episodes[shot.episodeId] && !(project.episodes[shot.episodeId].shotIds || []).includes(shot.id)) continue
    if (shot.storyboardAssetId) imageOwners.set(shot.storyboardAssetId, shotInfo(shot))
    if (!shot.shotDescription && !shot.prompt && !shot.audioDialogue && !shot.audioNotes) continue
    const content = [
      shot.shotDescription || shot.prompt || '',
      shot.audioDialogue ? '对白：\n' + shot.audioDialogue : '',
      shot.audioNotes ? '声音备注：\n' + shot.audioNotes : '',
    ].filter(Boolean).join('\n\n')
    nodes.push({
      id: `${shot.id}:storyboard`, kind: 'text', title: shot.title || shot.id, text: content, content,
      group: shot.episodeId || '镜头', status: shot.status, order: shot.order || 0,
      stage: 'scripts', domainProjection: true,
      presentation: shotInfo(shot),
      params: { canvasStage: 'scripts', shotId: shot.id },
      approvedAssetId: shot.approvedAssetId || null,
    })
    const video = project.assets[shot.approvedAssetId]
    if (video?.logicalKey) videoOwners.set(video.logicalKey, shot)
    if (video?.kind === 'video' && video.logicalKey && !(project.legacyCanvas?.nodes || []).some((node) => node.kind === 'video' && (node.id === shot.id || node.params?.shotId === shot.id || node.media === video.logicalKey))) {
      add(shot.id, 'media', shot.title || '镜头视频', '', { kind: 'video', media: video.logicalKey, status: video.status, presentation: { ...shotInfo(shot), actualDuration: video.media?.actualDuration }, params: { ...video.media, shotId: shot.id } })
    }
    // A not-yet-produced downstream artifact is normal progress, not an error.
    // Surface only issues belonging to a stage that has actually failed.
    const issues = productionStageIssues(project, shot.id).filter((issue) => blockedStages.has(issue.stage))
    if (issues.length) add(`domain:blocked:${shot.id}`, 'storyboard', shot.title || '镜头前置条件缺失', issues.map((issue) => issue.reason).join('\n'), { status: 'blocked', presentation: { ...shotInfo(shot), role: 'issue' } })
  }
  for (const asset of Object.values(project.assets)) {
    if (asset.kind !== 'image') continue
    const stage = imageOwners.get(asset.id)?.role === 'shot' || asset.provenance?.preparationKind === 'storyboard' ? 'storyboard' : 'assets'
    add(asset.id, stage, asset.provenance?.title || '未命名图片', '', { kind: 'image', media: asset.logicalKey, status: asset.status, params: asset.media, presentation: imageOwners.get(asset.id) || { role: 'unlinked', historical: asset.status === 'invalidated' || Boolean(asset.provenance?.preparationKind) } })
  }
  for (const shot of Object.values(project.shots)) {
    if (shot.episodeId === 'legacy-main') continue
    for (const assetId of shot.assetIds || []) {
      const asset = project.assets[assetId]
      if (assetId === shot.approvedAssetId || asset?.kind !== 'video' || !asset.logicalKey) continue
      add(`domain:history:${assetId}`, 'media', shot.title || '历史镜头', '', { kind: 'video', media: asset.logicalKey, status: asset.status, presentation: { ...shotInfo(shot), historical: true } })
    }
  }
  for (const deliverable of Object.values(project.deliverables || {})) {
    if (deliverable.logicalKey) add(`domain:delivery:${deliverable.id}`, 'delivery', deliverable.status === 'ready' ? '正式成片' : '历史成片', '', { kind: 'video', media: deliverable.logicalKey, status: deliverable.status, presentation: { role: 'delivery', historical: deliverable.status !== 'ready', actualDuration: deliverable.qualityReport?.actualDuration, qualityReview: deliverable.qualityReport?.visualReview || 'not_performed' } })
  }
  if (project.legacyCanvas) {
    const canvas = structuredClone(project.legacyCanvas)
    if (project.productionSpec.mode) canvas.settings = { ...canvas.settings, mode: project.productionSpec.mode }
    const storyboardIds = new Set(nodes.map((node) => node.id))
    const imageMedia = new Set(nodes.filter((node) => node.kind === 'image').map((node) => node.media))
    const legacyNodes = canvas.nodes.filter((node) => !node.domainProjection && !storyboardIds.has(node.id) && !(node.kind === 'image' && imageMedia.has(node.media)))
      .map((node) => {
        const shot = project.shots[node.params?.shotId || node.id] || (node.kind === 'video' && videoOwners.get(node.media))
        if (!shot && node.kind === 'video' && node.params?.sources?.length) return { ...node, presentation: { role: 'assembly', historical: true } }
        return shot && shot.episodeId !== 'legacy-main' ? { ...node, status: project.assets[shot.approvedAssetId]?.status === 'invalidated' || shot.status === 'invalidated' ? 'invalidated' : node.status, presentation: { ...shotInfo(shot), actualDuration: node.params?.actualDuration } } : node
      })
    return { ...canvas, projectId: project.id, revision: project.revision, presentation, production, nodes: [...legacyNodes, ...nodes].map(withSnapshot) }
  }
  return {
    schemaVersion: 1,
    projectId: project.id,
    revision: project.revision,
    presentation,
    production,
    settings: {
      aspectRatio: project.productionSpec.aspectRatio,
      mode: project.productionSpec.mode,
      duration: project.productionSpec.targetDuration,
      audioMode: project.productionSpec.audioStrategy,
    },
    nodes: nodes.map(withSnapshot),
  }
}

export function reviewQueue(project) {
  return Object.values(project.reviewTasks)
    .filter((task) => ['pending', 'automated_check', 'awaiting_human'].includes(task.status))
    .map((task) => ({
      ...structuredClone(task),
      target: project.assets[task.targetId] || project.shots[task.targetId] || project.developmentProposals?.[task.targetId] || null,
      automatedCheckSummary: (task.automatedChecks || [])
        .filter((c) => c.result !== 'pass')
        .map((c) => ({ adapter: c.adapter, result: c.result, reason: c.report?.reason || null })),
    }))
}

export function diagnosticsReadModel(project) {
  return {
    project: projectSummary(project),
    attempts: Object.values(project.attempts).map((attempt) => ({ ...structuredClone(attempt), diagnostics: attemptDiagnostics(attempt) })),
    runtimeHealth: project.runtimeHealth,
    deadLetters: Object.values(project.outboxEvents).filter((event) => event.status === 'dead'),
    invalidatedAssets: Object.values(project.assets).filter((asset) => asset.status === 'invalidated'),
  }
}

export function attemptList(project, { shotId, status } = {}) {
  return Object.values(project.attempts)
    .filter((attempt) => (!shotId || attempt.shotId === shotId) && (!status || attempt.status === status))
    .map((attempt) => ({ ...structuredClone(attempt), diagnostics: attemptDiagnostics(attempt) }))
}
import { attemptDiagnostics } from '../media/recovery.js'
