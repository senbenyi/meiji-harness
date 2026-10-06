import { productionStageIssues, isPreparedImage, preparationSignature } from './policies.js'

// Stage progress describes production artifacts; content quality is a separate review.
export function productionProgress(project) {
  if (!Object.keys(project.sourceDocuments || {}).length) return null
  const episodes = Object.values(project.episodes).filter((episode) => episode.id !== 'legacy-main')
  const shots = episodes.flatMap((episode) => (episode.shotIds || []).map((id) => project.shots[id])).filter(Boolean)
  const bindings = [...new Map(shots.flatMap((shot) => shot.referenceBindings || [])
    .filter((binding) => ['character', 'location'].includes(binding.kind))
    .map((binding) => [`${binding.kind}:${binding.entityId}`, binding])).values()]
  const tasks = Object.values(project.productionTasks || {})
  const latest = Object.values(project.productionRuns || {}).filter((run) => run.mode !== 'text').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
  const mediaTasks = tasks.filter((task) => task.runId === latest?.id)
  const current = (id) => {
    const proposal = project.developmentProposals[id]
    return proposal?.status === 'approved' && proposal.sourceRefs?.every((ref) => project.sourceDocuments[ref.sourceId]?.contentHash === ref.contentHash)
  }
  const readyDeliverables = Object.values(project.deliverables).filter((item) => item.status === 'ready' && item.logicalKey && item.contentHash)
  const stages = [
    ['analysis', 1, Number(Boolean(project.storyBible?.summary && current(project.storyBible.proposalId))), tasks.filter((task) => ['source-summary', 'story-reconcile'].some((label) => task.input?.label?.startsWith(label)))],
    ['scripts', episodes.length, episodes.filter((episode) => episode.script && current(episode.proposalId) && episode.analysisProposalId === project.storyBible?.proposalId).length, tasks.filter((task) => task.input?.label?.startsWith('episode-script:') || task.input?.label === 'episode-plan')],
    ['assets', bindings.length, bindings.filter((binding) => {
      const entity = project[binding.kind === 'character' ? 'characters' : 'locations'][binding.entityId]
      return entity && isPreparedImage(project, binding.assetId, preparationSignature(entity))
    }).length, mediaTasks.filter((task) => task.kind === 'render-reference')],
    ['storyboard', shots.length, shots.filter((shot) => isPreparedImage(project, shot.storyboardAssetId, preparationSignature(shot))).length, mediaTasks.filter((task) => task.kind === 'render-storyboard')],
    ['media', shots.length, shots.filter((shot) => project.assets[shot.approvedAssetId]?.status === 'approved' && !productionStageIssues(project, shot.id).length).length, mediaTasks.filter((task) => task.kind === 'render-shot')],
    ['delivery', 1, Number(project.status === 'completed' && readyDeliverables.length > 0), mediaTasks.filter((task) => ['concat-video', 'deliver-drama'].includes(task.kind))],
  ].map(([key, total, completed, items]) => ({
    key, total, completed,
    status: total > 0 && completed === total ? 'completed' : items.some((task) => ['failed', 'blocked'].includes(task.status)) ? 'blocked' : items.some((task) => ['ready', 'leased', 'running'].includes(task.status)) ? 'active' : 'pending',
    errors: items.filter((task) => task.error).map((task) => ({ taskId: task.id, error: task.error })),
  }))
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
  const add = (id, stage, title, content, extra = {}) => nodes.push({ id, stage, kind: 'text', title, content, text: content, group: title, domainProjection: true, ...extra })
  for (const source of Object.values(project.sourceDocuments || {})) add(`domain:source:${source.id}`, 'analysis', `原文 · ${source.title || source.id}`, `已导入 ${source.characters} 字符\nSHA-256: ${source.contentHash}`)
  if (project.storyBible) add('domain:analysis', 'analysis', '内容分析', project.storyBible.summary || JSON.stringify(project.storyBible, null, 2))
  for (const [kind, entities] of [['character', project.characters], ['location', project.locations]]) {
    for (const entity of Object.values(entities)) {
      add(`domain:${kind}:${entity.id}`, 'assets', entity.name || entity.id, entity.description || entity.appearance || entity.prompt || entity.name || '', { params: { entityId: entity.id, assetType: kind } })
    }
  }
  for (const episode of Object.values(project.episodes)) {
    if (episode.outline) add(`domain:plan:${episode.id}`, 'analysis', `分集规划 · ${episode.title || episode.id}`, episode.outline)
    if (episode.script) add(`domain:script:${episode.id}`, 'scripts', episode.title || episode.id, episode.script, { status: episode.script === episode.outline ? 'blocked' : episode.status })
  }
  for (const shot of Object.values(project.shots)) {
    if (shot.episodeId === 'legacy-main') continue
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
      params: { canvasStage: 'scripts', shotId: shot.id },
      approvedAssetId: shot.approvedAssetId || null,
    })
    const issues = productionStageIssues(project, shot.id)
    if (issues.length) add(`domain:blocked:${shot.id}`, 'storyboard', `${shot.title || shot.id} · 前置条件缺失`, issues.map((issue) => issue.reason).join('\n'), { status: 'blocked' })
  }
  for (const asset of Object.values(project.assets)) {
    if (asset.kind !== 'image') continue
    const stage = asset.provenance?.preparationKind === 'storyboard' ? 'storyboard' : 'assets'
    add(asset.id, stage, asset.provenance?.title || asset.id, '', { kind: 'image', media: asset.logicalKey, status: asset.status, params: asset.media })
  }
  for (const deliverable of Object.values(project.deliverables || {})) {
    if (deliverable.status === 'ready' && deliverable.logicalKey) add(`domain:delivery:${deliverable.id}`, 'delivery', '正式交付 · 质量未审核', '', { kind: 'video', media: deliverable.logicalKey, status: 'ready' })
  }
  if (project.legacyCanvas) {
    const canvas = structuredClone(project.legacyCanvas)
    if (project.productionSpec.mode) canvas.settings = { ...canvas.settings, mode: project.productionSpec.mode }
    const storyboardIds = new Set(nodes.map((node) => node.id))
    const imageMedia = new Set(nodes.filter((node) => node.kind === 'image').map((node) => node.media))
    return { ...canvas, projectId: project.id, revision: project.revision, production: productionProgress(project), nodes: [...canvas.nodes.filter((node) => !node.domainProjection && !storyboardIds.has(node.id) && !(node.kind === 'image' && imageMedia.has(node.media))), ...nodes] }
  }
  return {
    schemaVersion: 1,
    projectId: project.id,
    revision: project.revision,
    production: productionProgress(project),
    settings: {
      aspectRatio: project.productionSpec.aspectRatio,
      mode: project.productionSpec.mode,
      duration: project.productionSpec.targetDuration,
      audioMode: project.productionSpec.audioStrategy,
    },
    nodes,
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
