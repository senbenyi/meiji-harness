import { checkContext, markApiFailure } from '../data/self-checks.js'
import { setTimeout as delay } from 'node:timers/promises'
import { insertSessionLog, sessionForLog, logPurpose } from '../host/session-log.js'

const imageSizes = {
  '1344x768': '1344x768',
  '768x1344': '768x1344',
  '16:9': '1344x768',
  '9:16': '768x1344',
  '1:1': '1024x1024',
  '3:4': '896x1152',
  '4:3': '1152x896',
}


export function gatewayImageSize(aspectRatio) {
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
    if ((key === 'b64_json' || key === 'input_reference') && typeof item === 'string') return `[base64 图片，${item.length} 字符]`
    if (typeof item === 'string') return item.replace(/data:[^,\s]*;base64,[A-Za-z0-9+/_=-]+/g, data => `[base64 数据，${data.length - data.indexOf(',') - 1} 字符]`)
    return item
  })
  return apiKey ? json.replaceAll(apiKey, '[已隐藏]') : json
}

function writeApiLog(text, failed) {
  const fn = text.match(/函数：([^\n]+)/)?.[1]
  const purpose = logPurpose() || ({ completeChat: '文本生成', generateGatewayImage: '图片生成', uploadGatewayFile: '上传素材', submitGatewayVideo: '视频生成', retrieveGatewayVideo: '查询或下载视频', retrieveGatewayImage: '查询或下载图片', cancelGatewayTask: '取消生成任务' }[fn] || 'API调用')
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
async function requestGatewayRaw({ baseUrl, path, method = 'GET', headers, body, apiKey, fetchImpl, signal, binary = false, fn }) {
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
  if (body !== undefined) sent.push(`参数：${publicData(body, apiKey)}`)
  writeApiLog(sent.join('\n'))
  let response
  try {
    response = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: requestSignal(signal) })
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

export async function generateGatewayImage({ baseUrl, apiKey, model, prompt, aspectRatio, fetchImpl = fetch, signal, pause, maxPolls }) {
  signal ??= checkContext.getStore()?.signal
  signal?.throwIfAborted()
  // 提交期间保留连接取得任务 ID，随后才能显式取消远端任务。
  const result = await requestGateway({
    baseUrl, path: 'images/tasks', method: 'POST', apiKey, fetchImpl, signal: AbortSignal.timeout(requestTimeoutMs), fn: 'generateGatewayImage',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: { model: model || 'elysium-image', prompt, size: gatewayImageSize(aspectRatio) },
  })
  if (!result.ok) fail(result.response, result.data, `图片提交失败：HTTP ${result.response.status}`)
  if (!result.data?.id) throw markApiFailure(Object.assign(new Error('网关未返回图片任务'), { status: 502 }))
  return retrieveGatewayTask({ baseUrl, apiKey, promptId: result.data.id, kind: 'images/tasks', fetchImpl, signal, pause, maxPolls })
}

export async function uploadGatewayFile({ baseUrl, apiKey, bytes, filename, mime, fetchImpl = fetch, signal }) {
  signal ??= checkContext.getStore()?.signal
  const body = new FormData()
  body.append('file', new Blob([bytes], { type: mime || 'application/octet-stream' }), filename || 'upload')
  const url = endpoint(baseUrl, 'files')
  const headers = { Authorization: `Bearer ${apiKey}` }
  writeApiLog([
    '文件：server/generate/gateway.js',
    '函数：uploadGatewayFile',
    `POST ${url.pathname}`,
    `请求地址：${url.href}`,
    `请求头：${JSON.stringify(publicHeaders(headers, apiKey))}`,
    `参数：${publicData({ file: { filename: filename || 'upload', mime: mime || 'application/octet-stream', size: bytes?.length || 0 } }, apiKey)}`,
  ].join('\n'))
  const timeout = AbortSignal.timeout(120 * 1000)
  let response
  try {
    response = await fetchImpl(url, { method: 'POST', headers, body, signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  } catch (error) {
    writeApiLog(`文件：server/generate/gateway.js\n函数：uploadGatewayFile\n失败：${error?.message || '请求没有完成'}`, true)
    throw markApiFailure(error)
  }
  const data = await readBody(response)
  if (!response.ok) {
    const message = data?.error?.message || `HTTP ${response.status}`
    writeApiLog(`文件：server/generate/gateway.js\n函数：uploadGatewayFile\n失败：${publicData(message, apiKey)}`, true)
    fail(response, data, `文件上传失败：HTTP ${response.status}`)
  }
  writeApiLog(`文件：server/generate/gateway.js\n函数：uploadGatewayFile\n返回：${publicData(data, apiKey)}`)
  if (!data?.id || !data?.url) throw markApiFailure(Object.assign(new Error('网关未返回文件地址'), { status: 502 }))
  return { id: String(data.id), url: String(data.url) }
}

export async function submitGatewayVideo({ baseUrl, apiKey, model, prompt, duration, mode, inputReference, referenceImages, fetchImpl = fetch, signal }) {
  signal ??= checkContext.getStore()?.signal
  signal?.throwIfAborted()
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
  // 提交期间保留连接取得任务 ID，随后才能显式取消远端任务。
  const result = await requestGateway({
    baseUrl, path: 'videos', method: 'POST', apiKey, fetchImpl, signal: AbortSignal.timeout(requestTimeoutMs), fn: 'submitGatewayVideo',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body,
  })
  if (!result.ok) fail(result.response, result.data, `视频提交失败：HTTP ${result.response.status}`)
  if (!result.data?.id) throw markApiFailure(Object.assign(new Error('网关未返回视频任务'), { status: 502 }))
  await cancelOnStop({ baseUrl, apiKey, promptId: result.data.id, kind: 'videos', fetchImpl, signal })
  return { id: result.data.id, seconds }
}

const wait = (ms, signal) => delay(ms, undefined, { signal })

export async function cancelGatewayTask({ baseUrl, apiKey, promptId, kind, fetchImpl = fetch }) {
  const result = await requestGateway({
    baseUrl, path: `${kind}/${encodeURIComponent(promptId)}/cancel`, method: 'POST', apiKey, fetchImpl,
    // 取消请求必须独立于已中止的生成信号。
    signal: AbortSignal.timeout(30_000), fn: 'cancelGatewayTask',
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!result.ok) fail(result.response, result.data, `取消失败：HTTP ${result.response.status}`)
  if (!['cancelled', 'completed', 'failed'].includes(result.data?.status)) throw new Error('网关未确认任务终态')
  return result.data
}

async function cancelOnStop({ signal, ...options }) {
  if (!signal?.aborted) return
  if (signal.reason?.name === 'TimeoutError') throw signal.reason
  let task
  try { task = await cancelGatewayTask(options) }
  catch (error) {
    throw Object.assign(new Error(`远端取消失败（${options.promptId}）：${error.message}；任务可能仍在运行`), { code: 'REMOTE_CANCEL_FAILED', cause: error })
  }
  throw Object.assign(new Error(task.status === 'completed' ? '任务已停止；远端任务已完成' : '任务已停止；远端任务已终止'), {
    code: task.status === 'completed' ? 'TASK_CANCELLED' : options.kind === 'videos' ? 'VIDEO_TASK_TERMINAL' : 'IMAGE_TASK_TERMINAL',
  })
}

export async function retrieveGatewayVideo(options) {
  return retrieveGatewayTask({ ...options, kind: 'videos' })
}

async function retrieveGatewayTask({ baseUrl, apiKey, promptId, kind, fetchImpl = fetch, pause = wait, signal, maxPolls = 360 }) {
  signal ??= checkContext.getStore()?.signal
  const options = { baseUrl, apiKey, promptId, kind, fetchImpl, signal }
  const label = kind === 'videos' ? '视频' : '图片'
  const fn = kind === 'videos' ? 'retrieveGatewayVideo' : 'retrieveGatewayImage'
  const deadline = AbortSignal.timeout(30 * 60 * 1000)
  const pollingSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
  let terminal = false
  try {
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      pollingSignal.throwIfAborted()
      const result = await requestGateway({
        baseUrl, path: `${kind}/${encodeURIComponent(promptId)}`, apiKey, fetchImpl, signal: pollingSignal, fn,
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!result.ok) fail(result.response, result.data, `${label}查询失败：HTTP ${result.response.status}`)
      const data = result.data
      if (['failed', 'cancelled', 'canceled', 'expired'].includes(data.status)) {
        terminal = true
        throw markApiFailure(Object.assign(new Error(`${label}生成失败：${data.error?.message || data.status}`), { status: 502, code: kind === 'videos' ? 'VIDEO_TASK_TERMINAL' : 'IMAGE_TASK_TERMINAL' }))
      }
      if (data.status === 'completed') {
        terminal = true
        pollingSignal.throwIfAborted()
        const bytes = await requestGateway({
          baseUrl, path: `${kind}/${encodeURIComponent(promptId)}/content`, apiKey, fetchImpl, signal: pollingSignal, binary: true, fn,
          headers: { Authorization: `Bearer ${apiKey}` },
        })
        pollingSignal.throwIfAborted()
        if (Buffer.isBuffer(bytes)) return bytes
        fail(bytes.response, bytes.data, `${label}下载失败：HTTP ${bytes.response.status}`)
      }
      if (attempt + 1 < maxPolls) await pause(5000, pollingSignal)
    }
    throw markApiFailure(Object.assign(new Error(`${label}查询超时，已停止等待，不会自动重新提交；远端任务可能仍在运行（${promptId}）`), { status: 504 }))
  } catch (error) {
    if (!terminal) await cancelOnStop(options)
    throw error
  }
}
