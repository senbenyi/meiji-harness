import { previousTail } from '../../shared/tail-frame.js'
import { runTextWorkflow } from './text-workflow.js'
import { buildTablePrompts, buildSingleShotPrompts, buildSecondsPrompts, buildStoryboardPrompts, buildAllSecondsPrompts } from '../prompts/shot-prompts.js'
import { node, shotModel, setContent, shotResults, updateShotResults } from '../../shared/drama-model.js'
import { checkContext, selectCheck } from '../data/self-checks.js'
import { shotReferenceImages } from '../../shared/reference-images.js'
import { shotSecondsReady } from '../../shared/shot-timing.js'
import { runTextRequest } from './text-request.js'
import { recordedNode } from '../data/task-records.js'

function body(shot) { return shot?.content || '' }
// 只读取片段标题中的传输元数据；剧情正文保持原文，不解析 JSON。
export function readShotSections(text, offset = 0) {
  const marks = [...text.matchAll(/^## S(\d+) \/ (\d+)s[ \t]*$/gm)]
  if (!marks.length || text.slice(0, marks[0].index).trim()) throw new Error('镜头表需按「## S01 / 12s」分段，标题前不要添加说明')
  return marks.map((mark, index) => {
    const id = `S${String(offset + index + 1).padStart(2, '0')}`
    const duration = Number(mark[2])
    const body = text.slice(mark.index + mark[0].length, marks[index + 1]?.index ?? text.length).trim()
    if (Number(mark[1]) !== offset + index + 1 || duration < 1 || duration > 15 || !body) throw new Error(`${id} 的编号、1–15秒时长或正文不完整`)
    return shotModel({ id, duration, text: body, cast: [], scene: '', format: 'text' })
  })
}

// 网关可能把被截断的正文标为 stop。只续传未完成尾部，整集齐全前不发布任何片段。
async function completeSeconds(text, message, options) {
  const shots = options.project.shots.items
  let prefix = '', offset = 0, previousOffset = -1
  for (let attempt = 0; ; attempt++) {
    text = String(text).trim()
    if (text.endsWith('[seconds-complete]')) return prefix + text
    const marks = [...text.matchAll(/^## S\d+ \/ \d+s[ \t]*$/gm)]
    const last = marks.at(-1)
    let sections
    try { sections = readShotSections(text + '\n[partial]', offset) }
    catch { throw new Error('每秒指令分段格式不完整，无法安全续传，未覆盖原内容') }
    if (sections.some((section, i) => section.id !== shots[offset + i]?.id || section.duration !== shots[offset + i]?.duration)) throw new Error('每秒指令镜头编号、数量或时长与镜头表不一致，未覆盖原内容')
    const completed = sections.length - 1
    if (attempt === 3 || (!completed && offset === previousOffset)) throw new Error(`整集每秒指令返回不完整：返回到 ${sections.at(-1).id}（共 ${shots.length} 镜），缺少完成标记，续传${attempt === 3 ? '已达 3 次上限' : '未取得进展'}；未覆盖原内容`)
    previousOffset = offset
    if (completed) prefix += text.slice(0, last.index).trimEnd() + '\n\n'
    offset += completed
    const remaining = shots.slice(offset).map(shot => `${shot.id} / ${shot.duration}s`).join('、')
    const scope = `【程序指定的每秒指令续传范围】\n上次返回缺少完成标记。已暂存 ${offset} 镜；只返回剩余镜头：${remaining}。本范围覆盖原请求的一次返回整集要求。首行从「## ${shots[offset].id} / ${shots[offset].duration}s」开始，完整重写本镜，不接半句话，不重复已暂存镜头。所有剩余镜头完成后独占一行写 [seconds-complete]。不改变原任务、修改意见与约束；稳定状态按1–5秒动作节拍合并，避免逐秒重复五类信息。`
    text = await recordedNode('generation', () => runTextRequest({ ...message,
      system: `${message.system}\n\n${scope}`,
      user: `${message.user}\n\n【本轮已暂存正文，仅作衔接依据，不重新输出】\n${prefix || '无'}\n\n${scope}`,
    }, { ...options, logStage: `续传 ${attempt + 1}/3（${shots[offset].id} 起）` }))
  }
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
  const result = await runTextWorkflow({ prompts: buildTablePrompts(options), options, validate: readShotSections, persist: persist && ((text, check) => persist(normalize(text, check))), canRevise: text => { try { readShotSections(text); return true } catch { return false } } })
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

// Generate, review and revise the complete episode as one version.
export async function generateAllSeconds(options) {
  let { project } = options
  const ctx = checkContext.getStore()
  const upstream = { ...project, shots: { ...project.shots, items: project.shots.items.map(shot => ({ ...shot, seconds: { ...shot.seconds, content: null, check: { passed: null } } })) } }
  const parse = text => {
    const trimmed = String(text).trim()
    if (!trimmed.endsWith('[seconds-complete]')) throw new Error('整集每秒指令返回不完整，未覆盖原内容；请重新生成')
    const sections = readShotSections(trimmed.slice(0, -'[seconds-complete]'.length).trim())
    if (sections.length !== project.shots.items.length || sections.some((shot, i) => shot.id !== project.shots.items[i].id || shot.duration !== project.shots.items[i].duration)) throw new Error('每秒指令镜头编号、数量或时长与镜头表不一致，未覆盖原内容')
    return sections
  }
  if (ctx) ctx.target = { action: 'seconds' }
  const result = await runTextWorkflow({ prompts: buildAllSecondsPrompts(options, upstream), options, validate: parse, complete: completeSeconds,
    persist: async (text, check) => {
      const sections = parse(text)
      const shots = { ...project.shots, seconds: setContent(structuredClone(project.shots.seconds), text, check), items: project.shots.items.map((shot, i) => ({ ...shot, seconds: setContent(structuredClone(shot.seconds), sections[i].content, check) })) }
      project = options.persist ? await options.persist(shots, 'draft') : { ...project, shots }
    },
  })
  if (!result.check.passed) throw Object.assign(new Error(`自检未通过：${result.check.failures.join('；')}`), { code: 'CONTENT_CHECK_FAILED', status: 422 })
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
