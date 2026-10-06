import { productionStageIssues } from './policies.js'

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
  if (project.storyBible) add('domain:analysis', 'analysis', '内容分析', project.storyBible.summary || JSON.stringify(project.storyBible, null, 2))
  for (const [kind, entities] of [['character', project.characters], ['location', project.locations]]) {
    for (const entity of Object.values(entities)) {
      add(`domain:${kind}:${entity.id}`, 'assets', entity.name || entity.id, entity.description || entity.appearance || entity.prompt || entity.name || '', { params: { entityId: entity.id, assetType: kind } })
    }
  }
  for (const episode of Object.values(project.episodes)) {
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
  if (project.legacyCanvas) {
    const canvas = structuredClone(project.legacyCanvas)
    const storyboardIds = new Set(nodes.map((node) => node.id))
    const imageMedia = new Set(nodes.filter((node) => node.kind === 'image').map((node) => node.media))
    return { ...canvas, projectId: project.id, revision: project.revision, nodes: [...canvas.nodes.filter((node) => !node.domainProjection && !storyboardIds.has(node.id) && !(node.kind === 'image' && imageMedia.has(node.media))), ...nodes] }
  }
  return {
    schemaVersion: 1,
    projectId: project.id,
    revision: project.revision,
    settings: {
      aspectRatio: project.productionSpec.aspectRatio,
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
