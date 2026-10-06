// 将现有业务按钮转换成目标；即时编辑仍返回 null。
import { operationRequest } from './operation-request.js'
export function goalRequest(action, fields = {}) {
  if (action === 'run-goal') return { goal: fields.goal, ...(fields.episodeId ? { episodeId: fields.episodeId } : {}) }
  const operation = operationRequest(action, fields)
  const to = { 'shot-table': 'shots', 'character-image': 'images', 'scene-image': 'images', 'prop-image': 'images', 'library-image': 'images' }[operation.action] || operation.action
  if (!['summary', 'story', 'images', 'shots', 'seconds', 'film', 'assemble', 'project-summary', 'script-revise', 'script-sync'].includes(to)) return null
  const feedback = String(operation.review || operation.instruction || '').trim()
  const scope = { ...(operation.only ? { only: operation.only } : {}), ...(operation.track ? { tracks: [operation.track] } : {}), ...(operation.itemIds?.length ? { itemIds: operation.itemIds } : operation.itemId ? { itemIds: [operation.itemId] } : {}), ...(operation.fromEpisode ? { fromEpisode: Number(operation.fromEpisode) } : {}) }
  if (operation.action === 'library-image') scope.library = { kind: operation.libraryKind, id: operation.libraryId, variantId: operation.variantId }
  if (operation.action === 'script-revise' && operation.fromEpisode !== undefined) scope.fromEpisode = Number(operation.fromEpisode) + 1
  const goal = { to, ...(operation.from ? { from: operation.from } : {}), scope,
    mode: operation.mode || (feedback ? 'modify' : operation.generationMode === 'regenerate' ? 'regenerate' : 'generate'),
    ...(feedback ? { feedback } : {}), ...(operation.requirements ? { requirements: operation.requirements } : {}), ...(operation.draft ? { draft: true } : {}),
    ...(operation.referenceDurationSeconds || operation.durationSeconds ? { durationSeconds: Number(operation.referenceDurationSeconds || operation.durationSeconds) } : {}), ...(operation.parts ? { parts: operation.parts } : {}) }
  return { goal, ...(operation.episodeId ? { episodeId: operation.episodeId } : {}), ...(operation.episodeNumber ? { episodeNumber: operation.episodeNumber } : {}) }
}
