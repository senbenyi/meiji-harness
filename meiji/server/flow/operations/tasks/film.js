// 任务：成片（逐镜：分镜文本提示词 → 视频）
import { join } from 'node:path'
import { materialize } from '../../../../shared/episode-rules.js'
import { modelRoutes } from '../../../../models/model-config.js'
import { GenerationStatus } from '../../../../shared/drama-model.js'
import { runStep } from '../../../runtime/task-execution.js'
import { shotResults } from '../../../../shared/drama-model.js'
import { feedbackOf } from '../../../../shared/review-feedback.js'
import { h3PromptFailures } from '../../../../shared/video-rules.js'
import { selectCheck } from '../../../runtime/review-checks.js'
import { aspectRatioOf } from '../../../../shared/project-rules.js'
import { gatewayVideoSize, retrieveGatewayVideo } from '../../../gateway/model-gateway.js'
import { shotReferenceImages } from '../../../../shared/reference-images.js'
import { storyboardPromptText } from '../../../../shared/story-content.js'
import { saveLastFrame } from '../../../media/extract-video-tail.js'
import { referenceImageData } from '../../../data/image-storage.js'
import { hasStoryboard } from '../../../../shared/generation-gates.js'
import { projectStore } from '../../../data/project-store.js'
import { previousTail } from '../../../../shared/tail-frame.js'
import { submitH3, prepareFilmOpening, formatFilmRequest, filmSubmit, saveFilmResult, saveTailFrame, submitFilm, writeFilm } from './film-video.js'
import { videoSteps, shotSteps, shotIds } from '../plan-steps.js'

// if (operation.action === 'films')
export async function opFilms(c) {
  let { deps, home, projects, models, project, trace, note } = c
  const rows = shotResults(project, 'storyboard')
  if (!hasStoryboard(project)) throw Object.assign(new Error('请先写好本集全部文本分镜'), { status: 409 })
  if (rows.some(item => !storyboardPromptText(item).trim())) throw Object.assign(new Error('请先生成每一镜的分镜'), { status: 409 })
  if (rows.some(item => feedbackOf(project, `storyboard:${item.id}`).check.passed === false) || feedbackOf(project, 'storyboard').check.passed === false) throw Object.assign(new Error('文本分镜自检未通过，请先修正'), { status: 409 })
  note('按镜头顺序生成所有成片')
  note('文件：server/flow/operations/tasks/film.js')
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
  await projects.save(project.id, {}, { final: true })
  return trace
}

// 单镜制作步骤（produce 与 produce-all 复用）：文本分镜不可用时重新生成并自审 → 视频未完成时提交成片并等待。
// 每一步执行前按最新内容判断是否需要（已完成的跳过）；任一步未通过即停止，因为后一镜依赖前一镜的尾帧。
// 子操作经 run（runOperation）执行并复用本任务，步骤写入同一任务记录（见 run-operation.js 的嵌套执行）。
export function tailReady(shot) {
  return shot.tailFrame?.status === GenerationStatus.PASSED && !shot.tailFrame.stale && Boolean(shot.tailFrame.content?.localPath) && shot.tailFrame.content.sourceVideoFile === shot.video.content?.file
}

export async function produceShot(track, { operation, deps, run, trace }) {
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
export const producing = new Set()

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

export const opProduce = c => produceShots(c.operation, c.deps, c.deps.runOperation)

export const operations = {
  produce: { label: '生成本镜文本和视频', maxRevisions: 0, scope: 'shot', queue: 'video', agent: true, plan: (_, op) => shotSteps(op.track), stage: 'project', run: opProduce },
  'produce-all': { label: '依次生成文本和视频', maxRevisions: 0, scope: 'episode', queue: 'video', agent: true, plan: project => shotIds(project).flatMap(shotSteps), stage: 'project', run: opProduce },
  films: { label: '一键成片', maxRevisions: 0, scope: 'episode', queue: 'video', agent: true, plan: project => shotIds(project).flatMap(videoSteps), stage: 'episode', run: opFilms },
}
