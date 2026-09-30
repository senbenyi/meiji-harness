import { checkContext, markApiFailure } from '../data/operation-context.js'
import { setTimeout as delay } from 'node:timers/promises'
import { insertSessionLog, sessionForLog, logPurpose } from '../host/session-log.js'
import { videoSizeOf } from '../../shared/project-rules.js'

const imageSizes = {
  '1344x768': '1344x768',
  '768x1344': '768x1344',
  '16:9': '1344x768',
  '9:16': '768x1344',
  '1:1': '1024x1024',
  '3:4': '896x1152',
  '4:3': '1152x896',
}


const characterAspects = new Set(['9:16', '16:9', '3:4', '4:3', '1:1', '768x1344', '1344x768', '896x1152', '1152x896', '1024x1024'])

export function gatewayImageSize(aspectRatio) {
  return imageSizes[aspectRatio] || imageSizes['1344x768']
}

export function characterImageSize(value) {
  if (value == null || value === '') return imageSizes['9:16']
  const key = String(value).trim()
  if (!characterAspects.has(key)) throw Object.assign(new Error('画幅需为 9:16、3:4、1:1、4:3 或 16:9'), { status: 400 })
  return imageSizes[key]
}

export function gatewayVideoSize(aspectRatio) {
  return videoSizeOf(aspectRatio)
}

// 网关 HTTP 请求体上限 64 MiB；超过时本地报错，不发送。
export const requestByteLimit = 64 * 1024 * 1024

export function dataUrl(bytes, mime) {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
}

function endpoint(baseUrl, path) {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
}

async function readBody(response) {
  const text = await response.text()
  try { return text ? JSON.parse(text) : {} } catch { return { error: { message: text.replace(/\s+/g, ' ').slice(0, 180) } } }
}

function fail(response, data, fallback) {
  const message = data?.error?.message || fallback
  throw markApiFailure(Object.assign(new Error(message), { status: response.status === 401 ? 401 : 502 }))
}

function publicHeaders(headers, apiKey) {
  return Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => {
    const hidden = /authorization/i.test(key) || (apiKey && String(value).includes(apiKey))
    return [key, hidden ? '[已隐藏]' : value]
  }))
}

function publicData(value, apiKey) {
  const json = JSON.stringify(value, (key, item) => {
    if (/api[_-]?key|authorization/i.test(key)) return '[已隐藏]'
    if ((key === 'b64_json' || key === 'input_reference' || key === 'last_frame') && typeof item === 'string') return `[base64 图片，${item.length} 字符]`
    if (typeof item === 'string') return item.replace(/data:[^,\s]*;base64,[A-Za-z0-9+/_=-]+/g, data => `[base64 数据，${data.length - data.indexOf(',') - 1} 字符]`)
    return item
  })
  return apiKey ? json.replaceAll(apiKey, '[已隐藏]') : json
}

function writeApiLog(text, failed) {
  const fn = text.match(/函数：([^\n]+)/)?.[1]
  const purpose = logPurpose() || ({ completeChat: '文本生成', generateGatewayImage: '图片生成', submitGatewayVideo: '视频生成', retrieveGatewayVideo: '查询或下载视频' }[fn] || 'API调用')
  const phase = failed ? '请求失败' : text.includes('返回：') ? '返回数据' : '发起请求'
  try { insertSessionLog(sessionForLog(), text, failed, `日志-${purpose}-${phase}`) } catch { /* 日志不影响接口结果 */ }
}

const requestTimeoutMs = 15 * 60 * 1000

function requestSignal(signal) {
  signal ??= checkContext.getStore()?.signal
  const timeout = AbortSignal.timeout(requestTimeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function requestGateway(options) {
  try { return await requestGatewayRaw(options) } catch (error) { throw markApiFailure(error) }
}
// body 为 FormData 时按 multipart 发送，logBody 描述其内容；否则按 JSON 发送。
async function requestGatewayRaw({ baseUrl, path, method = 'GET', headers, body, logBody, apiKey, fetchImpl, signal, binary = false, fn }) {
  const url = endpoint(baseUrl, path)
  const where = [
    '文件：server/generate/gateway.js',
    `函数：${fn}`,
    `${method} ${url.pathname}${url.search}`,
    `请求地址：${url.href}`,
  ].join('\n')
  const sent = [
    where,
    `请求头：${JSON.stringify(publicHeaders(headers, apiKey))}`,
  ]
  const form = body instanceof FormData
  if (body !== undefined) sent.push(`参数：${publicData(form ? logBody : body, apiKey)}`)
  writeApiLog(sent.join('\n'))
  let response
  try {
    response = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body), signal: requestSignal(signal) })
  } catch (error) {
    writeApiLog(`${where}\n失败：${error?.message || '请求没有完成'}`, true)
    throw markApiFailure(error)
  }
  if (binary && response.ok) {
    const bytes = Buffer.from(await response.arrayBuffer())
    writeApiLog(`${where}\n返回：视频文件 ${bytes.length} 字节`)
    return bytes
  }
  const data = await readBody(response)
  if (!response.ok) {
    const message = data?.error?.message || `HTTP ${response.status}`
    writeApiLog(`${where}\n失败：${publicData(message, apiKey)}`, true)
    return { ok: false, response, data }
  }
  writeApiLog(`${where}\n返回：${publicData(data, apiKey)}`)
  return { ok: true, response, data }
}

export async function completeChat({ baseUrl, apiKey, model, system, prompt, json = false, fetchImpl = fetch, signal }) {
  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: prompt })
  const payload = { model, messages, ...(json ? { response_format: { type: 'json_object' } } : {}) }
  const result = await requestGateway({
    baseUrl, path: 'chat/completions', method: 'POST', apiKey, fetchImpl, signal, fn: 'completeChat',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: payload,
  })
  if (!result.ok) fail(result.response, result.data, `文本生成失败：HTTP ${result.response.status}`)
  const finish = result.data?.choices?.[0]?.finish_reason
  if (finish && finish !== 'stop') throw Object.assign(new Error(`模型输出未正常完成：${finish}`), { status: 502, code: 'INCOMPLETE_MODEL_OUTPUT' })
  const content = result.data?.choices?.[0]?.message?.content
  const text = typeof content === 'string' ? content.trim() : ''
  if (!text) throw markApiFailure(Object.assign(new Error('模型没有返回文本'), { status: 502 }))
  return text
}

const imageExt = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

// 同步生图：无参考图走 images/generations（JSON，可带 seed）；有参考图走 images/edits（multipart，image[] 按顺序上传，不接受 seed）。
// 停止任务会中断请求；网关随之取消这次同步生成。
export async function generateGatewayImage({ baseUrl, apiKey, model, prompt, aspectRatio, seed, references = [], fetchImpl = fetch, signal }) {
  signal ??= checkContext.getStore()?.signal
  signal?.throwIfAborted()
  const size = gatewayImageSize(aspectRatio)
  const headers = { Authorization: `Bearer ${apiKey}` }
  const images = references.filter(item => item?.bytes?.length)
  if (images.length > 10) throw Object.assign(new Error('参考图最多 10 张'), { status: 400 })
  let request
  if (images.length) {
    const body = new FormData()
    body.append('model', model || 'elysium-image')
    body.append('prompt', prompt)
    body.append('size', size)
    images.forEach((item, index) => {
      if (!imageExt[item.mime]) throw Object.assign(new Error('参考图需为 PNG、JPG 或 WebP'), { status: 400 })
      body.append('image[]', new Blob([item.bytes], { type: item.mime }), `reference-${index + 1}.${imageExt[item.mime]}`)
    })
    const logBody = { model: model || 'elysium-image', prompt, size, 'image[]': images.map((item, index) => `reference-${index + 1}.${imageExt[item.mime]}（${item.mime}，${item.bytes.length} 字节）`) }
    request = { path: 'images/edits', headers, body, logBody }
  } else {
    const body = { model: model || 'elysium-image', prompt, size, ...(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff ? { seed } : {}) }
    request = { path: 'images/generations', headers: { ...headers, 'Content-Type': 'application/json' }, body }
  }
  const result = await requestGateway({ baseUrl, method: 'POST', apiKey, fetchImpl, signal, fn: 'generateGatewayImage', ...request })
  if (!result.ok) fail(result.response, result.data, `图片生成失败：HTTP ${result.response.status}`)
  const encoded = result.data?.data?.[0]?.b64_json
  if (typeof encoded !== 'string' || !encoded) throw markApiFailure(Object.assign(new Error('网关未返回图片'), { status: 502 }))
  const bytes = Buffer.from(encoded, 'base64')
  if (!bytes.length) throw markApiFailure(Object.assign(new Error('网关返回的图片是空的'), { status: 502 }))
  return bytes
}

// 网关不提供取消接口：停止只结束本地等待，如实说明远端任务可能仍在运行。
function notCancelled(promptId) {
  return Object.assign(new Error(`任务已停止；网关不提供取消接口，远端视频任务（${promptId}）可能仍在运行`), { code: 'REMOTE_NOT_CANCELLED' })
}

// 参考素材为 base64 data URL（reference_images 按 <Picture N> 顺序），首帧可为 data URL 或裸 base64。
export async function submitGatewayVideo({ baseUrl, apiKey, model, prompt, duration, aspectRatio, mode, inputReference, referenceImages, fetchImpl = fetch, signal }) {
  signal ??= checkContext.getStore()?.signal
  signal?.throwIfAborted()
  const seconds = String(Math.round(Number(duration) || 5))
  const body = {
    model: model || 'elysium-video',
    prompt,
    seconds,
    size: gatewayVideoSize(aspectRatio),
  }
  const images = (referenceImages || []).map(item => String(item || '').trim()).filter(Boolean)
  if (images.length > 9) throw Object.assign(new Error('参考图最多 9 张'), { status: 409 })
  if (images.some(item => !/^data:image\/(?:png|jpeg|webp);base64,/.test(item))) throw Object.assign(new Error('参考图需为 PNG、JPG 或 WebP 的 base64 data URL'), { status: 409 })
  const kind = ['text', 'first_frame', 'reference'].includes(mode) ? mode : (images.length ? 'reference' : inputReference ? 'first_frame' : 'text')
  if (kind === 'reference') body.reference_images = images
  else if (kind === 'first_frame' && inputReference) body.input_reference = inputReference
  const size = Buffer.byteLength(JSON.stringify(body))
  if (size > requestByteLimit) throw Object.assign(new Error(`视频请求 ${(size / 1024 / 1024).toFixed(1)} MiB，超过网关 64 MiB 上限，请减少或压缩参考图`), { status: 413 })
  // 提交期间保留连接取得任务 ID，停止时才能如实记录远端任务。
  const result = await requestGateway({
    baseUrl, path: 'videos', method: 'POST', apiKey, fetchImpl, signal: AbortSignal.timeout(requestTimeoutMs), fn: 'submitGatewayVideo',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body,
  })
  if (!result.ok) fail(result.response, result.data, `视频提交失败：HTTP ${result.response.status}`)
  if (!result.data?.id) throw markApiFailure(Object.assign(new Error('网关未返回视频任务'), { status: 502 }))
  if (signal?.aborted) throw notCancelled(result.data.id)
  return { id: result.data.id, seconds, size: body.size }
}

const wait = (ms, signal) => delay(ms, undefined, { signal })

export async function retrieveGatewayVideo({ baseUrl, apiKey, promptId, fetchImpl = fetch, pause = wait, signal, maxPolls = 360 }) {
  signal ??= checkContext.getStore()?.signal
  const fn = 'retrieveGatewayVideo'
  const deadline = AbortSignal.timeout(30 * 60 * 1000)
  const pollingSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
  const path = `videos/${encodeURIComponent(promptId)}`
  const headers = { Authorization: `Bearer ${apiKey}` }
  let terminal = false
  try {
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      pollingSignal.throwIfAborted()
      const result = await requestGateway({ baseUrl, path, apiKey, fetchImpl, signal: pollingSignal, fn, headers })
      if (!result.ok) fail(result.response, result.data, `视频查询失败：HTTP ${result.response.status}`)
      const data = result.data
      if (['failed', 'cancelled', 'canceled', 'expired'].includes(data.status)) {
        terminal = true
        throw markApiFailure(Object.assign(new Error(`视频生成失败：${data.error?.message || data.status}`), { status: 502, code: 'VIDEO_TASK_TERMINAL' }))
      }
      if (data.status === 'completed') {
        terminal = true
        pollingSignal.throwIfAborted()
        const bytes = await requestGateway({ baseUrl, path: `${path}/content`, apiKey, fetchImpl, signal: pollingSignal, binary: true, fn, headers })
        pollingSignal.throwIfAborted()
        if (Buffer.isBuffer(bytes)) return bytes
        fail(bytes.response, bytes.data, `视频下载失败：HTTP ${bytes.response.status}`)
      }
      if (attempt + 1 < maxPolls) await pause(5000, pollingSignal)
    }
    throw markApiFailure(Object.assign(new Error(`视频查询超时，已停止等待，不会自动重新提交；网关不提供取消接口，远端任务可能仍在运行（${promptId}）`), { status: 504 }))
  } catch (error) {
    if (!terminal && signal?.aborted && signal.reason?.name !== 'TimeoutError') throw notCancelled(promptId)
    if (!terminal && deadline.aborted) throw markApiFailure(Object.assign(new Error(`视频查询超时，已停止等待，不会自动重新提交；网关不提供取消接口，远端任务可能仍在运行（${promptId}）`), { status: 504 }))
    throw error
  }
}
