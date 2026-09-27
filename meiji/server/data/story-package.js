import { contentNode, cardModel } from '../../client/drama-model.js'
// Keep confirmed assets attached to stable names while replacing generated descriptions.
export function preserveStoryAssets(project, result) {
  const patch = { outline: contentNode(project.plot.outline, result.outline, result.check) }
  for (const [key, prefix] of [['characters', 'C'], ['scenes', 'E']]) {
    const oldItems = project.plot[key]?.items || []
    let next = Math.max(0, ...oldItems.map(item => Number(item.id?.slice(1)) || 0))
    const names = new Set()
    patch[key] = { ...project.plot[key], check: result.check, status: result.check.passed ? 'passed' : 'failed', items: result[key].items.map(item => {
      if (names.has(item.name)) throw new Error(`名称重复：${item.name}`)
      names.add(item.name)
      const old = oldItems.find(value => value.name === item.name)
      const kept = {}
      if (old) for (const field of ['image', 'clothes', 'props', 'hairstyles', 'parts']) {
        if (old[field] !== undefined) kept[field] = old[field]
      }
      const { file, localPath, imageUrl, assetId, assetCategory, ...description } = item
      return { ...cardModel({ ...description, localPath: null, imageUrl: null, ...kept, id: old?.id || `${prefix}${String(++next).padStart(2, '0')}` }), check: result.check, status: result.check.passed ? 'passed' : 'failed' }
    }) }
  }
  return patch
}
