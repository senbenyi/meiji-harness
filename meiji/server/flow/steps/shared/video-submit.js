import { storyboardPromptText } from '../../../../shared/story-content.js'
// 视频请求、产物保存与状态写入的公共机制；步骤调度位于任务层。
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { GenerationStatus } from '../../../../shared/drama-model.js'
import { node } from '../../../../shared/drama-model.js'
import { compileVideoPrompt } from '../../../prompts/video-prompt-renderer.js'
import { aspectRatioOf } from '../../../../shared/project-rules.js'
import { updateShotResult } from '../../../../shared/drama-model.js'
import { submitGatewayVideo, gatewayVideoSize } from '../../../gateway/model-gateway.js'
import { wantsOpeningFrame, bindReferencePrompt, videoRequestMode } from '../../../../shared/video-rules.js'
import { shotReferenceImages } from '../../../../shared/reference-images.js'
import { render } from '../../../prompts/skill-prompts.js'
import { FilmModel } from '../../../prompts/models/video-prompt-model.js'
import { shotMap } from '../../../../shared/drama-model.js'
import { markFailed, markGenerating, markPassed } from '../../../../shared/content-state.js'

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
  if (fields.referenceImages?.length) lines.push(`reference_images 素材清单（本地读取来源；按 Picture 顺序以 Base64 data URL 提交）: ${JSON.stringify(fields.referenceImages)}`)
  if (fields.inputReference) lines.push(`input_reference: ${fields.inputReference}`)
  lines.push('prompt:')
  if (fields.prompt) lines.push(fields.prompt)
  return lines
}

export function filmSubmit(project, item, opening) {
  const images = item.video === 'text' ? [] : shotReferenceImages(project, item)
  const shot = (project.shots?.items || []).find(entry => entry.id === item.id)
  if (item.compilerVersion >= 1) {
    const current = compileVideoPrompt(project, shot)
    if ((item.outfitSnapshot !== undefined || current.outfitSnapshot.length) && JSON.stringify(item.outfitSnapshot) !== JSON.stringify(current.outfitSnapshot)) throw Object.assign(new Error('每秒分镜人物着装已变化，请重新组装视频提示词'), {status:409})
    if (shot.seconds.check.passed !== true || item.secondsRevision !== shot.seconds.revision || JSON.stringify(item.referenceSnapshot) !== JSON.stringify(current.referenceSnapshot) || (item.compilerVersion >= 2 || current.characterSnapshot.some(person => person.voiceDescription)) && JSON.stringify(item.characterSnapshot) !== JSON.stringify(current.characterSnapshot)) throw Object.assign(new Error('每秒分镜、人物声音或参考素材已变化，请重新组装视频提示词'), { status: 409 })
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

