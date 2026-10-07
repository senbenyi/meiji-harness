// 页面按钮的语义动作先归一成统一参数（actionRequest），制作类再转换成目标（goalRequest）；即时编辑的 goalRequest 返回 null。
export function actionRequest(action, fields = {}) {
  if (action === 'episode-generate' || action === 'episode-summary-draft') return { action: 'summary', ...fields, ...(action === 'episode-summary-draft' ? { draft: true } : {}) }
  if (action === 'outline' || ['characters', 'scenes'].includes(action)) return { ...fields, action: 'story', only: action }
  if (action === 'shots' || action === 'revise-shot') return { action: 'shot-table', ...fields }
  if (action === 'shot-seconds') return { action: 'seconds', ...fields }
  if (['produce', 'produce-all', 'storyboard', 'shot-storyboard', 'storyboard-bind', 'films', 'tail-frame'].includes(action)) return { action: 'film', ...fields,
    ...(['storyboard', 'shot-storyboard', 'storyboard-bind'].includes(action) ? { parts: 'storyboard' } : action === 'films' ? { parts: 'video' } : action === 'tail-frame' ? { parts: 'tail' } : {}) }
  if (['image', 'revise-image'].includes(action)) return { action: fields.itemId?.startsWith('E') ? 'scene-image' : fields.itemId?.startsWith('P') ? 'prop-image' : 'character-image', ...fields }
  return { action, ...fields }
}
export function goalRequest(action, fields = {}) {
  if (action === 'run-goal') return { goal: fields.goal, ...(fields.episodeId ? { episodeId: fields.episodeId } : {}) }
  const operation = actionRequest(action, fields)
  const to = { 'shot-table': 'shots', 'character-image': 'images', 'scene-image': 'images', 'prop-image': 'images', 'library-image': 'images' }[operation.action] || operation.action
  if (!['summary', 'story', 'images', 'shots', 'seconds', 'film', 'assemble', 'project-summary', 'script-revise', 'script-sync'].includes(to)) return null
  const feedback = String(operation.review || operation.instruction || '').trim()
  const scope = { ...(operation.only ? { only: operation.only } : {}), ...(operation.track ? { tracks: [operation.track] } : {}), ...(operation.itemIds?.length ? { itemIds: operation.itemIds } : operation.itemId ? { itemIds: [operation.itemId] } : {}), ...(operation.fromEpisode ? { fromEpisode: Number(operation.fromEpisode) } : {}) }
  if (operation.action === 'library-image') scope.library = { kind: operation.libraryKind, id: operation.libraryId, variantId: operation.variantId }
  if (operation.action === 'script-revise' && operation.fromEpisode !== undefined) scope.fromEpisode = Number(operation.fromEpisode) + 1
  const goal = { to, ...(operation.from ? { from: operation.from } : {}), scope,
    mode: operation.mode || (feedback || operation.generationMode === 'modify' ? 'modify' : operation.generationMode === 'regenerate' ? 'regenerate' : 'generate'),
    ...(feedback ? { feedback } : {}), ...(operation.requirements ? { requirements: operation.requirements } : {}), ...(operation.draft ? { draft: true } : {}),
    ...(operation.referenceDurationSeconds || operation.durationSeconds ? { durationSeconds: Number(operation.referenceDurationSeconds || operation.durationSeconds) } : {}), ...(operation.parts ? { parts: operation.parts } : {}),
    ...(to === 'images' && (operation.aspect || operation.useReference !== undefined || operation.draftId) ? { image: { ...(operation.aspect ? { aspect: operation.aspect } : {}), ...(operation.useReference !== undefined ? { useReference: Boolean(operation.useReference) } : {}), ...(operation.draftId ? { draftId: operation.draftId } : {}) } } : {}) }
  return { goal, ...(operation.episodeId ? { episodeId: operation.episodeId } : {}), ...(operation.episodeNumber ? { episodeNumber: operation.episodeNumber } : {}) }
}
