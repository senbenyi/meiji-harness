import { pictureOf, node, setContent } from '../../client/drama-model.js'
import { withReviewPrompt, checkContext } from '../data/self-checks.js'
import { loadSkill } from '../../skills/load.js'
import { outputLanguage } from '../data/language.js'
import { setTimeout as delay } from 'node:timers/promises'
import { savePicture, saveImageDraft } from '../data/pictures.js'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateGatewayImage } from './gateway.js'

export function usableLook(text) {
  const look = String(text || '').replace(/\s+/g, ' ').trim()
  const han = look.match(/[\p{L}\p{N}]/gu) || []
  return han.length >= 12 ? look : ''
}

const checkpoint = 'RealVisXL_V5.0_fp16.safetensors'
const negative = 'child, minor, young-looking, underage, bad anatomy, deformed hands, extra fingers, missing fingers, fused fingers, malformed limbs, duplicate body, distorted face, crossed eyes, blurry, low resolution, text, watermark, logo'
const sizes = {
  '1344x768': { width: 1344, height: 768 },
  '768x1344': { width: 768, height: 1344 },
  '16:9': { width: 1344, height: 768 },
  '9:16': { width: 768, height: 1344 },
  '3:4': { width: 864, height: 1152 },
  '1:1': { width: 1024, height: 1024 },
}

export function comfyBaseUrl(value) {
  let url
  try { url = new URL(value) } catch { throw Object.assign(new Error('文生图片：ComfyUI 地址无效'), { status: 400 }) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw Object.assign(new Error('文生图片：ComfyUI 地址无效'), { status: 400 })
  }
  return url.href.replace(/\/$/, '')
}

export function resolveImageBackend(route, env = process.env) {
  if (route?.provider === 'comfyui' && route.baseUrl) return comfyBaseUrl(route.baseUrl)
  if ((route == null || route?.provider == null) && env.COMFYUI_URL) return comfyBaseUrl(env.COMFYUI_URL)
  return null
}

export function imageSize(aspectRatio) {
  return sizes[aspectRatio] || sizes['1344x768']
}

export function imageSeed(id) {
  return createHash('sha256').update(String(id)).digest().readUInt32BE(0)
}

export function imagePrompt(item) {
  const look = usableLook(item?.look)
  if (!look) throw Object.assign(new Error(`${item?.name || '资产'}还没有可用的画面提示词`), { status: 400 })
  return look
}

export function sceneStillPrompt(item) {
  const look = usableLook(item?.look) || String(item?.look || '').trim()
  if (!look) throw Object.assign(new Error(`${item?.name || '场景'}还没有可用的画面提示词`), { status: 400 })
  return look
}

const stillLabels = ['国籍', '身份', '性别', '年代', '年龄', '服装', '身高', '体型', '身型', '面相', '面向']

function labeledValue(text, label) {
  const source = String(text || '')
  const mark = `${label}：`
  const start = source.indexOf(mark)
  if (start < 0) return ''
  const from = start + mark.length
  const next = stillLabels.slice(stillLabels.indexOf(label) + 1).map(item => source.indexOf(`${item}：`, from)).find(index => index >= 0)
  return source.slice(from, next === undefined ? source.length : next).trim()
}

export function characterStillPrompt(item) {
  const pick = (field, label) => String(item?.[field] || labeledValue(item?.look, label) || '').trim()
  const lines = [
    ['国籍', pick('nationality', '国籍') || '中国'],
    ['身份', pick('role', '身份')],
    ['性别', pick('gender', '性别')],
    ['年代', pick('era', '年代')],
    ['年龄', pick('age', '年龄')],
    ['身高', pick('height', '身高')],
    ['体型', [pick('build', '体型'), pick('figure', '身型')].filter(Boolean).join('，')],
    ['面相', pick('features', '面相')],
  ].filter(([, value]) => value)
  lines.push(['形态', characterStillShape(item)])
  return lines.map(([label, value]) => `${label}：${value}`).join(' ')
}

const hanDigit = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

function hanYears(text) {
  const match = String(text || '').match(/([零一二两三四五六七八九十]+)\s*岁/)
  if (!match) return null
  const word = match[1]
  if (word === '十') return 10
  const ten = word.indexOf('十')
  if (ten < 0) return hanDigit[word] ?? null
  const high = ten === 0 ? 1 : hanDigit[word[ten - 1]]
  const low = word[ten + 1] ? hanDigit[word[ten + 1]] : 0
  if (high == null || low == null) return null
  return high * 10 + low
}

function statedAge(item) {
  const age = String(item?.age || labeledValue(item?.look, '年龄') || '')
  const years = age.match(/(\d+)\s*(?:岁|years?\b)/i)
  if (years) return Number(years[1])
  const han = hanYears(age)
  if (han != null) return han
  if (/童|幼|少儿|小孩|儿童|未成年|婴儿|孩童|少年|child|minor|teen|infant|toddler/i.test(age)) return 0
  return null
}

function characterStillShape(item) {
  const years = statedAge(item)
  const framing = '正面全身照，从头到脚都在画面里，灰白纯色背景，成图文件小于 3MB'
  if (years != null && years < 18) return `${framing}。按年龄穿着完整服装，不要裸露`
  return `${framing}。上半身裸露。如果是女性，只穿比基尼，不要画其他衣服、盔甲、鞋帽`
}

export function buildImageGraph({ prompt, seed, width, height, prefix, imageName }) {
  const graph = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['1', 1] } },
    4: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    5: { class_type: 'KSampler', inputs: {
      seed, steps: 30, cfg: 6, sampler_name: 'dpmpp_2m_sde', scheduler: 'karras', denoise: imageName ? 0.55 : 1,
      model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
    } },
    6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    7: { class_type: 'SaveImage', inputs: { filename_prefix: prefix, images: ['6', 0] } },
  }
  if (imageName) {
    graph[8] = { class_type: 'LoadImage', inputs: { image: imageName } }
    graph[9] = { class_type: 'VAEEncode', inputs: { pixels: ['8', 0], vae: ['1', 2] } }
    graph[5].inputs.latent_image = ['9', 0]
  }
  return graph
}

function endpoint(baseUrl, path) {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
}

async function request(baseUrl, path, body, fetchImpl, signal) {
  signal ??= checkContext.getStore()?.signal
  const timeout = AbortSignal.timeout(60 * 1000)
  const response = await fetchImpl(endpoint(baseUrl, path), {
    method: body === undefined ? 'GET' : 'POST',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || result.error || (result.node_errors && Object.keys(result.node_errors).length)) {
    throw Object.assign(new Error(`ComfyUI 文生图请求失败：HTTP ${response.status}`), { status: 502 })
  }
  return result
}

function outputImage(history) {
  const descriptor = Object.values(history.outputs?.['7'] || {}).flat()
    .find(value => value?.filename && value.type === 'output')
  if (!descriptor) throw Object.assign(new Error('ComfyUI 没有返回图片'), { status: 502 })
  return descriptor
}

async function waitPrompt(baseUrl, promptId, { fetchImpl, pause, signal, maxPolls = 900 }) {
  let missing = 0
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    signal?.throwIfAborted()
    const history = await request(baseUrl, `history/${encodeURIComponent(promptId)}`, undefined, fetchImpl, signal)
    const entry = history[promptId]
    const failed = entry?.status?.status_str === 'error'
      || entry?.status?.messages?.some(([type]) => ['execution_error', 'execution_interrupted'].includes(type))
    if (failed) throw Object.assign(new Error('ComfyUI 文生图失败'), { status: 502 })
    if (entry?.status?.completed) return entry
    const queue = await request(baseUrl, 'queue', undefined, fetchImpl, signal)
    const queued = queue.queue_running?.some(item => item[1] === promptId) || queue.queue_pending?.some(item => item[1] === promptId)
    missing = entry || queued ? 0 : missing + 1
    if (missing >= 3) throw Object.assign(new Error('文生图任务已不在 ComfyUI 队列中，不会自动重提'), { status: 502 })
    if (attempt + 1 < maxPolls) await pause(2000, signal)
  }
  throw Object.assign(new Error('图片查询超时，已停止等待，不会自动重新提交；远端任务可能仍在运行'), { status: 504 })
}

async function readJournal(file) {
  try { return JSON.parse(await readFile(file, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

async function uploadReference(baseUrl, bytes, fetchImpl, signal) {
  const body = new FormData()
  body.append('image', new Blob([bytes], { type: 'image/png' }), 'meiji-reference.png')
  signal ??= checkContext.getStore()?.signal
  const timeout = AbortSignal.timeout(60 * 1000)
  const response = await fetchImpl(endpoint(baseUrl, 'upload/image'), { method: 'POST', body, signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.name) throw Object.assign(new Error('ComfyUI 没有收下参考图'), { status: 502 })
  return result.name
}

export async function generateStill({ baseUrl, prompt, seed, width, height, prefix, imageName, jobId, journalFile, fetchImpl = fetch, pause = defaultPause, signal, maxPolls }) {
  signal ??= checkContext.getStore()?.signal
  const deadline = AbortSignal.timeout(30 * 60 * 1000)
  signal = signal ? AbortSignal.any([signal, deadline]) : deadline
  const graph = buildImageGraph({ prompt, seed, width, height, prefix, imageName })
  const promptHash = createHash('sha256').update(JSON.stringify(graph)).digest('hex')
  let journal = await readJournal(journalFile)
  let promptId = journal?.server === baseUrl && journal.promptHash === promptHash ? journal.promptId : null
  if (!promptId) {
    if (journal?.submitting && journal.server === baseUrl && journal.promptHash === promptHash) {
      throw Object.assign(new Error('文生图提交结果未确认，不会自动重提'), { status: 409 })
    }
    journal = { server: baseUrl, promptHash, submitting: true, jobId }
    await writeFile(journalFile, JSON.stringify(journal) + '\n', { mode: 0o600 })
    const submitted = await request(baseUrl, 'prompt', { prompt: graph, client_id: jobId }, fetchImpl, signal)
    if (!submitted.prompt_id) throw Object.assign(new Error('ComfyUI 没有返回任务编号，不会自动重提'), { status: 502 })
    promptId = submitted.prompt_id
    journal = { ...journal, submitting: false, promptId }
    await writeFile(journalFile, JSON.stringify(journal) + '\n', { mode: 0o600 })
  }
  const history = await waitPrompt(baseUrl, promptId, { fetchImpl, pause, signal, maxPolls })
  const descriptor = outputImage(history)
  const view = endpoint(baseUrl, `view?${new URLSearchParams({ filename: descriptor.filename, subfolder: descriptor.subfolder || '', type: 'output' })}`)
  signal ??= checkContext.getStore()?.signal
  const timeout = AbortSignal.timeout(60 * 1000)
  const response = await fetchImpl(view, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  if (!response.ok) throw Object.assign(new Error(`ComfyUI 图片下载失败：HTTP ${response.status}`), { status: 502 })
  return Buffer.from(await response.arrayBuffer())
}

const defaultPause = (ms, signal) => delay(ms, undefined, { signal })


const stillExt = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

export function assetImageUrl(projectId, itemId, version = Date.now(), episodeId = '') {
  return `/plugins/meiji/projects/${projectId}/images/${encodeURIComponent(itemId)}?${episodeId ? `episodeId=${encodeURIComponent(episodeId)}&` : ''}v=${version}`
}

export function isLocalPicture(url) {
  return typeof url === 'string' && (url.startsWith('/plugins/meiji/') || url.startsWith('/images/'))
}

export function pictureRecord(item) {
  if (!item || typeof item !== 'object') return item
  const localPath = item.localPath || (isLocalPicture(item.imageUrl) ? item.imageUrl : null)
  const server = (!isLocalPicture(item.imageUrl) && /^https?:\/\//.test(String(item.imageUrl || '')) ? item.imageUrl : '') || item.file?.url || ''
  const { file, ...rest } = item
  if (item.type === 'role' || item.type === 'scene') {
    const { localPath: _, imageUrl, assetId, assetCategory, prompt, ...card } = rest
    const media = { ...pictureOf(item), ...(prompt ? { prompt } : {}), localPath: localPath || pictureOf(item).localPath || null, imageUrl: server || pictureOf(item).imageUrl || null, ...(assetId ? { assetId, assetCategory } : {}) }
    card.image = setContent(structuredClone(item.image || node(`image:${item.id}`)), media, { passed: Boolean(media.imageUrl), failures: [] })
    return card
  }
  return { ...rest, localPath: localPath || null, imageUrl: server || null }
}

export function imageAsset(item) {
  if (!item || typeof item !== 'object') return null
  const id = String(item.id || '').trim()
  const name = String(item.name || '').trim()
  if (!id || !name) return null
  const pictured = pictureRecord(item)
  return { id, name, ...(pictured.prompt ? { prompt: pictured.prompt } : {}), ...(pictured.assetId ? { assetId: pictured.assetId, assetCategory: pictured.assetCategory } : {}), localPath: pictured.localPath || null, imageUrl: pictured.imageUrl || null }
}

export function imageAssets(list) {
  return (Array.isArray(list) ? list : []).map(imageAsset).filter(Boolean)
}

export const partSlots = {
  clothes: { mark: 'W', label: '衣服' },
  props: { mark: 'P', label: '道具' },
  hairstyles: { mark: 'H', label: '发型' },
}

export function nextPartId(character, slot) {
  const spec = partSlots[slot]
  if (!spec || !character?.id) throw Object.assign(new Error('不支持的图片分组'), { status: 400 })
  const used = new Set(imageAssets(character[slot]).map(item => item.id))
  let index = used.size + 1
  let id = `${character.id}-${spec.mark}${String(index).padStart(2, '0')}`
  while (used.has(id)) {
    index += 1
    id = `${character.id}-${spec.mark}${String(index).padStart(2, '0')}`
  }
  return id
}

export function partPrompt(character, slot) {
  const background = '灰白纯色背景'
  if (slot === 'clothes') return `服装：${character?.costume || '衣服'}。单独展示这套衣服，不要画人，${background}`
  if (slot === 'props') return `道具：${character?.prop || '道具'}。单独展示这件道具，不要画人，${background}`
  if (slot === 'hairstyles') return `发型：${character?.features || character?.name || '发型'}。只画这款发型，不要画全身，${background}`
  throw Object.assign(new Error('不支持的图片分组'), { status: 400 })
}

export function appendImageAsset(assets, characterId, slot, asset) {
  if (!partSlots[slot]) throw Object.assign(new Error('不支持的图片分组'), { status: 400 })
  const picture = imageAsset(asset)
  if (!picture) throw Object.assign(new Error('图片资源缺少编号或名称'), { status: 400 })
  let found = false
  const items = (assets?.items || []).map(entry => {
    if (entry.id !== characterId || entry.type !== 'role') return entry
    found = true
    const list = imageAssets(entry[slot]).filter(item => item.id !== picture.id)
    return { ...entry, [slot]: [...list, picture] }
  })
  if (!found) throw Object.assign(new Error('只有人物可以添加衣服、道具或发型'), { status: 400 })
  return { ...assets, items }
}

export function pencilPrompt(item) {
  if (item?.format === 'text' && item.prompt?.text) return `一张黑白铅笔分镜，按以下提示词的时间顺序绘制关键画面，格子均匀排列并标注时间码，人物与场景保持一致，不新增剧情。镜头 ${item.id}，${item.duration} 秒。\n${item.prompt.text}`
  const panels = Array.isArray(item?.panels) ? item.panels : []
  if (!panels.length) throw Object.assign(new Error('请先写好这一镜的文本分镜'), { status: 409 })
  const lines = [
    '一张黑白铅笔分镜，所有格子画在同一张图里。细铅笔线，留白，不要上色，不要画成真人照片。',
    `一共 ${panels.length} 格，每格一样大，按时间从左到右、从上到下排列，格子之间留出间距。`,
    `${item.id || ''}，${item.duration || panels.length} 秒，场景：${item.scene || ''}`,
  ]
  for (const panel of panels) {
    lines.push(`${panel.time}：${panel.pose}。镜头：${panel.camera}。位置：${panel.space || '沿用这一镜的空间'}`)
  }
  lines.push('每格左上角用很小的字标时间码。不要大标题，不要水印，不要字幕。整张图的每一格都要完整落在画面内。整张图使用灰白纯色背景。')
  return lines.join('\n')
}

export async function submitPencilBoard({ directory, track, prompt, home, projectId, episodeId, aspectRatio = '1344x768', backend, fetchImpl, pause, signal, env, seed = imageSeed(`${track}:${Date.now()}`) }) {
  const text = String(prompt || '').trim()
  if (!text) throw Object.assign(new Error('没有可提交的铅笔分镜提示词'), { status: 409 })
  await mkdir(directory, { recursive: true })
  let bytes
  if (backend?.apiKey) {
    bytes = await generateGatewayImage({
      baseUrl: backend.baseUrl, apiKey: backend.apiKey, model: backend.model,
      prompt: text, aspectRatio, fetchImpl, pause, signal,
    })
  } else {
    const baseUrl = resolveImageBackend(backend, env)
    if (!baseUrl) throw Object.assign(new Error('尚未配置图片执行器。'), { status: 409 })
    const size = imageSize(aspectRatio)
    bytes = await generateStill({
      baseUrl, ...size, seed, prompt: text,
      prefix: `meiji/pencil/${track}`, jobId: `pencil:${track}:${seed}`,
      fetchImpl, pause, signal,
    })
  }
  if (!home) await replaceStill(directory, track, 'png', bytes)
  if (home) return saveImageDraft(home, bytes, 'image/png', 'scenes', `${track}-铅笔分镜`, { source: 'generated', projectId, episodeId, itemId: track, prompt: text })
}

export async function readStill(directory, itemId) {
  for (const [mime, ext] of Object.entries(stillExt)) {
    try {
      return { bytes: await readFile(join(directory, `${itemId}.${ext}`)), mime }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  throw Object.assign(new Error('图片不存在'), { code: 'ENOENT' })
}

export const stillByteLimit = 3 * 1024 * 1024

function runFfmpeg(args, spawnImpl) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args])
    let stderr = ''
    child.stderr?.on('data', chunk => { stderr += chunk })
    child.once('error', error => reject(Object.assign(new Error(error.code === 'ENOENT' ? '本机未安装 FFmpeg' : '图片无法压到 3MB 以内'), { status: error.code === 'ENOENT' ? 503 : 502 })))
    child.once('close', code => {
      if (code === 0) resolve()
      else reject(Object.assign(new Error(stderr.trim() || '图片无法压到 3MB 以内'), { status: 502 }))
    })
  })
}

export async function limitStillBytes(bytes, spawnImpl = spawn) {
  if (!bytes?.length) throw Object.assign(new Error('图片是空的'), { status: 502 })
  if (bytes.length < stillByteLimit) return { ext: 'png', bytes }
  const directory = await mkdtemp(join(tmpdir(), 'meiji-still-'))
  const input = join(directory, 'in.bin')
  const output = join(directory, 'out.jpg')
  try {
    await writeFile(input, bytes)
    for (const quality of [8, 12, 16, 20, 28]) {
      await runFfmpeg(['-i', input, '-q:v', String(quality), output], spawnImpl)
      const next = await readFile(output)
      if (next.length && next.length < stillByteLimit) return { ext: 'jpg', bytes: next }
    }
    throw Object.assign(new Error('图片无法压到 3MB 以内'), { status: 502 })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function replaceStill(directory, itemId, ext, bytes) {
  await mkdir(directory, { recursive: true })
  await Promise.all(Object.values(stillExt).filter(name => name !== ext).map(name => rm(join(directory, `${itemId}.${name}`), { force: true })))
  await writeFile(join(directory, `${itemId}.${ext}`), bytes, { mode: 0o600 })
}

export async function generateStillFile({ directory, itemId, aspectRatio, backend, projectId, episodeId, home, category = 'props', prompt, seed, fetchImpl, pause, signal, env }) {
  const text = String(prompt || '').trim()
  if (!text) throw Object.assign(new Error('没有可提交的画面提示词'), { status: 400 })
  await mkdir(directory, { recursive: true })
  let bytes
  if (backend?.apiKey) {
    bytes = await generateGatewayImage({
      baseUrl: backend.baseUrl, apiKey: backend.apiKey, model: backend.model,
      prompt: text, aspectRatio, fetchImpl, pause, signal,
    })
  } else {
    const baseUrl = resolveImageBackend(backend, env)
    if (!baseUrl) throw Object.assign(new Error('尚未配置图片执行器。请先配置 ComfyUI 地址。'), { status: 409 })
    bytes = await generateStill({
      baseUrl, ...imageSize(aspectRatio), seed, prompt: text,
      prefix: `meiji/${projectId}/${itemId}`, jobId: `${projectId}:${itemId}:${seed}`,
      journalFile: join(directory, `${itemId}.job.json`), fetchImpl, pause, signal,
    })
  }
  const fitted = await limitStillBytes(bytes)
  if (!home) await replaceStill(directory, itemId, fitted.ext, fitted.bytes)
  if (home) return saveImageDraft(home, fitted.bytes, 'image/' + (fitted.ext === 'jpg' ? 'jpeg' : fitted.ext), category, itemId, { source: 'generated', projectId, episodeId, itemId, prompt: text })
  return assetImageUrl(projectId, itemId, seed, episodeId)
}

export async function submitAssetImage({ assets, itemId, aspectRatio, backend, projectId, episodeId, directory, fetchImpl, pause, signal, env, prepare, referenceBytes, seed = imageSeed(`${itemId}:${Date.now()}`), home, prompt }) {
  const item = assets?.items?.find(entry => entry.id === itemId)
  if (!item || (item.type !== 'role' && item.type !== 'scene')) throw Object.assign(new Error('只有角色和场景可以生图'), { status: 400 })
  const prepared = prepare ? await prepare(assets) : assets
  const current = prepared.items.find(entry => entry.id === itemId)
  await mkdir(directory, { recursive: true })
  await rm(join(directory, `${itemId}.job.json`), { force: true })
  if (backend?.apiKey) {
    const bytes = await generateGatewayImage({
      baseUrl: backend.baseUrl, apiKey: backend.apiKey, model: backend.model,
      prompt: prompt || imagePrompt(current), aspectRatio, fetchImpl, pause, signal,
    })
    const fitted = await limitStillBytes(bytes)
    if (!home) await replaceStill(directory, itemId, fitted.ext, fitted.bytes)
    const reference = home ? { pendingImage: await saveImageDraft(home, fitted.bytes, 'image/' + (fitted.ext === 'jpg' ? 'jpeg' : fitted.ext), current.type === 'role' ? 'characters' : 'scenes', current.name || itemId, { source: 'generated', projectId, episodeId, itemId, prompt: prompt || imagePrompt(current) }) } : { localPath: assetImageUrl(projectId, itemId, seed, episodeId), imageUrl: null }
    const items = prepared.items.map(entry => entry.id === itemId ? pictureRecord({ ...entry, ...reference, file: null }) : entry)
    return { ...prepared, items }
  }
  const baseUrl = resolveImageBackend(backend, env)
  if (!baseUrl) throw Object.assign(new Error('尚未配置图片执行器。请先配置 ComfyUI 地址。'), { status: 409 })
  const imageName = referenceBytes ? await uploadReference(baseUrl, referenceBytes, fetchImpl, signal) : undefined
  const bytes = await generateStill({
    baseUrl, ...imageSize(aspectRatio), seed, prompt: prompt || imagePrompt(current), imageName,
    prefix: `meiji/${projectId}/${itemId}`, jobId: `${projectId}:${itemId}:${seed}`,
    journalFile: join(directory, `${itemId}.job.json`), fetchImpl, pause, signal,
  })
  const fitted = await limitStillBytes(bytes)
  if (!home) await replaceStill(directory, itemId, fitted.ext, fitted.bytes)
    const reference = home ? { pendingImage: await saveImageDraft(home, fitted.bytes, 'image/' + (fitted.ext === 'jpg' ? 'jpeg' : fitted.ext), current.type === 'role' ? 'characters' : 'scenes', current.name || itemId, { source: 'generated', projectId, episodeId, itemId, prompt: prompt || imagePrompt(current) }) } : { localPath: assetImageUrl(projectId, itemId, seed, episodeId), imageUrl: null }
    const items = prepared.items.map(entry => entry.id === itemId ? pictureRecord({ ...entry, ...reference, file: null }) : entry)
  return { ...prepared, items }
}

export async function importAssetImage({ assets, itemId, projectId, episodeId, directory, bytes, mime, file, home }) {
  const ext = stillExt[mime]
  if (!ext) throw Object.assign(new Error('请上传 PNG、JPG 或 WebP'), { status: 400 })
  if (!bytes?.length) throw Object.assign(new Error('图片是空的'), { status: 400 })
  const item = assets?.items?.find(entry => entry.id === itemId)
  if (!item || (item.type !== 'role' && item.type !== 'scene')) throw Object.assign(new Error('只有角色和场景可以导入图片'), { status: 400 })
  const version = Date.now()
  await replaceStill(directory, itemId, ext, bytes)
  await rm(join(directory, `${itemId}.job.json`), { force: true })
  const url = assetImageUrl(projectId, itemId, version, episodeId)
  const stored = file?.id && file?.url ? { id: String(file.id), url: String(file.url) } : null
  const reference = home ? await savePicture(home, bytes, mime, item.type === 'role' ? 'characters' : 'scenes', item.name || itemId, { source: 'import', projectId, episodeId, itemId }) : { localPath: url }
  const items = assets.items.map(entry => entry.id === itemId ? pictureRecord({ ...entry, ...reference, imageUrl: stored?.url || null, file: stored }) : entry)
  return { ...assets, items }
}

export function clearCharacterImage(assets, itemId) {
  const item = assets?.items?.find(entry => entry.id === itemId)
  if (!item || item.type !== 'role') throw Object.assign(new Error('只有人物可以删除绑定图片'), { status: 400 })
  const items = assets.items.map(entry => {
    if (entry.id !== itemId) return entry
    return { ...entry, image: node(`image:${entry.id}`) }
  })
  return { ...assets, items }
}

export function imageSkillPrompt(skillName, prompt, project) {
  const language = outputLanguage(project?.outputLanguage)
  const style = String(project?.style || '').trim()
  return [
    loadSkill(skillName).content,
    `本次生成语言：${language === 'en' ? 'English（英文）' : '简体中文'}。`,
    style ? `项目视觉风格：${style}。画面须符合该风格。` : '',
    '本次画面要求：',
    withReviewPrompt(prompt),
  ].filter(Boolean).join('\n\n')
}
