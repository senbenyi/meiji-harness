import { allNodes } from '../shared/drama-model.js'
import { runTargetMatches } from '../shared/run-view.js'
export function targetBusy(project, target) {
  const locks = project?.executionLocks || []
  const episodeId = project?.episodeId || null
  if (locks.some(lock => target === 'project' || lock.scope === 'project' || lock.episodeId === episodeId && (runTargetMatches(lock.target, target) || target === lock.target.split(':')[0]))) return true
  return allNodes(project || {}).some(node => node.operation && node.operation.phase !== 'awaiting-confirmation' && (target === 'project' || runTargetMatches(node.id, target) || target === node.id.split(':')[0]))
}
export function withRunActivity(project, runs = [], history = runs) {
  if (!project?.episodes) return project
  const executionLocks = runs.flatMap(run => (run.activeSteps || []).map(step => ({ ...step, episodeId: run.episodeId, runId: run.id })))
  const projectStep = executionLocks.find(step => step.scope === 'project')
  return { ...project, executionLocks, activeRuns: runs, operationActivity: projectStep?.target || null,
    episodes: project.episodes.map(episode => {
      const characters = episode.plot?.characters
      const failed = !characters?.operation && characters?.check?.passed !== true && history.find(run => run.status === 'failed' && run.episodeId === episode.id && run.id === characters?.source?.runId && run.failure?.target === 'characters')
      return { ...episode, executionLocks, charactersFailure: failed?.failure?.message || '', activeRuns: runs.filter(run => run.episodeId === episode.id || run.affectedEpisodes?.includes(episode.id)), operationActivity: executionLocks.find(step => step.episodeId === episode.id)?.target || projectStep?.target || null }
    }) }
}
export const runActivityMark = runs => runs.map(run => `${run.id}:${run.status}:${run.done}:${run.pendingCount}:${run.activeSteps?.map(step => step.id).join(',')}`).join('|')
