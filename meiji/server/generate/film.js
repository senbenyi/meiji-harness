import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { retrieveGatewayVideo, submitGatewayVideo } from './gateway.js'

export { shotReferenceImages } from '../../shared/reference-images.js'

export function h3PromptFailures(prompt, images = [], mode = images.length ? 'reference' : 'text') {
  const text = String(prompt || '').trim()
  const fields = mode === 'reference'
    ? ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music']
    : ['integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music']
  const failures = []
  const marks = fields.map(field => new RegExp(`(?:^|\\n)\\s*${field}\\s*:`, 'i').exec(text))
  if (marks.some((mark, i) => !mark || (i && mark.index <= marks[i - 1]?.index))) {
    failures.push(`H3 ${mode} 提示词必须按顺序包含 ${fields.join('、')}`)
    return failures
  }
  if (marks.some((mark, i) => !text.slice(mark.index + mark[0].length, marks[i + 1]?.index ?? text.length).trim())) failures.push('H3 提示词字段内容不能为空')
  const pictures = [...text.matchAll(/<Picture\s+(\d+)>/g)].map(match => Number(match[1]))
  if (mode === 'reference') {
    if (pictures.some(n => n < 1 || n > images.length) || images.some((_, i) => !pictures.includes(i + 1))) failures.push('参考图片编号与提交素材不一致，所有素材必须按顺序绑定')
    const definitions = text.slice(0, marks[1].index)
    const body = text.slice(marks[3].index, marks[4].index)
    const defined = new Set([...definitions.matchAll(/<Subject\s+(\d+)>/g)].map(m => m[1]))
    const used = [...body.matchAll(/<Subject\s+(\d+)>/g)].map(m => m[1])
    if (!defined.size || !used.length || used.some(id => !defined.has(id))) failures.push('主体必须在 subject_definitions 定义，并在 detailed_description 使用；不能引用未定义的 Subject')
    for (const id of defined) if (!used.includes(id)) failures.push(`Subject ${id} 定义后没有在实际镜头描述中使用`)
  } else if (pictures.length || /<Subject\s+\d+>/.test(text)) failures.push('普通/首帧模式不可引用未定义的 Picture 或 Subject')
  return failures
}

export function bindReferencePrompt(prompt, images) {
  const text = String(prompt || '').trim()
  const failures = h3PromptFailures(text, images)
  if (failures.length) throw Object.assign(new Error(failures.join('；')), { status: 409, code: 'CONTENT_CHECK_FAILED' })
  return text
}

export { videoPromptText as h3PromptText } from '../../shared/video-prompt-text.js'

export function continuesFrame(value) {
  return /同一画面|同一时刻|接着做|最后一秒|\bsame (?:frame|moment)|\bcontinues? (?:the )?action|\blast second\b/i.test(String(value || ''))
}

export function wantsOpeningFrame({ video, continuity, imageCount, link }) {
  if (link === 'first_last' || video === 'first_frame') return true
  if (video === 'reference' || video === 'text') return false
  if (continuesFrame(continuity)) return true
  return imageCount < 1
}

export function videoRequestMode({ video, continuity, hasOpening, imageCount, link }) {
  const asked = ['text', 'first_frame', 'reference'].includes(video) ? video : ''
  const same = continuesFrame(continuity)
  let mode = link === 'first_last' ? 'first_frame' : (asked || (same && hasOpening ? 'first_frame' : imageCount > 0 ? 'reference' : hasOpening ? 'first_frame' : 'text'))
  if (mode === 'text' && imageCount > 0) mode = 'reference'
  if (mode === 'first_frame' && !hasOpening) throw Object.assign(new Error('这一镜要接上一镜尾帧，请先完成上一镜的成片'), { status: 409 })
  if (mode === 'reference' && !imageCount) throw Object.assign(new Error('这一镜要用参考图，请先上传人物或场景图片'), { status: 409 })
  return mode
}

export async function submitH3({ items, route, aspectRatio, fetchImpl = fetch, signal }) {
  if (!Array.isArray(items) || !items.length) throw Object.assign(new Error('没有可提交的镜头提示词'), { status: 409 })
  const apiKey = route?.apiKey
  const baseUrl = String(route?.baseUrl || '').replace(/\/$/, '')
  if (!apiKey || !baseUrl) throw Object.assign(new Error('尚未配置视频网关。'), { status: 409 })
  const shots = []
  for (const item of items) {
    const prompt = String(item.prompt || '').trim()
    if (!prompt) throw Object.assign(new Error(`镜头 ${item.track || shots.length + 1} 没有最终提示词`), { status: 409 })
    const submitted = await submitGatewayVideo({
      baseUrl, apiKey, model: route.model, prompt, duration: item.duration, aspectRatio,
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

export async function retrieveFilm({ baseUrl, promptId, apiKey, fetchImpl = fetch, pause, signal }) {
  return retrieveGatewayVideo({ baseUrl, apiKey, promptId, fetchImpl, pause, signal })
}

export async function saveLastFrame(videoPath, framePath, spawnImpl = spawn) {
  await new Promise((resolve, reject) => {
    const child = spawnImpl('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', videoPath,
      '-map', '0:v:0',
      '-update', '1',
      framePath,
    ])
    let stderr = ''
    child.stderr?.on('data', chunk => { stderr += chunk })
    child.once('error', error => reject(Object.assign(new Error(error.code === 'ENOENT' ? '本机未安装 FFmpeg' : '无法抽出尾帧'), { status: error.code === 'ENOENT' ? 503 : 502 })))
    child.once('close', code => {
      if (code === 0) resolve()
      else reject(Object.assign(new Error(stderr.trim() || '无法抽出上一镜的尾帧'), { status: 502 }))
    })
  })
  const bytes = await readFile(framePath)
  if (!bytes.length) throw Object.assign(new Error('无法抽出上一镜的尾帧'), { status: 502 })
  return bytes
}
