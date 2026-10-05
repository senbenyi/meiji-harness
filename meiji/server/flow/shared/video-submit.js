// 小任务：生成视频（提交、生成保存、尾帧）
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { modelRoutes } from '../../../models/model-config.js'
import { GenerationStatus } from '../../../shared/drama-model.js'
import { runNode } from '../../runtime/task-execution.js'
import { node, shotResults } from '../../../shared/drama-model.js'
import { feedbackOf } from '../../../shared/review-feedback.js'
import { compileVideoPrompt } from '../../prompts/video-prompt-renderer.js'
import { aspectRatioOf } from '../../../shared/project-rules.js'
import { updateShotResult } from '../../../shared/drama-model.js'
import { submitGatewayVideo, gatewayVideoSize, retrieveGatewayVideo } from '../../gateway/model-gateway.js'
import { wantsOpeningFrame, bindReferencePrompt, videoRequestMode } from '../../../shared/video-rules.js'
import { shotReferenceImages } from '../../../shared/reference-images.js'
import { render } from '../../prompts/skill-prompts.js'
import { FilmModel } from '../../prompts/models/video-prompt-model.js'
import { storyboardPromptText } from '../../../shared/story-content.js'
import { shotMap } from '../../../shared/drama-model.js'
import { saveLastFrame } from '../../media/extract-video-tail.js'
import { referenceImageData } from '../../data/image-storage.js'
import { insertSessionLog } from '../../host/session-log.js'
import { markFailed, markGenerating, markPassed } from '../../../shared/content-state.js'

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
  if (item.compilerVersion === 1) {
    const current = compileVideoPrompt(project, shot)
    if (shot.seconds.check.passed !== true || item.secondsRevision !== shot.seconds.revision || JSON.stringify(item.referenceSnapshot) !== JSON.stringify(current.referenceSnapshot)) throw Object.assign(new Error('每秒分镜或参考素材已变化，请重新组装视频提示词'), { status: 409 })
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
  markGenerating(tail)
  tail.content = { sourceVideoFile: file, localPath: null }
  const persistTail = () => projects.save(project.id, current => ({ shots: { ...current.shots, items: current.shots.items.map(s => s.id === track ? { ...s, tailFrame: structuredClone(tail) } : s) } }))
  await persistTail()
  try {
    await saveFrame(join(directory, file), join(directory, lastFrame))
    tail.content.localPath = join(directory, lastFrame)
    markPassed(tail)
  } catch (error) {
    markFailed(tail, error.message || '尾帧处理失败')
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
    // 视频完成或报错时为本次成片操作的最终写入。
    await projects.save(projectId, next, { final: patch.status === 'ready' || patch.status === 'error' })
  })
  filmWrites.set(projectId, job)
  try { return await job }
  finally { if (filmWrites.get(projectId) === job) filmWrites.delete(projectId) }
}

// if (operation.action === 'tail-frame')
export async function opTailFrame(c) {
  let { operation, deps, home, projects, project, trace } = c
  const track = operation.track, clip = project.shots.items.find(s => s.id === track)?.video.content
  if (clip?.status !== 'ready' || !clip.file) throw new Error('本镜视频尚未完成')
  await runNode('tail_frame', () => saveTailFrame(projects, project, track, clip.file, join(home, 'storages', 'meiji', 'projects', project.id, 'films', project.episodeId || ''), home, deps.saveLastFrame || saveLastFrame), { target: `film:${track}` })
  return trace
}

// if (operation.action === 'film')
export async function opFilm(c) {
  let { operation, deps, home, projects, models, project, trace, note } = c
  if (feedbackOf(project, `storyboard:${operation.track}`).check.passed === false || feedbackOf(project, 'storyboard').check.passed === false) throw Object.assign(new Error('文本分镜自检未通过，请先修正'), { status: 409 })
  const track = String(operation.track || '')
  const item = shotResults(project, 'storyboard').find(entry => entry.id === track)
  if (!item || !/^S[0-9]{2,}$/.test(track)) throw Object.assign(new Error('请在对应镜头上提交这一条成片'), { status: 400 })
  if (!storyboardPromptText(item).trim()) throw Object.assign(new Error('请先生成这一镜的分镜'), { status: 409 })
  const route = (modelRoutes(await models.read())).video
  const images = item.video === 'text' ? [] : shotReferenceImages(project, item)
  try {
    const size = aspectRatioOf(project.aspectRatio)
    let payload
    // 提交视频步骤包含：准备开场帧、组装参数、读取本地参考图转为 base64 并提交。
    const queued = await runNode('video_submit', async () => {
      payload = filmSubmit(project, item, await prepareFilmOpening(project, item, { home, projects, route, deps }))
      const media = payload.mode === 'reference' ? await referenceImageData(home, project, images) : []
      return submitFilm(project, track, payload, route, deps, size, media)
    }, { target: `film:${track}` })
    const shot = queued.shots[0]
    await writeFilm(projects, project.id, track, { status: 'running', terminal: false, promptId: shot.promptId, request: { mode: payload.mode, prompt: payload.prompt, referenceImages: payload.referenceImages || [], continuityReference: payload.continuityReference || null }, assetIds: images.map(image => image.assetId).filter(Boolean), error: null })
    note('已执行：提交成片')
    note('文件：server/flow/shared/video-submit.js')
    note('函数：submitH3')
    note(`${track}，时长 ${shot.duration} 秒`)
    note(payload.note)
    note(formatFilmRequest({ model: 'elysium-video', seconds: shot.duration, mode: payload.mode, size: gatewayVideoSize(size), prompt: payload.prompt, referenceImages: payload.referenceImages, inputReference: payload.mode === 'first_frame' ? payload.note : '' }).join('\n'))
    note('视频还在生成。完成后出现在这一张镜头卡片上。')
    deps.defer((async () => {
      let saved
      try {
        saved = await runNode('video_generate', async () => {
          const bytes = await (deps.retrieveGatewayVideo || retrieveGatewayVideo)({ baseUrl: queued.baseUrl, promptId: shot.promptId, provider: queued.provider, apiKey: queued.apiKey, signal: deps.signal })
          return saveFilmResult(projects, project, track, bytes, home)
        }, { target: `film:${track}`, remoteId: shot.promptId })
      } catch (error) {
        await writeFilm(projects, project.id, track, { status: 'error', terminal: error.code === 'VIDEO_TASK_TERMINAL', error: error.message || '成片生成失败' }).catch(() => {})
        throw error
      }
      insertSessionLog(deps.session, `${track} 成片已生成，正在提取尾帧`)
      await runNode('tail_frame', () => saveTailFrame(projects, project, track, saved.file, saved.directory, home, deps.saveLastFrame || saveLastFrame), { target: `film:${track}` })
      insertSessionLog(deps.session, `${track} 尾帧已提取`)
    })().catch(async error => {
      insertSessionLog(deps.session, error.message || '成片生成失败', true)
      throw error
    }))
    return trace
  } catch (error) {
    await projects.save(project.id, {}, { final: true, error: error.message }).catch(() => {})
    throw error
  }
}
