import { requiredConfig } from '../../config.js'
import { openAsBlob } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import { dirname, basename } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as pause } from 'node:timers/promises'
import { submitComfyPrompt } from '../../jobs/comfy-submission.js'

export { readJson, saveJson } from '../../jobs/json.js'

export function comfyUrl(server = 'minimax-h3') {
  if (server !== 'minimax-h3') throw new Error(`未知 ComfyUI 实例：${server}`)
  return requiredConfig('MINIMAX_H3_COMFYUI_URL', 'url')
}

export class ComfyClient {
  constructor(url = comfyUrl(), signal) {
    this.url = new URL(url.replace(/\/?$/, '/'))
    if (!['http:', 'https:'].includes(this.url.protocol)) throw new Error('ComfyUI URL 必须为 HTTP(S)')
    this.signal = signal
  }

  async request(path, body, timeout = 60_000) {
    const signal = this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
    const response = await fetch(new URL(path, this.url), {
      method: body === undefined ? 'GET' : 'POST', signal,
      ...(body instanceof FormData ? { body } : body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    })
    const result = await response.json()
    if (!response.ok || result.error) {
      const error = new Error(`ComfyUI ${path}: ${JSON.stringify(result)}`)
      error.code = 'COMFYUI_REQUEST_FAILED'
      error.node_errors = result.node_errors
      throw error
    }
    return result
  }

  async upload(path, name) {
    const form = new FormData()
    form.set('image', await openAsBlob(path), name || basename(path))
    form.set('type', 'input')
    form.set('overwrite', 'false')
    const result = await this.request('upload/image', form, 600_000)
    if (!result.name || result.type !== 'input') throw new Error('ComfyUI 上传未返回 input 文件')
    return result.subfolder ? `${result.subfolder}/${result.name}` : result.name
  }

  async validate(graph) {
    const types = [...new Set(Object.values(graph).map(node => node.class_type))]
    const schemas = Object.assign({}, ...await Promise.all(types.map(type => this.request(`object_info/${encodeURIComponent(type)}`))))
    for (const [id, node] of Object.entries(graph)) {
      const schema = schemas[node.class_type]
      if (!schema) throw new Error(`ComfyUI 缺少节点：${node.class_type}`)
      for (const key of Object.keys(schema.input?.required || {})) {
        if (!(key in node.inputs)) throw new Error(`${id} 缺少输入 ${key}`)
      }
      for (const [key, value] of Object.entries(node.inputs)) {
        const spec = schema.input?.required?.[key] || schema.input?.optional?.[key]
        if (!spec) throw new Error(`${id} 存在未支持输入 ${key}`)
        if (Array.isArray(value)) {
          const source = graph[value[0]], type = schemas[source?.class_type]?.output?.[value[1]]
          if (!type || (spec[0] !== type && !(spec[0] === 'FLOAT' && type === 'INT'))) throw new Error(`${id}.${key} 连线类型不匹配`)
        } else {
          const choices = Array.isArray(spec[0]) ? spec[0] : spec[1]?.options
          if (choices && !choices.includes(value)) throw new Error(`${id}.${key} 不支持值 ${value}`)
          if (typeof value === 'number' && (value < (spec[1]?.min ?? -Infinity) || value > (spec[1]?.max ?? Infinity))) throw new Error(`${id}.${key} 超出节点范围`)
        }
      }
    }
  }

  async submit(graph, jobId, path, retryFailed = false, workflow) {
    return submitComfyPrompt(this, graph, jobId, path, retryFailed, workflow)
  }

  async wait(promptId, timeoutMs, onProgress = async () => {}, pollMs = 2000) {
    const deadline = Date.now() + timeoutMs
    let missing = 0
    while (Date.now() < deadline) {
      let entry, queue
      try {
        entry = (await this.request(`history/${encodeURIComponent(promptId)}`))[promptId]
        if (!entry?.status?.completed && entry?.status?.status_str !== 'error') queue = await this.request('queue')
      } catch (error) {
        this.signal?.throwIfAborted()
        if (error.name !== 'TimeoutError' && !(error instanceof TypeError && error.message === 'fetch failed')) throw error
        // Read-only polling can recover without changing the original submission.
        await onProgress(promptId, 'reconcile')
        await pause(pollMs, undefined, { signal: this.signal })
        continue
      }
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
      await onProgress(promptId, running ? 'execute' : pending ? 'queued' : 'reconcile')
      await pause(pollMs, undefined, { signal: this.signal })
    }
    throw new Error(`等待超时；远端任务可能仍在执行，恢复时查询原 prompt_id: ${promptId}`)
  }

  viewUrl(descriptor, publicUrl = this.url.href) {
    if (!descriptor?.filename || descriptor.type !== 'output') throw new Error('无有效 ComfyUI output 产物')
    const url = new URL('view', publicUrl.replace(/\/?$/, '/'))
    url.search = new URLSearchParams({ filename: descriptor.filename, subfolder: descriptor.subfolder || '', type: 'output' }).toString()
    return url.href
  }

  async download(descriptor, path) {
    await mkdir(dirname(path), { recursive: true })
    const response = await fetch(this.viewUrl(descriptor), { signal: this.signal
      ? AbortSignal.any([this.signal, AbortSignal.timeout(600_000)]) : AbortSignal.timeout(600_000) })
    if (!response.ok || !response.body) throw new Error(`ComfyUI 下载失败：${response.status}`)
    await pipeline(Readable.fromWeb(response.body), createWriteStream(`${path}.download`, { mode: 0o600 }))
    await rename(`${path}.download`, path)
  }
}
