import { setTimeout as delay } from 'node:timers/promises'
import { insertSessionLog, sessionForLog } from '../flow/session-log.js'

const imageSizes = {
  '1344x768': '1344x768',
  '768x1344': '768x1344',
  '16:9': '1344x768',
  '9:16': '768x1344',
  '1:1': '1024x1024',
  '3:4': '896x1152',
  '4:3': '1152x896',
}

export function gatewayBaseUrl(value) {
  let url
  try { url = new URL(value) } catch { throw Object.assign(new Error('网关地址无效'), { status: 400 }) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw Object.assign(new Error('网关地址无效'), { status: 400 })
  }
  return url.href.replace(/\/$/, '')
}

export function gatewayImageSize(aspectRatio) {
  return imageSizes[aspectRatio] || imageSizes['1344x768']
}

export function gatewayVideoSize(aspectRatio) {
  return imageSizes[aspectRatio] || imageSizes['1344x768']
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
  throw Object.assign(new Error(message), { status: response.status === 401 ? 401 : 502 })
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
    if ((key === 'b64_json' || key === 'input_reference') && typeof item === 'string') return `[base64 图片，${item.length} 字符]`
    return item
  })
  return apiKey ? json.replaceAll(apiKey, '[已隐藏]') : json
}

function writeApiLog(text, failed) {
  try { insertSessionLog(sessionForLog(), text, failed) } catch { /* 日志不影响接口结果 */ }
}

const requestTimeoutMs = 15 * 60 * 1000

function requestSignal(signal) {
  const timeout = AbortSignal.timeout(requestTimeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function requestGateway({ baseUrl, path, method = 'GET', headers, body, apiKey, fetchImpl, signal, binary = false, fn }) {
  const url = endpoint(baseUrl, path)
  const where = [
    '文件：server/generate/gateway.js',
    `函数：${fn}`,
    `${method} ${url.pathname}${url.search}`,
  ].join('\n')
  const sent = [
    where,
    `请求头：${JSON.stringify(publicHeaders(headers, apiKey))}`,
  ]
  if (body !== undefined) sent.push(`参数：${publicData(body, apiKey)}`)
  writeApiLog(sent.join('\n'))
  let response
  try {
    response = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: requestSignal(signal) })
  } catch (error) {
    writeApiLog(`${where}\n失败：${error?.message || '请求没有完成'}`, true)
    throw error
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

export async function completeChat({ baseUrl, apiKey, model, system, prompt, maxTokens, json = false, fetchImpl = fetch, signal }) {
  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: prompt })
  const payload = { model, messages, max_tokens: maxTokens, ...(json ? { response_format: { type: 'json_object' } } : {}) }
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
  if (!text) throw Object.assign(new Error('模型没有返回文本'), { status: 502 })
  return text
}

export async function generateGatewayImage({ baseUrl, apiKey, model, prompt, aspectRatio, fetchImpl = fetch, signal }) {
  const result = await requestGateway({
    baseUrl, path: 'images/generations', method: 'POST', apiKey, fetchImpl, signal, fn: 'generateGatewayImage',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: { model: model || 'elysium-image', prompt, size: gatewayImageSize(aspectRatio) },
  })
  if (!result.ok) fail(result.response, result.data, `图片生成失败：HTTP ${result.response.status}`)
  const image = result.data?.data?.[0]?.b64_json
  if (!image) throw Object.assign(new Error('网关未返回图片'), { status: 502 })
  return Buffer.from(image, 'base64')
}

export async function uploadGatewayFile({ baseUrl, apiKey, bytes, filename, mime, fetchImpl = fetch, signal }) {
  const body = new FormData()
  body.append('file', new Blob([bytes], { type: mime || 'application/octet-stream' }), filename || 'upload')
  const url = endpoint(baseUrl, 'files')
  const headers = { Authorization: `Bearer ${apiKey}` }
  writeApiLog([
    '文件：server/generate/gateway.js',
    '函数：uploadGatewayFile',
    `POST ${url.pathname}`,
    `请求头：${JSON.stringify(publicHeaders(headers, apiKey))}`,
    `参数：上传文件 ${filename || 'upload'}，${bytes?.length || 0} 字节`,
  ].join('\n'))
  const timeout = AbortSignal.timeout(120 * 1000)
  let response
  try {
    response = await fetchImpl(url, { method: 'POST', headers, body, signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  } catch (error) {
    writeApiLog(`文件：server/generate/gateway.js\n函数：uploadGatewayFile\n失败：${error?.message || '请求没有完成'}`, true)
    throw error
  }
  const data = await readBody(response)
  if (!response.ok) {
    const message = data?.error?.message || `HTTP ${response.status}`
    writeApiLog(`文件：server/generate/gateway.js\n函数：uploadGatewayFile\n失败：${publicData(message, apiKey)}`, true)
    fail(response, data, `文件上传失败：HTTP ${response.status}`)
  }
  writeApiLog(`文件：server/generate/gateway.js\n函数：uploadGatewayFile\n返回：${publicData(data, apiKey)}`)
  if (!data?.id || !data?.url) throw Object.assign(new Error('网关未返回文件地址'), { status: 502 })
  return { id: String(data.id), url: String(data.url) }
}

export async function submitGatewayVideo({ baseUrl, apiKey, model, prompt, duration, mode, inputReference, referenceImages, fetchImpl = fetch, signal }) {
  const seconds = String(Math.round(Number(duration) || 5))
  const body = {
    model: model || 'elysium-video',
    prompt,
    seconds,
    quality: 'medium',
  }
  const images = (referenceImages || []).map(item => String(item || '').trim()).filter(Boolean).slice(0, 9)
  const kind = ['text', 'first_frame', 'reference'].includes(mode) ? mode : (images.length ? 'reference' : inputReference ? 'first_frame' : 'text')
  if (kind === 'reference') body.reference_images = images
  else if (kind === 'first_frame' && inputReference) body.input_reference = inputReference
  const result = await requestGateway({
    baseUrl, path: 'videos', method: 'POST', apiKey, fetchImpl, signal, fn: 'submitGatewayVideo',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body,
  })
  if (!result.ok) fail(result.response, result.data, `视频提交失败：HTTP ${result.response.status}`)
  if (!result.data?.id) throw Object.assign(new Error('网关未返回视频任务'), { status: 502 })
  return { id: result.data.id, seconds }
}

const wait = (ms, signal) => delay(ms, undefined, { signal })

export async function retrieveGatewayVideo({ baseUrl, apiKey, promptId, fetchImpl = fetch, pause = wait, signal, maxPolls = 360 }) {
  const deadline = AbortSignal.timeout(30 * 60 * 1000)
  signal = signal ? AbortSignal.any([signal, deadline]) : deadline
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    signal?.throwIfAborted()
    const result = await requestGateway({
      baseUrl, path: `videos/${encodeURIComponent(promptId)}`, apiKey, fetchImpl, signal, fn: 'retrieveGatewayVideo',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!result.ok) fail(result.response, result.data, `视频查询失败：HTTP ${result.response.status}`)
    const data = result.data
    if (['failed', 'cancelled', 'canceled', 'expired'].includes(data.status)) {
      throw Object.assign(new Error(`视频生成失败：${data.error?.message || '未知错误'}`), { status: 502 })
    }
    if (data.status === 'completed') {
      const bytes = await requestGateway({
        baseUrl, path: `videos/${encodeURIComponent(promptId)}/content`, apiKey, fetchImpl, signal, binary: true, fn: 'retrieveGatewayVideo',
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (Buffer.isBuffer(bytes)) return bytes
      fail(bytes.response, bytes.data, `视频下载失败：HTTP ${bytes.response.status}`)
    }
    if (attempt + 1 < maxPolls) await pause(5000, signal)
  }
  throw Object.assign(new Error('视频查询超时，已停止等待，不会自动重新提交；远端任务可能仍在运行'), { status: 504 })
}
