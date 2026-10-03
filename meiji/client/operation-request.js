// 页面按钮的语义动作转换成统一操作参数；服务端只接受新的操作 id。
export function operationRequest(action, fields = {}) {
  if (action === 'episode-generate' || action === 'episode-summary-draft') return { action: 'summary', ...fields, ...(action === 'episode-summary-draft' ? { draft: true } : {}) }
  if (action === 'outline' || ['characters', 'scenes', 'props'].includes(action)) return { action: 'story', ...fields, ...(action !== 'outline' ? { only: action } : {}) }
  if (action === 'shots' || action === 'revise-shot') return { action: 'shot-table', ...fields }
  if (action === 'shot-seconds') return { action: 'seconds', ...fields }
  if (['produce', 'produce-all', 'storyboard', 'shot-storyboard', 'storyboard-bind', 'films', 'tail-frame'].includes(action)) return { action: 'film', ...fields,
    ...(['storyboard', 'shot-storyboard', 'storyboard-bind'].includes(action) ? { parts: 'storyboard' } : action === 'films' ? { parts: 'video' } : action === 'tail-frame' ? { parts: 'tail' } : {}) }
  if (['image', 'revise-image', 'part-image'].includes(action)) return { action: fields.itemId?.startsWith('E') ? 'scene-image' : fields.itemId?.startsWith('P') ? 'prop-image' : 'character-image', ...fields }
  return { action, ...fields }
}
