import { randomUUID } from 'node:crypto'

export class ComfyClient {
  constructor({ baseUrl, apiKey = '', fetchImpl = fetch, pollMs = 2000, timeoutMs = 15 * 60 * 1000 }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '')
    if (!this.baseUrl) throw new Error('ComfyUI baseUrl required')
    this.apiKey = apiKey
    this.fetch = fetchImpl
    this.pollMs = pollMs
    this.timeoutMs = timeoutMs
  }

  async request(path, init = {}) {
    const headers = new Headers(init.headers || {})
    if (this.apiKey) headers.set('authorization', `Bearer ${this.apiKey}`)
    const response = await this.fetch(this.baseUrl + path, { ...init, headers })
    return response
  }

  async submit(graph, options = {}) {
    const response = await this.request('/prompt', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: options.clientId || `dsh-short-video-studio-${randomUUID()}` }),
      signal: options.signal,
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || !body.prompt_id) throw new Error(`comfy-submit-failed: ${body.error || body.message || response.status}`)
    return { promptId: body.prompt_id, number: body.number ?? null, nodeErrors: body.node_errors || {} }
  }

  async objectInfo(classType = '', signal) {
    const suffix = classType ? `/${encodeURIComponent(classType)}` : ''
    const response = await this.request(`/object_info${suffix}`, { signal })
    if (!response.ok) throw new Error(`comfy-object-info-failed: ${response.status}`)
    return response.json()
  }

  async history(promptId, signal) {
    const response = await this.request(`/history/${encodeURIComponent(promptId)}`, { signal })
    if (!response.ok) throw new Error(`comfy-history-failed: ${response.status}`)
    const body = await response.json().catch(() => ({}))
    return body[promptId] || null
  }

  async wait(promptId, options = {}) {
    const deadline = Date.now() + (options.timeoutMs || this.timeoutMs)
    for (;;) {
      if (options.signal?.aborted) throw new Error('generation cancelled')
      if (Date.now() > deadline) throw new Error(`comfy-timeout: ${promptId}`)
      const entry = await this.history(promptId, options.signal)
      if (entry) {
        const status = entry.status || {}
        if (status.status_str === 'error' || status.completed === false && status.messages?.some?.((item) => item?.[0] === 'execution_error')) {
          throw new Error(`comfy-execution-failed: ${promptId}`)
        }
        if (status.completed === true || status.status_str === 'success') return entry
      }
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, options.pollMs || this.pollMs)
        options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('generation cancelled')) }, { once: true })
      })
    }
  }

  outputs(entry) {
    const result = []
    for (const [nodeId, output] of Object.entries(entry?.outputs || {})) {
      for (const kind of ['images', 'gifs', 'videos', 'audio']) {
        for (const file of output?.[kind] || []) result.push({ ...file, nodeId, kind })
      }
    }
    return result
  }

  async download(file, signal) {
    const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' })
    const response = await this.request(`/view?${query}`, { signal })
    if (!response.ok) throw new Error(`comfy-download-failed: ${response.status} ${file.filename}`)
    return Buffer.from(await response.arrayBuffer())
  }

  async upload(buffer, filename, signal) {
    const form = new FormData()
    form.append('image', new Blob([buffer]), filename)
    form.append('overwrite', 'true')
    const response = await this.request('/upload/image', { method: 'POST', body: form, signal })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || !body.name) throw new Error(`comfy-upload-failed: ${body.error || body.message || response.status}`)
    return body
  }

  async cancel(promptId) {
    const response = await this.request('/queue', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delete: [promptId] }),
    })
    if (!response.ok) throw new Error(`comfy-cancel-failed: ${response.status}`)
  }
}
