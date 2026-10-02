import { submitGatewayVideo, gatewayVideoSize, retrieveGatewayVideo } from '../../gateway/model-gateway.js'
import { wantsOpeningFrame, bindReferencePrompt, videoRequestMode, h3PromptFailures } from '../../../shared/video-rules.js'
import { shotReferenceImages } from '../../../shared/reference-images.js'
import { aspectRatioOf } from '../../../shared/project-rules.js'
import { compileVideoPrompt } from '../../prompts/video-prompt-renderer.js'
import { join } from 'node:path'
import { render } from '../../prompts/skill-prompts.js'
import { FilmModel } from '../../prompts/models/video-prompt-model.js'
import { storyboardPromptText } from '../../../shared/story-content.js'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { GenerationStatus, node, shotMap, updateShotResult, shotResults, contentNode } from '../../../shared/drama-model.js'
import { saveLastFrame } from '../../media/extract-video-tail.js'
import { referenceImageData } from '../../data/image-storage.js'
import { runStep } from '../../runtime/task-execution.js'
import { modelRoutes } from '../../../models/model-config.js'
import { insertSessionLog } from '../../host/session-log.js'
import { feedbackOf } from '../../../shared/review-feedback.js'
import { selectCheck } from '../../runtime/review-checks.js'
import { hasStoryboard, hasFilm } from '../../../shared/generation-gates.js'
import { concatFilms } from '../../media/concat-videos.js'
import { materialize } from '../../../shared/episode-rules.js'
import { projectStore } from '../../data/project-store.js'
import { previousTail } from '../../../shared/tail-frame.js'

export async function submitH3({ items, route, aspectRatio, fetchImpl = fetch, signal }) {
  if (!Array.isArray(items) || !items.length) throw Object.assign(new Error('没有可提交的镜头提示词'), { status: 409 })
  const apiKey = route?.apiKey
  const baseUrl = String(route?.baseUrl || '').replace(/\/$/, '')
  const shots = []
  for (const item of items) {
    const prompt = String(item.prompt || '').trim()
    if (!prompt) throw Object.assign(new Error(`镜头 ${item.track || shots.length + 1} 没有最终提示词`), { status: 409 })
    const submitted = await submitGatewayVideo({
      baseUrl, apiKey, model: route?.model, prompt, duration: item.duration, aspectRatio,
      mode: item.mode, inputReference: item.inputReference, referenceImages: item.referenceImages, fetchImpl, signal,
    })
    shots.push({ track: item.track || String(shots.length + 1), promptId: submitted.id, duration: Number(submitted.seconds), prompt })
  }
  return { baseUrl, provider: 'elysium', apiKey, shots }
}

export function filmClipUrl(projectId, track, episodeId, version = Date.now()) {
  const episode = episodeId ? `${encodeURIComponent(episodeId)}/` : ''
  return `/plugins/meiji/projects/${encodeURIComponent(projectId)}/films/${episode}${encodeURIComponent(track)}?v=${version}`
}

export async function prepareFilmOpening(project, item) {
  // The storyboard already contains the stored reference; never extract or upload here.
  return {}
}

export function previewFilmSubmit(project, item) {
  const images = item.video === 'text' ? [] : shotReferenceImages(project, item)
  const shot = (project.shots?.items || []).find(entry => entry.id === item.id)
  const wantsFrame = wantsOpeningFrame({
    video: item.video,
    link: item.link,
    continuity: `${shot?.continuity || ''} ${item.carryIn || ''}`,
    imageCount: images.length,
  })
  const payload = filmSubmit(project, item, wantsFrame ? { previous: '', inputReference: 'frame' } : {})
  return {
    model: 'elysium-video',
    seconds: item.duration,
    size: gatewayVideoSize(aspectRatioOf(project.aspectRatio)),
    mode: payload.mode,
    prompt: payload.prompt,
    referenceImages: payload.referenceImages || [],
    openingReference: item.openingReference || 'none',
    inputReference: payload.mode === 'first_frame' ? (payload.note || '上一镜尾帧') : '',
  }
}

export function formatFilmRequest(fields) {
  const lines = [
    '最终提交参数：',
    `model: ${fields.model || 'elysium-video'}`,
    `seconds: ${fields.seconds ?? ''}`,
    `size: ${fields.size || ''}`,
    `mode: ${fields.mode || ''}`,
  ]
  if (fields.referenceImages?.length) lines.push(`reference_images（按顺序转为 base64 data URL 提交）: ${JSON.stringify(fields.referenceImages)}`)
  if (fields.inputReference) lines.push(`input_reference: ${fields.inputReference}`)
  lines.push('prompt:')
  if (fields.prompt) lines.push(fields.prompt)
  return lines
}

export function filmSubmit(project, item, opening) {
  const images = item.video === 'text' ? [] : shotReferenceImages(project, item)
  const shot = (project.shots?.items || []).find(entry => entry.id === item.id)
  if (shot?.storyboard.stale) throw Object.assign(new Error('视频提示词已过期，请重新组装'), { status: 409 })
  if (item.compilerVersion === 1) {
    const current = compileVideoPrompt(project, shot)
    if (shot.seconds.stale || shot.seconds.check.passed !== true || item.secondsRevision !== shot.seconds.revision || JSON.stringify(item.referenceSnapshot) !== JSON.stringify(current.referenceSnapshot)) throw Object.assign(new Error('每秒分镜或参考素材已变化，请重新组装视频提示词'), { status: 409 })
  }
  const mode = videoRequestMode({
    video: item.video,
    link: item.link,
    continuity: `${shot?.continuity || ''} ${item.carryIn || ''}`,
    hasOpening: Boolean(opening.inputReference),
    imageCount: images.length,
  })
  const basePrompt = bindReferencePrompt(storyboardPromptText(item), mode === 'reference' ? images : [])
  const prompt = render(new FilmModel({ project, prompt: basePrompt, mode, opening, imageCount: images.length }).toGenerateSegments())
  if (mode === 'reference') {
    return {
      mode,
      prompt,
      referenceImages: [...images.map(image => image.url), ...(opening.referenceUrl ? [opening.referenceUrl] : [])],
      continuityReference: opening.referenceUrl ? { previous: opening.previous, url: opening.referenceUrl, picture: images.length + 1 } : null,
      note: `参考图：${images.map(image => image.label).join('，')}`,
    }
  }
  if (mode === 'first_frame') {
    return {
      mode,
      prompt,
      inputReference: opening.inputReference,
      note: `首帧：上一镜 ${opening.previous} 的尾帧`,
    }
  }
  return { mode, prompt, note: '文生视频：不上传首帧和参考图' }
}

export async function saveFilmResult(projects, project, track, bytes, home) {
  const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'films', project.episodeId || '')
  await mkdir(directory, { recursive: true })
  const name = `${track}-${randomUUID()}`
  const file = `${name}.mp4`
  try {
    await writeFile(join(directory, file), bytes)
    await writeFilm(projects, project.id, track, { status: 'ready', file, url: filmClipUrl(project.id, track, project.episodeId), error: null })

  } catch (error) {
    await rm(join(directory, file), { force: true })
    throw error
  }
  return { file, directory }
}

export async function saveTailFrame(projects, project, track, file, directory, home, saveFrame) {
  const lastFrame = file.replace(/\.mp4$/, '-last.png')
  const tail = node(`tailFrame:${track}`)
  tail.status = GenerationStatus.GENERATING
  tail.content = { sourceVideoFile: file, localPath: null }
  const persistTail = () => projects.save(project.id, current => ({ shots: { ...current.shots, items: current.shots.items.map(s => s.id === track ? { ...s, tailFrame: structuredClone(tail) } : s) } }))
  await persistTail()
  try {
    await saveFrame(join(directory, file), join(directory, lastFrame))
    tail.content.localPath = join(directory, lastFrame)
    tail.status = GenerationStatus.PASSED; tail.check = { passed: true, failures: [] }
  } catch (error) {
    tail.status = GenerationStatus.FAILED; tail.error = error.message || '尾帧处理失败'
    await rm(join(directory, lastFrame), { force: true })
    await persistTail()
    throw error
  }
  await persistTail()
}

// 提交一镜视频。重试一律重新提交，不续查旧的远端任务（服务重启会取消进行中任务）。
// payload.referenceImages 为本地地址；提交时换成 media（按同一顺序的 base64 data URL）。
export async function submitFilm(project, track, payload, route, deps, size, media = []) {
  return (deps.submitH3 || submitH3)({ items: [{ track, duration: project.shots.items.find(shot => shot.id === track).duration, ...payload, referenceImages: media }], route, aspectRatio: size, signal: deps.signal })
}

export const filmWrites = new Map()

export async function writeFilm(projects, projectId, track, patch) {
  const previous = filmWrites.get(projectId) || Promise.resolve()
  const job = previous.catch(() => {}).then(async () => {
    const current = await projects.read(projectId)
    const films = { ...shotMap(current, 'video') }
    let next
    if (films[track]?.file && patch.status !== 'ready') {
      next = structuredClone(current)
      const video = next.shots.items.find(shot => shot.id === track).video
      video.pending = patch
      if (patch.status === 'error') video.error = patch.error
    } else {
      films[track] = { ...(films[track] || {}), ...patch }
      next = { ...updateShotResult(current, 'video', track, films[track]), assembly: node('assembly') }
      next.shots.items.find(shot => shot.id === track).video.pending = null
    }
    if ((patch.status === 'ready' || patch.status === 'error') && current.activity === `film:${track}`) next.activity = null
    await projects.save(projectId, next)
  })
  filmWrites.set(projectId, job)
  try { return await job }
  finally { if (filmWrites.get(projectId) === job) filmWrites.delete(projectId) }
}

// if (operation.action === 'tail-frame')
async function opTailFrame(c) {
  let { operation, deps, home, projects, project, trace } = c
  const track = operation.track, clip = project.shots.items.find(s => s.id === track)?.video.content
  if (clip?.status !== 'ready' || !clip.file) throw new Error('本镜视频尚未完成')
  await saveTailFrame(projects, project, track, clip.file, join(home, 'storages', 'meiji', 'projects', project.id, 'films', project.episodeId || ''), home, deps.saveLastFrame || saveLastFrame)
  return trace
}

// if (operation.action === 'film')
async function opFilm(c) {
  let { operation, deps, home, projects, models, project, trace, note } = c
  if (feedbackOf(project, `storyboard:${operation.track}`).check.passed === false || feedbackOf(project, 'storyboard').check.passed === false) throw Object.assign(new Error('文本分镜自检未通过，请先修正'), { status: 409 })
  const track = String(operation.track || '')
  const item = shotResults(project, 'storyboard').find(entry => entry.id === track)
  if (!item || !/^S[0-9]{2,}$/.test(track)) throw Object.assign(new Error('请在对应镜头上提交这一条成片'), { status: 400 })
  if (!storyboardPromptText(item).trim()) throw Object.assign(new Error('请先生成这一镜的分镜'), { status: 409 })
  const route = (modelRoutes(await models.read())).video
  const images = item.video === 'text' ? [] : shotReferenceImages(project, item)
  await projects.save(project.id, { activity: `film:${track}`, activityError: null })
  try {
    const size = aspectRatioOf(project.aspectRatio)
    let payload
    // 提交视频步骤包含：准备开场帧、组装参数、读取本地参考图转为 base64 并提交。
    const queued = await runStep('video_submit', async () => {
      payload = filmSubmit(project, item, await prepareFilmOpening(project, item, { home, projects, route, deps }))
      const media = payload.mode === 'reference' ? await referenceImageData(home, project, images) : []
      return submitFilm(project, track, payload, route, deps, size, media)
    }, { target: `film:${track}` })
    const shot = queued.shots[0]
    await writeFilm(projects, project.id, track, { status: 'running', terminal: false, promptId: shot.promptId, request: { mode: payload.mode, prompt: payload.prompt, referenceImages: payload.referenceImages || [], continuityReference: payload.continuityReference || null }, assetIds: images.map(image => image.assetId).filter(Boolean), error: null })
    note('已执行：提交成片')
    note('文件：server/flow/operations/video-operations.js')
    note('函数：submitH3')
    note(`${track}，时长 ${shot.duration} 秒`)
    note(payload.note)
    note(formatFilmRequest({ model: 'elysium-video', seconds: shot.duration, mode: payload.mode, size: gatewayVideoSize(size), prompt: payload.prompt, referenceImages: payload.referenceImages, inputReference: payload.mode === 'first_frame' ? payload.note : '' }).join('\n'))
    note('视频还在生成。完成后出现在这一张镜头卡片上。')
    deps.defer((async () => {
      let saved
      try {
        saved = await runStep('video_generate', async () => {
          const bytes = await (deps.retrieveGatewayVideo || retrieveGatewayVideo)({ baseUrl: queued.baseUrl, promptId: shot.promptId, provider: queued.provider, apiKey: queued.apiKey, signal: deps.signal })
          return saveFilmResult(projects, project, track, bytes, home)
        }, { target: `film:${track}`, remoteId: shot.promptId })
      } catch (error) {
        await writeFilm(projects, project.id, track, { status: 'error', terminal: error.code === 'VIDEO_TASK_TERMINAL', error: error.message || '成片生成失败' }).catch(() => {})
        throw error
      }
      insertSessionLog(deps.session, `${track} 成片已生成，正在提取尾帧`)
      await runStep('tail_frame', () => saveTailFrame(projects, project, track, saved.file, saved.directory, home, deps.saveLastFrame || saveLastFrame), { target: `film:${track}` })
      insertSessionLog(deps.session, `${track} 尾帧已提取`)
    })().catch(async error => {
      insertSessionLog(deps.session, error.message || '成片生成失败', true)
    }))
    return trace
  } catch (error) {
    const current = await projects.read(project.id)
    if (current.activity === `film:${track}`) await projects.save(project.id, { activity: null, activityError: error.message })
    throw error
  }
}

// if (operation.action === 'films')
async function opFilms(c) {
  let { deps, home, projects, models, project, trace, note } = c
  const rows = shotResults(project, 'storyboard')
  if (!hasStoryboard(project)) throw Object.assign(new Error('请先写好本集全部文本分镜'), { status: 409 })
  if (rows.some(item => !storyboardPromptText(item).trim())) throw Object.assign(new Error('请先生成每一镜的分镜'), { status: 409 })
  if (rows.some(item => feedbackOf(project, `storyboard:${item.id}`).check.passed === false) || feedbackOf(project, 'storyboard').check.passed === false) throw Object.assign(new Error('文本分镜自检未通过，请先修正'), { status: 409 })
  await projects.save(project.id, { activity: 'films', activityError: null })
  note('按镜头顺序生成所有成片')
  note('文件：server/flow/operations/video-operations.js')
  note('函数：submitH3')
  for (const item of rows) {
    const track = item.id
    const current = await projects.read(project.id)
    const existing = current.shots.items.find(shot => shot.id === track)?.video
    if (existing?.content?.status === 'ready' && !existing.stale) {
      note(`${track} 已完成，跳过重复提交`)
      const completed = current.shots.items.find(shot => shot.id === track)
      if (!tailReady(completed)) await runStep('tail_frame', () => saveTailFrame(projects, current, track, existing.content.file, join(home, 'storages', 'meiji', 'projects', project.id, 'films', project.episodeId || ''), home, deps.saveLastFrame || saveLastFrame), { target: `film:${track}` })
      continue
    }
    await selectCheck(current, { action: 'film', track })
    const route = (modelRoutes(await models.read())).video
    const images = item.video === 'text' ? [] : shotReferenceImages(current, item)
    const size = aspectRatioOf(project.aspectRatio)
    let payload
    // 提交视频步骤包含：准备开场帧、组装参数、读取本地参考图转为 base64 并提交。
    const queued = await runStep('video_submit', async () => {
      payload = filmSubmit(current, item, await prepareFilmOpening(current, item, { home, projects, route, deps }))
      const media = payload.mode === 'reference' ? await referenceImageData(home, current, images) : []
      return submitFilm(current, track, payload, route, deps, size, media)
    }, { target: `film:${track}` })
    const shot = queued.shots[0]
    await writeFilm(projects, project.id, track, { status: 'running', terminal: false, promptId: shot.promptId, request: { mode: payload.mode, prompt: payload.prompt, referenceImages: payload.referenceImages || [], continuityReference: payload.continuityReference || null }, assetIds: images.map(image => image.assetId).filter(Boolean), error: null })
    note(`已提交 ${track}，时长 ${shot.duration} 秒`)
    note(payload.note)
    note(formatFilmRequest({ model: 'elysium-video', seconds: shot.duration, mode: payload.mode, size: gatewayVideoSize(size), prompt: payload.prompt, referenceImages: payload.referenceImages, inputReference: payload.mode === 'first_frame' ? payload.note : '' }).join('\n'))
    let saved
    try {
      saved = await runStep('video_generate', async () => {
        const bytes = await (deps.retrieveGatewayVideo || retrieveGatewayVideo)({ baseUrl: queued.baseUrl, promptId: shot.promptId, provider: queued.provider, apiKey: queued.apiKey, signal: deps.signal })
        return saveFilmResult(projects, project, track, bytes, home)
      }, { target: `film:${track}`, remoteId: shot.promptId })
      note(`${track} 成片已生成`)
    } catch (error) {
      await writeFilm(projects, project.id, track, { status: 'error', terminal: error.code === 'VIDEO_TASK_TERMINAL', error: error.message || '成片生成失败' }).catch(() => {})
      throw error
    }
    await runStep('tail_frame', () => saveTailFrame(projects, project, track, saved.file, saved.directory, home, deps.saveLastFrame || saveLastFrame), { target: `film:${track}` })
    note(`${track} 尾帧已提取`)
  }
  await projects.save(project.id, { activity: null })
  return trace
}

// if (operation.action === 'assemble')
async function opAssemble(c) {
  let { deps, home, projects, project, trace, note } = c
  const rows = project.shots.items
  if (!hasFilm(project)) {
    throw Object.assign(new Error('请先完成本集全部镜头成片'), { status: 409 })
  }
  await projects.save(project.id, { activity: 'assemble', activityError: null })
  const directory = join(home, 'storages', 'meiji', 'projects', project.id, 'films', project.episodeId || '')
  await mkdir(directory, { recursive: true })
  const inputs = project.shots.items.map(item => join(directory, item.video.content.file || `${item.id}.mp4`))
  const file = `assembly-${randomUUID()}.mp4`
  const output = join(directory, file)
  note('按镜头顺序拼接成片')
  note('文件：server/media/concat-videos.js')
  note('函数：concatFilms')
  note(rows.map(item => item.id).join('、'))
  await (deps.concatFilms || concatFilms)({ inputs, output })
  const episode = project.episodeId ? `${encodeURIComponent(project.episodeId)}/` : ''
  const url = `/plugins/meiji/projects/${encodeURIComponent(project.id)}/films/${episode}assembly?v=${Date.now()}`
  await projects.save(project.id, { assembly: contentNode(project.assembly, { url, file }, { passed: true, failures: [] }), activity: null })
  note('全片已拼接')
  return trace
}

// 单镜制作步骤（produce 与 produce-all 复用）：文本分镜不可用时重新生成并自审 → 视频未完成时提交成片并等待。
// 每一步执行前按最新内容判断是否需要（已完成的跳过）；任一步未通过即停止，因为后一镜依赖前一镜的尾帧。
// 子操作经 run（runOperation）执行并复用本任务，步骤写入同一任务记录（见 run-operation.js 的嵌套执行）。
function tailReady(shot) {
  return shot.tailFrame?.status === GenerationStatus.PASSED && !shot.tailFrame.stale && Boolean(shot.tailFrame.content?.localPath) && shot.tailFrame.content.sourceVideoFile === shot.video.content?.file
}

async function produceShot(track, { operation, deps, run, trace }) {
  const read = async () => {
    const project = materialize(await projectStore(deps.home).read(operation.projectId), operation.episodeId)
    const shot = project.shots.items.find(item => item.id === track)
    if (!shot) throw new Error('镜头不存在')
    return { project, shot }
  }
  const storyboardUsable = shot => {
    const board = shot.storyboard.content
    return board?.video !== 'first_frame' && shot.storyboard.status === GenerationStatus.PASSED && !h3PromptFailures(storyboardPromptText(board), board?.referenceSnapshot || [], board?.video || 'text').length
  }
  deps.signal?.throwIfAborted()
  const { project, shot } = await read()
  const tail = previousTail(project, track), bound = shot.storyboard.content?.tailReference
  if (!storyboardUsable(shot) || shot.storyboard.stale || (tail?.sourceVideoFile || null) !== (bound?.sourceVideoFile || null)) {
    trace.push(...await run({ ...operation, action: 'shot-storyboard', track }, deps))
    if (!storyboardUsable((await read()).shot)) throw Object.assign(new Error(`${track} 文本分镜未通过自审`), { code: 'CONTENT_CHECK_FAILED' })
  }
  const current = (await read()).shot
  if (current.video.content?.status !== 'ready' || current.video.stale) {
    trace.push(...await run({ ...operation, action: 'film', track }, { ...deps, waitForBackground: true }))
    const { shot: generated } = await read()
    if (generated.video.content?.status !== 'ready') throw new Error(generated.video.content?.error || `${track} 视频未完成`)
    if (!tailReady(generated)) throw new Error(generated.tailFrame?.error || `${track} 尾帧未完成`)
  }
  if (!tailReady((await read()).shot)) trace.push(...await run({ ...operation, action: 'tail-frame', track }, deps))
}

// if (operation.action === 'produce' || operation.action === 'produce-all')
const producing = new Set()

export async function produceShots(operation, deps, run) {
  const key = `${deps.home}:${operation.projectId}:${operation.episodeId}`
  if (producing.has(key)) throw new Error('本集成片流程正在执行')
  producing.add(key)
  const trace = []
  try {
    const project = materialize(await projectStore(deps.home).read(operation.projectId), operation.episodeId)
    const tracks = operation.action === 'produce-all' ? project.shots.items.map(shot => shot.id) : [operation.track]
    for (const track of tracks) await produceShot(track, { operation, deps, run, trace })
    return trace
  } finally { producing.delete(key) }
}

const opProduce = c => produceShots(c.operation, c.deps, c.deps.runOperation)

export const filmOperations = {
  'produce': { stage: 'project', run: opProduce },
  'produce-all': { stage: 'project', run: opProduce },
  'tail-frame': { stage: 'episode', run: opTailFrame },
  'film': { stage: 'episode', run: opFilm },
  'films': { stage: 'episode', run: opFilms },
  'assemble': { stage: 'episode', run: opAssemble },
}
