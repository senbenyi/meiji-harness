const MODEL_API_BASE_URL = 'http://127.0.0.1:8010/v1'
const POLL_INTERVAL_MS = 2000

export const IMAGE_TIMEOUT_MS = 41 * 60 * 1000

export class ModelApiError extends Error {
  constructor(code, message, status = 500) {
    super(message)
    this.name = 'ModelApiError'
    this.code = code
    this.status = status
  }
}

function detailOf(value) {
  if (typeof value?.detail === 'string') return value.detail
  if (Array.isArray(value?.detail)) return value.detail.map(item => item?.msg).filter(Boolean).join('; ')
  return ''
}

async function requestJson(url, options = {}) {
  let response
  try {
    response = await fetch(url, options)
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new ModelApiError('MODEL_API_UNREACHABLE', `Model API 不可用：${error?.message || error}`, 503)
  }
  const value = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ModelApiError('MODEL_API_ERROR', detailOf(value) || `Model API 返回 HTTP ${response.status}`, response.status)
  }
  return value
}

export function createModelApiService() {
  async function generateImage(input = {}, signal) {
    const prompt = String(input.prompt || '').trim()
    if (!prompt) throw new ModelApiError('VALIDATION_ERROR', '请提供文生图提示词', 400)
    const preset = input.preset || 'standard'
    if (!['fast', 'standard'].includes(preset)) {
      throw new ModelApiError('VALIDATION_ERROR', 'preset 只能是 fast 或 standard', 400)
    }
    const seed = input.seed ?? 666
    if (!Number.isSafeInteger(seed) || seed < 0) {
      throw new ModelApiError('VALIDATION_ERROR', 'seed 必须是非负整数', 400)
    }

    const submitted = await requestJson(`${MODEL_API_BASE_URL}/images/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, preset, seed }),
      signal,
    })
    const deadline = Date.now() + IMAGE_TIMEOUT_MS
    while (Date.now() < deadline) {
      signal?.throwIfAborted()
      const job = await requestJson(`${MODEL_API_BASE_URL}/jobs/${submitted.job_id}`, { signal })
      if (job.status === 'succeeded') {
        return {
          job_id: job.job_id,
          status: job.status,
          path: job.result.path,
          size_bytes: job.result.size_bytes,
          sha256: job.result.sha256,
        }
      }
      if (job.status === 'failed') {
        throw new ModelApiError('MODEL_GENERATION_FAILED', job.error || '图片生成失败')
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    throw new ModelApiError('MODEL_GENERATION_TIMEOUT', '图片生成超时', 504)
  }

  return { generateImage }
}

