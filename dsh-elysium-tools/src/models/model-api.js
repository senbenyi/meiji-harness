const MODEL_API_BASE_URL = 'http://127.0.0.1:8010/v1'
const POLL_INTERVAL_MS = 2000

export const MODEL_TIMEOUTS = Object.freeze({
  image: 41 * 60 * 1000,
  video: 71 * 60 * 1000,
  longVideo: 151 * 60 * 1000,
  postprocess: 121 * 60 * 1000,
  workflow: 451 * 60 * 1000,
})

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

export async function requestJson(path, options = {}) {
  let response
  try {
    response = await fetch(`${MODEL_API_BASE_URL}${path}`, options)
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

export function submitJson(path, body, signal) {
  return requestJson(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}

export function submitForm(path, fields, signal) {
  const body = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== '') body.append(key, String(value))
  }
  return requestJson(path, { method: 'POST', body, signal })
}

export function getJob(jobId, signal) {
  return requestJson(`/jobs/${jobId}`, { signal })
}

export function completedResult(job) {
  if (job.status !== 'succeeded' || !job.result) {
    throw new ModelApiError('MODEL_JOB_NOT_READY', `任务尚未成功：${job.status}`, 409)
  }
  return {
    job_id: job.job_id,
    status: job.status,
    path: job.result.path,
    size_bytes: job.result.size_bytes,
    sha256: job.result.sha256,
    result_url: `/v1/jobs/${job.job_id}/result`,
    ...(job.result.receipt_path ? { receipt_path: job.result.receipt_path } : {}),
    ...(job.result.contract_version ? { contract_version: job.result.contract_version } : {}),
  }
}

export async function waitForJob(jobId, signal, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    signal?.throwIfAborted()
    const job = await getJob(jobId, signal)
    if (job.status === 'succeeded') return completedResult(job)
    if (job.status === 'failed') {
      throw new ModelApiError('MODEL_GENERATION_FAILED', job.error || '模型任务失败')
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new ModelApiError('MODEL_GENERATION_TIMEOUT', '模型任务超时', 504)
}

export async function submitAndWait(submit, signal, timeoutMs) {
  const accepted = await submit()
  return waitForJob(accepted.job_id, signal, timeoutMs)
}
