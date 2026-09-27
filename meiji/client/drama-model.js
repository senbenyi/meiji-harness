// Shared business model. Persisted data and API responses use this schema only.
export const schemaVersion = 2
export const statusLabels = { 'not-generated': '未生成', generating: '生成中', failed: '未通过', passed: '已通过' }
export const emptyCheck = () => ({ passed: null, failures: [], revision: null })
export const emptyReview = () => ({ text: '', revision: 0, history: [] })
export function node(id, content = null) {
  return { id, revision: 0, status: 'not-generated', content, check: emptyCheck(), review: emptyReview(), draft: { text: null, revision: 0, baseRevision: null }, operation: null, error: null, dependencies: {}, stale: false }
}
export function shotModel(fields) {
  const { id, text = '', ...content } = fields
  return { ...node(id, text), ...content, seconds: node(`seconds:${id}`), storyboard: node(`storyboard:${id}`), pencil: node(`pencil:${id}`), video: node(`film:${id}`), tailFrame: node(`tailFrame:${id}`) }
}
export function episodeModel(id, fields) {
  return { id, ...fields, status: 'not-generated', revision: 0, summary: node('summary', fields.summary),
    plot: { ...node('plot'), outline: node('outline'), characters: { ...node('characters'), items: [] }, scenes: { ...node('scenes'), items: [] } },
    shots: { ...node('shots'), items: [] }, assembly: node('assembly'), customSkills: {}, pendingImages: {}, activity: null, activityError: null }
}
export function targetNode(project, key) {
  const [kind, id, slot] = key.split(':')
  if (kind === 'summary') return project.summary
  if (kind === 'plot') return project.plot
  if (kind === 'outline') return project.plot?.outline
  if (kind === 'characters' || kind === 'scenes') {
    const bag = project.plot?.[kind]
    return id ? bag?.items.find(item => item.id === id) : bag
  }
  if (kind === 'image') {
    const item = [...(project.plot?.characters.items || []), ...(project.plot?.scenes.items || [])].find(item => item.id === id)
    return slot ? item?.parts?.[slot] : item?.image
  }
  if (kind === 'shots') return project.shots
  if (kind === 'assembly') return project.assembly
  const shot = project.shots?.items.find(item => item.id === id)
  if (kind === 'shot') return shot
  if (!id && /^S\d+$/.test(kind)) return project.shots?.items.find(item => item.id === kind)
  if (!id && /^[CE]\d+$/.test(kind)) return [...(project.plot?.characters.items || []), ...(project.plot?.scenes.items || [])].find(item => item.id === kind)
  return shot?.[{ seconds: 'seconds', storyboard: 'storyboard', pencil: 'pencil', film: 'video', tailFrame: 'tailFrame' }[kind]]
}
export function allNodes(project) {
  const result = [project.summary, project.plot, project.plot?.outline, project.plot?.characters, project.plot?.scenes, project.shots, project.assembly]
  for (const bag of [project.plot?.characters, project.plot?.scenes]) for (const item of bag?.items || []) result.push(item, item.image, ...Object.values(item.parts || {}))
  for (const shot of project.shots?.items || []) result.push(shot, shot.seconds, shot.storyboard, shot.pencil, shot.video, shot.tailFrame)
  return result.filter(Boolean)
}
export function setContent(target, content, check = emptyCheck()) {
  target.content = content
  target.revision++
  target.check = { ...check, revision: target.revision }
  target.error = null
  target.stale = false
  target.status = check.passed === true ? 'passed' : content == null ? 'not-generated' : 'failed'
  return target
}
export function begin(target, operation) {
  if (target.operation) throw Object.assign(new Error('该节点已有任务正在执行'), { status: 409 })
  target.operation = { ...operation, sourceRevision: target.revision, reviewRevision: target.review.revision, reviewText: target.review.text, phase: 'generating' }
  target.status = 'generating'
  target.error = null
}
export function finish(target, check) {
  target.check = { ...check, revision: target.revision }
  target.status = check.passed ? 'passed' : 'failed'
  if (check.passed && target.operation?.reviewRevision === target.review.revision) target.review.text = ''
  target.operation = null
  target.error = null
}
export function saveReview(target, text, expectedRevision) {
  if (typeof text !== 'string' || text.length > 2000) throw Object.assign(new Error('修改意见不能超过 2000 字'), { status: 400 })
  if (expectedRevision !== undefined && expectedRevision !== target.review.revision) throw Object.assign(new Error('修改意见已更新，请刷新后重试'), { status: 409 })
  if (target.review.text === text) return
  target.review = { ...target.review, text, revision: target.review.revision + 1 }
}
export function shotResults(project, kind) {
  return (project.shots?.items || []).filter(shot => shot[kind]?.content).map(shot => ({ id: shot.id, ...shot[kind].content }))
}
export function shotResult(project, kind, id) { return project.shots?.items.find(shot => shot.id === id)?.[kind]?.content || null }
export function updateShotResult(project, kind, id, content) {
  const shots = structuredClone(project.shots)
  const shot = shots.items.find(item => item.id === id)
  if (!shot) throw Object.assign(new Error('镜头不存在'), { status: 404 })
  setContent(shot[kind], content)
  return { shots }
}
export function updateShotResults(project, kind, results) {
  const shots = structuredClone(project.shots)
  for (const result of results) {
    const shot = shots.items.find(item => item.id === result.id)
    if (!shot) throw Object.assign(new Error('镜头不存在'), { status: 404 })
    const { id, ...content } = result
    if (JSON.stringify(shot[kind].content) !== JSON.stringify(content)) setContent(shot[kind], content)
  }
  return { shots }
}
export function aggregateStatus(nodes) {
  if (nodes.some(item => item.status === 'generating')) return 'generating'
  if (nodes.some(item => item.status === 'failed' || item.stale)) return 'failed'
  return nodes.length && nodes.every(item => item.status === 'passed') ? 'passed' : 'not-generated'
}
export function assertDrama(project) {
  if (project.schemaVersion !== schemaVersion) throw new Error('项目格式需先执行一次性 Model 迁移，运行时不兼容旧格式')
  if (!Array.isArray(project.episodes)) throw new Error('项目缺少剧集集合')
  for (const episode of project.episodes) {
    if (['feedback', 'outline', 'characters', 'scenes', 'storyboard', 'boards', 'films'].some(key => Object.hasOwn(episode, key))) throw new Error('剧集包含已移除的旧字段')
    if (!episode.plot || !episode.shots?.items || !episode.summary?.check) throw new Error('剧集 Model 不完整')
    for (const value of allNodes(episode)) {
      if (!Object.hasOwn(statusLabels, value.status) || !value.check || !value.review) throw new Error(`节点 ${value.id} 不完整`)
    }
  }
  return project
}

export function shotMap(project, kind) { return Object.fromEntries(shotResults(project, kind).map(({ id, ...content }) => [id, content])) }
export function pictureOf(item) { return item?.type === 'role' || item?.type === 'scene' ? item.image?.content || {} : item || {} }
export function cardModel(fields) {
  const { id, image, localPath, imageUrl, assetId, assetCategory, file, ...data } = fields
  const media = image || node(`image:${id}`, localPath || imageUrl || assetId ? { localPath, imageUrl, assetId, assetCategory } : null)
  if (media.content?.imageUrl) { media.status = 'passed'; media.check.passed = true }
  return { ...node(id), ...data, image: media, parts: data.parts || Object.fromEntries(['clothes', 'props', 'hairstyles'].map(slot => [slot, node(`image:${id}:${slot}`)])) }
}
export function plotPatch(project, values) { return { plot: { ...project.plot, ...values } } }
export function contentNode(previous, content, check = emptyCheck()) { return setContent(structuredClone(previous), content, check) }
export function modelPatch(project, changes) {
  const next = { ...project, ...changes }
  for (const value of allNodes(next)) {
    if (value.check?.passed === true) value.status = 'passed'
    if (value.check?.passed === false || value.error || value.stale) value.status = 'failed'
    if (value.operation) value.status = 'generating'
  }
  if (next.plot) next.plot.status = aggregateStatus([next.plot.outline, next.plot.characters, next.plot.scenes])
  next.status = aggregateStatus([next.summary, next.plot, next.shots, next.assembly].filter(Boolean))
  return next
}

export function saveTextDraft(target, text, expectedRevision) {
  if (text !== null && (typeof text !== 'string' || text.length > 100000)) throw Object.assign(new Error('草稿正文超过 100000 字'), { status: 400 })
  if (expectedRevision !== undefined && expectedRevision !== target.draft.revision) throw Object.assign(new Error('草稿已更新，请刷新后重试'), { status: 409 })
  target.draft = { text, baseRevision: target.draft.text === null ? target.revision : target.draft.baseRevision, revision: target.draft.revision + 1 }
}
export function refreshReferences(episode) {
  for (const shot of episode.shots.items) {
    const story = shot.storyboard.content
    if (!story?.referenceSnapshot) continue
    let changed = false
    story.referenceSnapshot = story.referenceSnapshot.map(ref => {
      const owner = ref.ownerId ? episode.plot.characters.items.find(item => item.id === ref.ownerId) : (ref.kind === 'scenes' ? episode.plot.scenes : episode.plot.characters).items.find(item => item.id === ref.id)
      const item = ref.ownerId ? owner?.[ref.slot]?.find(item => item.id === ref.id) : owner
      if (!item) return ref
      const media = pictureOf(item)
      const url = media.imageUrl || media.localPath || ''
      if (url === ref.url && media.assetId === ref.assetId) return ref
      changed = true
      return { ...ref, url, assetId: media.assetId || null, assetCategory: media.assetCategory || null, localPath: media.localPath || null }
    })
    if (changed) {
      shot.storyboard.revision++
      if (shot.video.content) { shot.video.stale = true; shot.video.status = 'failed' }
      if (shot.pencil.content) { shot.pencil.stale = true; shot.pencil.status = 'failed' }
      if (episode.assembly.content) { episode.assembly.stale = true; episode.assembly.status = 'failed' }
    }
  }
}
