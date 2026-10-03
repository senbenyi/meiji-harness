// Shared business model. Persisted data and API responses use this schema only.
export const schemaVersion = 2
// FAILED includes rejected checks, execution errors and stale content.
export const GenerationStatus = Object.freeze({
  NOT_GENERATED: 'not-generated',
  GENERATING: 'generating',
  PAUSED: 'paused',
  FAILED: 'failed',
  PASSED: 'passed',
})
export const statusLabels = Object.freeze({
  [GenerationStatus.NOT_GENERATED]: '未生成',
  [GenerationStatus.GENERATING]: '生成中',
  [GenerationStatus.PAUSED]: '暂停',
  [GenerationStatus.FAILED]: '未通过',
  [GenerationStatus.PASSED]: '已通过',
})
export const emptyCheck = () => ({ passed: null, failures: [], revision: null })
export const emptyReview = () => ({ text: '', revision: 0, history: [] })
export function node(id, content = null) {
  return { id, revision: 0, status: GenerationStatus.NOT_GENERATED, content, check: emptyCheck(), review: emptyReview(), draft: { text: null, revision: 0, baseRevision: null }, operation: null, error: null, dependencies: {}, stale: false }
}
export function shotModel(fields) {
  const { id, text = '', ...content } = fields
  return { ...node(id, text), ...content, seconds: node(`seconds:${id}`), storyboard: node(`storyboard:${id}`), video: node(`film:${id}`), tailFrame: node(`tailFrame:${id}`) }
}
export function episodeModel(id, fields) {
  return { id, ...fields, supplementalSkills: {}, status: GenerationStatus.NOT_GENERATED, revision: 0, summary: node('summary', fields.summary),
    plot: { ...node('plot'), outline: node('outline'), characters: { ...node('characters'), items: [] }, scenes: { ...node('scenes'), items: [] }, props: { ...node('props'), items: [] } },
    shots: { ...node('shots'), seconds: node('seconds'), items: [] }, assembly: node('assembly'), pendingImages: {} }
}
export function targetNode(project, key) {
  const [kind, id, slot] = key.split(':')
  if (kind === 'summary') return project.summary
  if (kind === 'plot') return project.plot
  if (kind === 'outline') return project.plot?.outline
  if (kind === 'characters' || kind === 'scenes' || kind === 'props') {
    const bag = project.plot?.[kind]
    return id ? bag?.items.find(item => item.id === id) : bag
  }
  if (kind === 'image') {
    const item = [...(project.plot?.characters.items || []), ...(project.plot?.scenes.items || []), ...(project.plot?.props?.items || [])].find(item => item.id === id)
    return slot ? item?.parts?.[slot] : item?.image
  }
  if (kind === 'seconds' && !id) return project.shots?.seconds
  if (kind === 'shots') return project.shots
  if (kind === 'assembly') return project.assembly
  const shot = project.shots?.items.find(item => item.id === id)
  if (kind === 'shot') return shot
  if (!id && /^S\d+$/.test(kind)) return project.shots?.items.find(item => item.id === kind)
  if (!id && /^[CEP]\d+$/.test(kind)) return [...(project.plot?.characters.items || []), ...(project.plot?.scenes.items || []), ...(project.plot?.props?.items || [])].find(item => item.id === kind)
  return shot?.[{ seconds: 'seconds', storyboard: 'storyboard', film: 'video', tailFrame: 'tailFrame' }[kind]]
}
export function allNodes(project) {
  const result = [project.summary, project.plot, project.plot?.outline, project.plot?.characters, project.plot?.scenes, project.plot?.props, project.shots, project.shots?.seconds, project.assembly]
  for (const bag of [project.plot?.characters, project.plot?.scenes, project.plot?.props]) for (const item of bag?.items || []) result.push(item, item.image, ...Object.values(item.parts || {}))
  for (const shot of project.shots?.items || []) result.push(shot, shot.seconds, shot.storyboard, shot.video, shot.tailFrame)
  return result.filter(Boolean)
}
export function setContent(target, content, check = emptyCheck()) {
  target.content = content
  target.revision++
  target.check = { ...check, revision: target.revision }
  target.error = null
  target.stale = false
  target.status = check.passed === true ? GenerationStatus.PASSED : content == null ? GenerationStatus.NOT_GENERATED : GenerationStatus.FAILED
  return target
}
export function begin(target, operation) {
  if (target.operation) throw Object.assign(new Error('该节点已有任务正在执行'), { status: 409 })
  target.operation = { ...operation, sourceRevision: target.revision, reviewRevision: target.review.revision, reviewText: target.review.text, phase: 'generating' }
  target.status = GenerationStatus.GENERATING
  target.error = null
}
export function finish(target, check) {
  target.check = { ...check, revision: target.revision }
  target.status = check.passed ? GenerationStatus.PASSED : GenerationStatus.FAILED
  if (check.passed) consumeReview(target)
  target.operation = null
  target.error = null
}
export function consumeReview(target) {
  if (!target?.operation || target.operation.consumesReview === false || target.operation.reviewRevision !== target.review.revision) return
  target.review = { ...target.review, text: '', revision: target.review.revision + 1 }
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
  if (nodes.some(item => item.status === GenerationStatus.GENERATING)) return GenerationStatus.GENERATING
  if (nodes.some(item => item.status === GenerationStatus.PAUSED)) return GenerationStatus.PAUSED
  if (nodes.some(item => item.status === GenerationStatus.FAILED || item.stale)) return GenerationStatus.FAILED
  return nodes.length && nodes.every(item => item.status === GenerationStatus.PASSED) ? GenerationStatus.PASSED : GenerationStatus.NOT_GENERATED
}
// 旧版网关文件字段：图片远端地址 imageUrl 与上传记录 file（{ id, url }）。网关已不提供文件接口，需迁移删除。
export function hasGatewayFileFields(value) {
  if (Array.isArray(value)) return value.some(hasGatewayFileFields)
  if (!value || typeof value !== 'object') return false
  if (Object.hasOwn(value, 'imageUrl')) return true
  if (value.file && typeof value.file === 'object' && Object.hasOwn(value.file, 'url')) return true
  return Object.values(value).some(hasGatewayFileFields)
}
const runtimeFields = ['activity', 'activityError', 'activeOperation']
export function assertDrama(project) {
  if (project.schemaVersion !== schemaVersion) throw new Error('项目格式需先执行一次性 Model 迁移，运行时不兼容旧格式')
  if (!Array.isArray(project.episodes)) throw new Error('项目缺少剧集集合')
  // 是否在执行由进行中的操作推导（剧集占用），错误记录在任务与内容节点上；旧文件中的运行期字段读取时丢弃，下次保存即清除。
  for (const holder of [project, ...project.episodes]) for (const key of runtimeFields) delete holder[key]
  for (const episode of project.episodes) {
    if (episode.supplementalSkills !== undefined) {
      const supplements = episode.supplementalSkills
      if (!supplements || typeof supplements !== 'object' || Array.isArray(supplements)) throw new Error('节点补充 skill 格式错误')
      for (const [key, items] of Object.entries(supplements)) {
        if (!/^(summary|outline|characters|scenes|props|shots|shot|seconds|text-shot|storyboard|film)(:[A-Za-z0-9_-]+)?$/.test(key) || !Array.isArray(items) || items.length > 20 || new Set(items.map(item => item?.id)).size !== items.length || items.some(item => typeof item?.id !== 'string' || !item.id || typeof item.content !== 'string' || !item.content.trim() || item.content.length > 10000)) throw new Error('节点补充 skill 格式错误')
      }
    }
    // 旧字段需迁移；指导素材继续按剧保存（项目 skills），按集的旧字段需先迁移。
    if (Object.hasOwn(episode, 'customSkills') || Object.hasOwn(episode, 'guidanceAssets')) throw Object.assign(new Error('剧集仍含按集保存的补充 skill 或指导素材，请停止服务后执行：node meiji/scripts/migrate-custom-skills.js <DSH_HOME>'), { code: 'OLD_CUSTOM_SKILLS', status: 409 })
    if (hasGatewayFileFields(episode)) throw Object.assign(new Error('剧集仍含网关文件地址（imageUrl），请停止服务后执行：node meiji/scripts/migrate-image-url.js <DSH_HOME>'), { code: 'OLD_IMAGE_URL', status: 409 })
    if (['feedback', 'outline', 'characters', 'scenes', 'storyboard', 'boards', 'films'].some(key => Object.hasOwn(episode, key))) throw new Error('剧集包含已移除的旧字段')
    if (!episode.plot || !episode.shots?.items || !episode.summary?.check) throw new Error('剧集 Model 不完整')
    if (episode.plot.outline.content != null && (typeof episode.plot.outline.content !== 'object' || Array.isArray(episode.plot.outline.content))) throw Object.assign(new Error('大纲仍为旧字符串，请停止服务后执行：node meiji/scripts/migrate-story-outline.js <DSH_HOME>'), { code: 'OLD_STORY_OUTLINE', status: 409 })
    episode.shots.seconds ??= { ...node('seconds'), review: { ...emptyReview(), text: episode.shots.items.filter(shot => shot.seconds.review.text).map(shot => `${shot.id}：${shot.seconds.review.text}`).join('\n') } }
    for (const value of allNodes(episode)) {
      if (!Object.hasOwn(statusLabels, value.status) || !value.check || !value.review) throw new Error(`节点 ${value.id} 不完整`)
    }
  }
  return project
}

export function shotMap(project, kind) { return Object.fromEntries(shotResults(project, kind).map(({ id, ...content }) => [id, content])) }
export function pictureOf(item) { return item?.type === 'role' || item?.type === 'scene' || item?.type === 'prop' ? item.image?.content || {} : item || {} }
export function cardModel(fields) {
  const { id, image, localPath, assetId, assetCategory, ...data } = fields
  const media = image || node(`image:${id}`, localPath || assetId ? { localPath, assetId, assetCategory } : null)
  if (media.content?.localPath || media.content?.assetId) { media.status = GenerationStatus.PASSED; media.check.passed = true }
  return { ...node(id), ...data, image: media, parts: data.parts || Object.fromEntries(['clothes', 'props', 'hairstyles'].map(slot => [slot, node(`image:${id}:${slot}`)])) }
}
export function plotPatch(project, values) { return { plot: { ...project.plot, ...values } } }
export function contentNode(previous, content, check = emptyCheck()) { return setContent(structuredClone(previous), content, check) }
export function modelPatch(project, changes) {
  const next = { ...project, ...changes }
  for (const value of allNodes(next)) {
    if (value.status === GenerationStatus.PAUSED && !value.operation) continue
    if (value.check?.passed === true) value.status = GenerationStatus.PASSED
    if (value.check?.passed === false || value.error || value.stale) value.status = GenerationStatus.FAILED
    if (value.operation) value.status = GenerationStatus.GENERATING
  }
  if (next.shots?.seconds && next.shots.items.length) {
    const parts = next.shots.items.map(shot => shot.seconds), group = next.shots.seconds
    group.check = { passed: parts.every(value => value.check.passed === true) ? true : parts.some(value => value.check.passed === false) ? false : null, failures: parts.flatMap(value => value.check.passed === false ? value.check.failures.map(reason => `${value.id.split(':')[1]}：${reason}`) : []), revision: group.revision }
    group.status = aggregateStatus(parts)
    group.stale = parts.some(value => value.stale)
  }
  if (next.plot) next.plot.status = aggregateStatus([next.plot.outline, next.plot.characters, next.plot.scenes, next.plot.props].filter(Boolean))
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
    // 程序编译产物冻结引用；提交时重算验证，不悄悄替换 Picture 内容。
    if (story.compilerVersion === 1) continue
    let changed = false
    story.referenceSnapshot = story.referenceSnapshot.map(ref => {
      const owner = ref.ownerId ? episode.plot.characters.items.find(item => item.id === ref.ownerId) : (ref.kind === 'scenes' ? episode.plot.scenes : episode.plot.characters).items.find(item => item.id === ref.id)
      const item = ref.ownerId ? owner?.[ref.slot]?.find(item => item.id === ref.id) : owner
      if (!item) return ref
      const media = pictureOf(item)
      const url = media.localPath || ''
      if (url === ref.url && media.assetId === ref.assetId) return ref
      changed = true
      return { ...ref, url, assetId: media.assetId || null, assetCategory: media.assetCategory || null, localPath: media.localPath || null }
    })
    if (changed) {
      shot.storyboard.revision++
      if (shot.video.content) { shot.video.stale = true; shot.video.status = GenerationStatus.FAILED }
      if (episode.assembly.content) { episode.assembly.stale = true; episode.assembly.status = GenerationStatus.FAILED }
    }
  }
}
