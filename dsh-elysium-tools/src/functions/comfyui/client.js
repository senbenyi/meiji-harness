import { requiredConfig } from '../../config.js'
import { openAsBlob } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, basename } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as pause } from 'node:timers/promises'

export async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}

export const readJson = path => readFile(path, 'utf8').then(JSON.parse).catch(error => {
  if (error.code === 'ENOENT') return null
  throw error
})

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

  async submit(graph, jobId, path, retryFailed = false) {
    let saved = await readJson(path)
    if (saved && saved.server_url !== this.url.href) throw new Error('原任务属于其他后端；恢复时必须使用原地址')
    if (saved?.prompt_id && retryFailed) {
      const history = (await this.request(`history/${encodeURIComponent(saved.prompt_id)}`))[saved.prompt_id]
      if (history?.status?.status_str === 'error') {
        await saveJson(`${path}.${saved.prompt_id}.failed.json`, saved)
        saved = null
      }
    }
    if (saved?.prompt_id) return saved.prompt_id
    if (saved?.submitting) {
      // A lost POST response must not create a second GPU job.
      const [queue, history] = await Promise.all([this.request('queue'), this.request('history')])
      const prompts = [...(queue.queue_running || []), ...(queue.queue_pending || []),
        ...Object.values(history).map(item => item.prompt)]
      const prompt = prompts.find(item => item?.[3]?.elysium_job_id === jobId)
      if (!prompt) throw new Error('提交结果未确认；请核对原队列与历史，禁止自动重复提交')
      saved.prompt_id = prompt[1]
    } else {
      saved = { server_url: this.url.href, submitting: true, job_id: jobId }
      await saveJson(path, saved)
      let result
      try { result = await this.request('prompt', { prompt: graph, client_id: jobId, extra_data: { elysium_job_id: jobId } }) } catch (error) {
        // Only an explicit validation rejection proves that nothing was enqueued.
        if (error.node_errors) await saveJson(path, { server_url: this.url.href, rejected: true })
        throw error
      }
      if (!result.prompt_id) throw new Error('ComfyUI 提交响应缺少 prompt_id，不能重复提交')
      saved.prompt_id = result.prompt_id
    }
    await saveJson(path, saved)
    return saved.prompt_id
  }

  async wait(promptId, timeoutMs, onProgress = async () => {}) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const entry = (await this.request(`history/${encodeURIComponent(promptId)}`))[promptId]
      if (entry?.status?.status_str === 'error' || entry?.status?.messages?.some(([type]) => ['execution_error', 'execution_interrupted'].includes(type))) {
        throw new Error(`ComfyUI 执行失败：${JSON.stringify(entry.status.messages)}`)
      }
      if (entry?.status?.completed) return entry
      await onProgress(promptId)
      await pause(2000, undefined, { signal: this.signal })
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
