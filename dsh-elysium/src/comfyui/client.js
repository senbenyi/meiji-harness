// 职责：封装 ComfyUI HTTP 请求、图校验、任务等待与产物 URL 生成。
import { runtimeConfig } from '../config.js'
import { resolveServer } from '../servers/runtime/index.js'
import { setTimeout as pause } from 'node:timers/promises'
import { submitComfyPrompt } from './submission.js'
import { createTiming } from '../business/jobs/timing.js'

export function comfyUrl(server) {
  return server === undefined && runtimeConfig().ELYSIUM_BACKEND ? runtimeConfig().ELYSIUM_BACKEND.base_url : resolveServer('comfyui', server).base_url
}

export class ComfyClient {
  constructor(url = comfyUrl(), signal, timing = createTiming()) {
    this.url = new URL(url.replace(/\/?$/, '/'))
    if (!['http:', 'https:'].includes(this.url.protocol)) throw new Error('ComfyUI URL 必须为 HTTP(S)')
    this.signal = signal
    this.timing = timing
  }

  async request(path, body, timeout = 60_000) {
    return this.timing.measure(`http.${body === undefined ? 'GET' : 'POST'}.${path.split('/')[0]}`, () => this.requestJson(path, body, timeout))
  }

  async requestJson(path, body, timeout) {
    const signal = this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
    const response = await fetch(new URL(path, this.url), {
      method: body === undefined ? 'GET' : 'POST', signal,
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    })
    if ([408, 429, 502, 503, 504].includes(response.status)) throw Object.assign(new Error(`ComfyUI ${path}: HTTP ${response.status}`), { status: response.status })
    const result = await response.json()
    if (!response.ok || result.error) {
      const error = new Error(`ComfyUI ${path}: ${JSON.stringify(result)}`)
      error.code = 'COMFYUI_REQUEST_FAILED'
      error.node_errors = result.node_errors
      throw error
    }
    return result
  }

  async validate(graph, { verifyModels = false } = {}) {
    const types = [...new Set(Object.values(graph).map(node => node.class_type))]
    const schemas = {}
    // Keep four channels busy without waiting for the slowest request in each batch.
    const pending = types.values()
    let failure
    await Promise.all(Array.from({ length: Math.min(4, types.length) }, async () => {
      try {
        for (const type of pending) {
          if (failure) break
          Object.assign(schemas, await this.request(`object_info/${encodeURIComponent(type)}`))
        }
      } catch (error) { failure ||= error }
    }))
    if (failure) throw failure
    for (const [id, node] of Object.entries(graph)) {
      const schema = schemas[node.class_type]
      if (!schema) throw new Error(`ComfyUI 缺少节点：${node.class_type}`)
      const required = schema.input?.required || {}, optional = schema.input?.optional || {}
      const dynamic = Object.entries({ ...required, ...optional }).filter(([, spec]) => spec[0] === 'COMFY_AUTOGROW_V3').map(([key]) => key)
      for (const key of Object.keys(required)) {
        if (!(key in node.inputs) && !(dynamic.includes(key) && Object.keys(node.inputs).some(name => name.startsWith(`${key}.`)))) throw new Error(`${id} 缺少输入 ${key}`)
      }
      for (const [key, value] of Object.entries(node.inputs)) {
        const root = dynamic.find(name => key.startsWith(`${name}.`))
        const spec = required[key] || optional[key] || (root ? ['*'] : undefined)
        if (!spec) throw new Error(`${id} 存在未支持输入 ${key}`)
        if (Array.isArray(value)) {
          const source = graph[value[0]], type = schemas[source?.class_type]?.output?.[value[1]]
          if (!type || (spec[0] !== '*' && spec[0] !== type && !(spec[0] === 'FLOAT' && type === 'INT'))) throw new Error(`${id}.${key} 连线类型不匹配`)
        } else {
          const choices = Array.isArray(spec[0]) ? spec[0] : spec[1]?.options
          if (verifyModels && typeof value === 'string' && /\.(safetensors|ckpt|pt|pth|gguf)$/.test(value) && !choices?.length) throw new Error(`${id}.${key} 模型列表不可核验，未切换服务器`)
          const mediaReference = ['LoadImage', 'LoadVideo'].includes(node.class_type) && ['image', 'file'].includes(key) && typeof value === 'string' && / \[(input|output)\]$/.test(value)
          const dynamicResolution = node.class_type === 'ComfyUI-PerfectVideoResolution' && key === 'resolution'
          if (choices?.length && !choices.includes(value) && !mediaReference && !dynamicResolution) throw new Error(`${id}.${key} 不支持值 ${value}`)
          if (typeof value === 'number' && (value < (spec[1]?.min ?? -Infinity) || value > (spec[1]?.max ?? Infinity))) throw new Error(`${id}.${key} 超出节点范围`)
        }
      }
    }
  }

  async submit(graph, jobId, path, retryFailed = false, workflow) {
    return submitComfyPrompt(this, graph, jobId, path, retryFailed, workflow)
  }

  async wait(promptId, timeoutMs, onProgress = async () => {}, pollMs = 2000) {
    const deadline = performance.now() + timeoutMs
    let missing = 0
    while (performance.now() < deadline) {
      this.signal?.throwIfAborted()
      const entry = (await this.request(`history/${encodeURIComponent(promptId)}`))[promptId]
      const queue = !entry?.status?.completed && entry?.status?.status_str !== 'error' ? await this.request('queue') : undefined
      if (entry?.status?.status_str === 'error' || entry?.status?.messages?.some(([type]) => ['execution_error', 'execution_interrupted'].includes(type))) {
        throw Object.assign(new Error(`ComfyUI 执行失败：${JSON.stringify(entry.status.messages)}`), {
          code: 'COMFYUI_EXECUTION_FAILED', history: entry,
        })
      }
      if (entry?.status?.completed) return entry
      const running = queue.queue_running?.some(item => item[1] === promptId)
      const pending = queue.queue_pending?.some(item => item[1] === promptId)
      missing = entry || running || pending ? 0 : missing + 1
      // History and queue are separate snapshots. Confirm absence across polls
      // before reporting loss; absence never authorizes a new submission.
      if (missing >= 3) throw Object.assign(new Error(`原任务已不在队列或历史中，可能已取消或历史已清理；请核对 prompt_id: ${promptId}，禁止自动重提`), { code: 'COMFYUI_TASK_NOT_FOUND' })
      const stage = running ? 'execute' : pending ? 'queued' : 'reconcile'
      await onProgress(promptId, stage)
      await this.timing.measure(`poll.sleep.${stage}`, () => pause(pollMs, undefined, { signal: this.signal }))
    }
    throw new Error(`等待超时；远端任务可能仍在执行，恢复时查询原 prompt_id: ${promptId}`)
  }

  viewUrl(descriptor) {
    if (!descriptor?.filename || descriptor.type !== 'output') throw new Error('无有效 ComfyUI output 产物')
    const url = new URL('view', this.url)
    url.search = new URLSearchParams({ filename: descriptor.filename, subfolder: descriptor.subfolder || '', type: 'output' }).toString()
    return url.href
  }

}
