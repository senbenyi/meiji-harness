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
  if (project.legacyCanvas) return { ...structuredClone(project.legacyCanvas), projectId: project.id, revision: project.revision }
  const nodes = []
  for (const shot of Object.values(project.shots)) {
    nodes.push({
      id: shot.id, kind: 'text', title: shot.title || shot.id, text: shot.prompt || '',
      group: shot.episodeId || '镜头', status: shot.status, order: shot.order || 0,
      approvedAssetId: shot.approvedAssetId || null,
    })
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
