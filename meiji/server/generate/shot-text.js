import { textMaxTokens } from './chat.js'
import { previousTail } from '../../client/tail-frame.js'
import { runTextWorkflow, runGenerationNode } from '../flow/text-workflow.js'
import { buildTablePrompts, buildSingleShotPrompts, buildSecondsPrompts, buildStoryboardPrompts, buildAllSecondsPrompts, buildSecondsReviewPrompts } from '../prompts/shot-prompts.js'
import { node, shotModel, setContent, shotResults, updateShotResults } from '../../client/drama-model.js'
import { checkContext, selectCheck } from '../data/self-checks.js'
import { shotReferenceImages } from '../../client/reference-images.js'
import { shotSecondsReady } from '../../client/shot-timing.js'

function body(shot) { return shot?.content || '' }
// 只读取片段标题中的传输元数据；剧情正文保持原文，不解析 JSON。
export function readShotSections(text) {
  const marks = [...text.matchAll(/^## S(\d+) \/ (\d+)s[ \t]*$/gm)]
  if (!marks.length || text.slice(0, marks[0].index).trim()) throw new Error('镜头表需按「## S01 / 12s」分段，标题前不要添加说明')
  return marks.map((mark, index) => {
    const id = `S${String(index + 1).padStart(2, '0')}`
    const duration = Number(mark[2])
    const body = text.slice(mark.index + mark[0].length, marks[index + 1]?.index ?? text.length).trim()
    if (Number(mark[1]) !== index + 1 || duration < 1 || duration > 15 || !body) throw new Error(`${id} 的编号、1–15秒时长或正文不完整`)
    return shotModel({ id, duration, text: body, cast: [], scene: '', format: 'text' })
  })
}

export async function generateShots(options) {
  const { project, persist } = options
  const original = checkContext.getStore()?.originalProject || project
  const normalize = (text, check, reviewText = '') => {
    let items = []
    const failures = [...check.failures]
    try {
      items = readShotSections(text).map(item => {
        const previous = original.shots?.items?.find(shot => shot.id === item.id && shot.duration === item.duration && body(shot) === item.content)
        return previous ? { ...previous, ...item, cast: previous.cast || [], scene: previous.scene || '' } : item
      })
      const total = items.reduce((sum, item) => sum + item.duration, 0)
      if (Math.abs(total - project.durationSeconds) > 10) failures.push(`镜头总时长 ${total}s，与目标 ${project.durationSeconds}s 相差超过10秒`)
    } catch (error) { failures.push(error.message) }
    // 保存失败原文，不自动重试或把格式错误交给剧情重写循环。
    return { ...node('shots'), revision: project.shots.revision + 1, items, failedOutput: items.length ? '' : text, reviewText, format: 'text', check: { passed: failures.length ? false : check.passed, failures } }
  }
  const result = await runTextWorkflow({ prompts: buildTablePrompts(options), options, persist: persist && ((text, check) => persist(normalize(text, check))), canRevise: text => { try { readShotSections(text); return true } catch { return false } } })
  const shots = normalize(result.text, result.check, result.reviewText)
  const failures = shots.check.failures
  if (persist) {
    if (checkContext.getStore()) checkContext.getStore().validation = []
    await persist(shots)
  }
  if (checkContext.getStore()) checkContext.getStore().validation = failures
  return shots
}

export async function reviseShot(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  if (!shot) throw new Error('没有这一镜')
  const result = await runTextWorkflow({ prompts: buildSingleShotPrompts(options), options, persist: options.persist && ((text, check) => options.persist({ ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, content: text, check } : item), check })) })
  return { ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, content: result.text, check: result.check } : item), check: result.check }
}

// One whole-episode generation, followed by independent reviews of each returned shot.
export async function generateAllSeconds(options) {
  let { project } = options
  const ctx = checkContext.getStore()
  const signal = options.signal || ctx?.signal
  signal?.throwIfAborted()
  for (const shot of project.shots.items) await ctx?.startTarget?.({ action: 'shot-seconds', track: shot.id })
  const upstream = { ...project, shots: { ...project.shots, items: project.shots.items.map(shot => ({ ...shot, seconds: { ...shot.seconds, content: null, check: { passed: null } } })) } }
  const text = await runGenerationNode({ message: buildAllSecondsPrompts(options, upstream).generation, options: { ...options, signal, logPurpose: '整集每秒指令', logStage: '生成', maxTokens: textMaxTokens(project.durationSeconds) } })
  const trimmed = String(text).trim()
  if (!trimmed.endsWith('[seconds-complete]')) throw new Error('整集每秒指令返回不完整，未覆盖原内容；请重新生成')
  const sections = readShotSections(trimmed.slice(0, -'[seconds-complete]'.length).trim())
  if (sections.length !== project.shots.items.length || sections.some((shot, i) => shot.id !== project.shots.items[i].id || shot.duration !== project.shots.items[i].duration)) throw new Error('每秒指令镜头编号、数量或时长与镜头表不一致，未覆盖原内容')
  if (ctx) { ctx.target = { action: 'seconds' }; ctx.validation = []; ctx.deferCheckFailure = true }
  const failures = []
  try {
    project = { ...project, shots: { ...project.shots, items: project.shots.items.map((shot, i) => ({ ...shot, seconds: setContent(structuredClone(shot.seconds), sections[i].content) })) } }
    if (options.persist) {
      if (ctx) ctx.textNodeSaving = true
      try {
        project = await options.persist(project.shots, 'draft')
        if (ctx) ctx.textDraftSaved = true
      } finally { if (ctx) ctx.textNodeSaving = false }
    }
    for (const shot of project.shots.items) {
      signal?.throwIfAborted()
      await selectCheck(project, { action: 'shot-seconds', track: shot.id })
      const neighbors = project.shots.items.filter(item => Math.abs(project.shots.items.indexOf(item) - project.shots.items.indexOf(shot)) === 1)
      const result = await runTextWorkflow({ initialText: shot.seconds.content,
        prompts: buildSecondsReviewPrompts({ ...options, project, shotId: shot.id }, upstream, shot, neighbors),
        options: { ...options, project, signal, shotId: shot.id },
        persist: async (text, check) => {
          project = { ...project, shots: { ...project.shots, items: project.shots.items.map(item => item.id === shot.id ? { ...item, seconds: setContent(structuredClone(item.seconds), text, check) } : item) } }
          if (options.persist) project = await options.persist(project.shots, 'review')
        },
      })
      const items = project.shots.items.map(item => item.id === shot.id ? { ...item, seconds: setContent(structuredClone(item.seconds), result.text, result.check) } : item)
      project = { ...project, shots: { ...project.shots, items } }
      if (options.persist) project = await options.persist(project.shots, 'review')
      if (!result.check.passed) failures.push(`${shot.id}：${result.check.failures.join('；')}`)
    }
  } finally {
    if (ctx) { ctx.deferCheckFailure = false; ctx.target = { action: 'seconds' }; ctx.validation = [] }
  }
  if (failures.length) throw Object.assign(new Error(`自检未通过：${failures.join('；')}`), { code: 'CONTENT_CHECK_FAILED', status: 422 })
  return project.shots
}

export async function generateShotSeconds(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  if (!shot) throw new Error('没有这一镜')
  const result = await runTextWorkflow({ prompts: buildSecondsPrompts(options), options, persist: options.persist && ((text, check) => options.persist({ ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, seconds: setContent(structuredClone(item.seconds), text, check) } : item) })) })
  return { ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, seconds: setContent(structuredClone(item.seconds), result.text, result.check) } : item) }
}

export async function generateShotStoryboard(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  if (!shot || !shotSecondsReady(shot)) throw Object.assign(new Error('请先生成这一镜的每秒指令'), { status: 409 })
  const source = `${body(shot)}\n${shot.seconds.content || ''}`
  const characters = shot.cast?.length ? [...shot.cast] : [...new Set([ ...(project.plot.characters?.items || []).filter(person => person.name && source.includes(person.name)).map(person => person.name)])]
  const scenes = shot.scene ? [shot.scene] : [...new Set([ ...(project.plot.scenes?.items || []).filter(scene => scene.name && source.includes(scene.name)).map(scene => scene.name)])]
  const images = shotReferenceImages(project, { ...shot, characters, scenes })
  const tail = previousTail(project, shotId)
  if (tail) images.push({ url: tail.imageUrl, label: `上一镜 ${tail.sourceShotId} 尾帧（连续剧情承接状态，转场直接进入新场景）`, kind: 'tailFrame', sourceShotId: tail.sourceShotId, sourceVideoFile: tail.sourceVideoFile })
  if (images.length > 9) throw new Error('含尾帧的参考图超过9张，请减少角色附属素材')
  // 使用已确认的远程地址；不把尚待确认或仅有本地地址的图片送入视频接口。
  if (images.some(image => !/^https?:\/\//.test(image.url))) throw Object.assign(new Error('请先确认并上传本镜参考图片'), { status: 409 })
  const video = images.length ? 'reference' : 'text'
  const refs = images.map((image, i) => `<Picture ${i + 1}> ${image.label} URL: ${image.url}`).join('\n')
  const result = await runTextWorkflow({ prompts: buildStoryboardPrompts(options, { shot, video, characters, scenes, refs, images }), options })
  const marker = /^\[opening-reference: (previous-tail|none)\][ \t]*\r?\n/.exec(result.text)
  const openingReference = video === 'reference' && project.shots.items[0].id !== shotId && marker?.[1] === 'previous-tail' ? 'previous-tail' : 'none'
  const promptText = marker ? result.text.slice(marker[0].length) : result.text
  const item = { tailReference: tail ? { sourceShotId: tail.sourceShotId, sourceVideoFile: tail.sourceVideoFile, imageUrl: tail.imageUrl } : null, openingReference, id: shotId, duration: shot.duration, title: shotId, format: 'text', video, scene: scenes[0] || '', scenes, characters, referenceSnapshot: structuredClone(images), prompt: { text: promptText }, reviewText: result.reviewText }
  const byId = new Map(shotResults(project, 'storyboard').map(item => [item.id, item]))
  byId.set(shotId, item)
  return project.shots.items.map(shot => byId.get(shot.id)).filter(Boolean)
}

export async function generateStoryboard(options) {
  let project = options.project
  for (const shot of project.shots.items) {
    if (options.beforeShot) project = await options.beforeShot(shot.id)
    await selectCheck(project, { action: 'shot-storyboard', track: shot.id })
    project = { ...project, ...updateShotResults(project, 'storyboard', await generateShotStoryboard({ ...options, project, shotId: shot.id })) }
    if (options.persist) await options.persist(shotResults(project, 'storyboard'))
    if (checkContext.getStore()?.validation?.length) break
  }
  return shotResults(project, 'storyboard')
}
