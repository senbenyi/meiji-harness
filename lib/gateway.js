// GatewayClient is the plugin's only media execution boundary: semantic requests in, media bytes out.

const mimeByExtension = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
}

const extensionByMime = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'audio/wav': '.wav', 'audio/mpeg': '.mp3',
}

function extension(name = '') {
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index).toLowerCase() : ''
}

function dataURL(media) {
  const mime = media.mime || mimeByExtension[extension(media.filename)]
  if (!mime) throw new Error(`gateway-invalid-media: 不支持的素材类型 ${media.filename || ''}`)
  return `data:${mime};base64,${Buffer.from(media.buffer).toString('base64')}`
}

async function errorMessage(response) {
  const body = await response.json().catch(() => ({}))
  return body?.error?.message || body?.message || `${response.status} ${response.statusText}`
}

export class GatewayClient {
  constructor({ baseUrl, apiKey, pollMs = 2000, timeoutMs = 15 * 60 * 1000 }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '')
    this.apiKey = apiKey || ''
    this.pollMs = pollMs
    this.timeoutMs = timeoutMs
    if (!this.baseUrl) throw new Error('gateway-config: gatewayUrl 未配置')
  }

  headers(extra = {}) {
    return { ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}), ...extra }
  }

  async request(path, init = {}) {
    let response
    try {
      response = await fetch(this.baseUrl + path, { ...init, headers: this.headers(init.headers) })
    } catch (error) {
      throw new Error(`gateway-unreachable: 网关不可达（${this.baseUrl}）：${error?.message || error}`)
    }
    if (!response.ok) throw new Error(`gateway-error: ${await errorMessage(response)}`)
    return response
  }

  async capabilities() {
    const response = await this.request('/v1/capabilities')
    return (await response.json()).data || []
  }

  async generateImage(intent) {
    const body = {
      model: 'elysium-image', capability: intent.capability, tier: intent.tier,
      prompt: intent.prompt, n: 1, size: `${intent.width}x${intent.height}`,
      seed: intent.seed, steps: intent.steps, guidance: intent.guidance,
      images: (intent.references || []).map(dataURL),
    }
    const response = await this.request('/v1/images/generations', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const result = await response.json()
    const url = result?.data?.[0]?.url
    if (!url) throw new Error('gateway-error: 图片响应没有产物 URL')
    return this.download(url, 'image')
  }

  async generateTask(intent, signal) {
    const body = {
      model: 'elysium-video', capability: intent.capability, tier: intent.tier,
      prompt: intent.prompt, size: `${intent.width}x${intent.height}`,
      frames: intent.frames, fps: intent.fps, seed: intent.seed,
      steps: intent.steps, guidance: intent.guidance,
      frame_index: intent.frameIndex,
      input_reference: intent.firstFrame ? dataURL(intent.firstFrame) : undefined,
      last_frame: intent.lastFrame ? dataURL(intent.lastFrame) : undefined,
      reference_images: (intent.references || []).map(dataURL),
      source_video: intent.sourceVideo ? dataURL(intent.sourceVideo) : undefined,
    }
    const response = await this.request('/v1/videos', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
    })
    const task = await response.json()
    if (!task?.id) throw new Error('gateway-error: 任务响应没有 id')
    const deadline = Date.now() + this.timeoutMs
    for (;;) {
      if (signal?.aborted) {
        await this.request(`/v1/videos/${encodeURIComponent(task.id)}`, { method: 'DELETE' }).catch(() => {})
        throw new Error('generation cancelled')
      }
      if (Date.now() > deadline) throw new Error(`timeout: 网关生成超时（>${this.timeoutMs}ms）`)
      const state = await (await this.request(`/v1/videos/${encodeURIComponent(task.id)}`)).json()
      if (state.status === 'completed') {
        return this.download(state.url || `/v1/videos/${encodeURIComponent(task.id)}/content`,
          intent.capability === 'image.from_video' ? 'image' : 'video')
      }
      if (state.status === 'failed' || state.status === 'cancelled') {
        throw new Error(`gateway-generation: ${state?.error?.message || state.status}`)
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollMs))
    }
  }

  async download(url, kind) {
    const target = new URL(url, this.baseUrl).toString()
    const response = await fetch(target, { headers: this.headers() })
    if (!response.ok) throw new Error(`gateway-download: ${await errorMessage(response)}`)
    const mime = String(response.headers.get('content-type') || '').split(';')[0]
    const suffix = extensionByMime[mime] || (kind === 'image' ? '.png' : '.mp4')
    return { buffer: Buffer.from(await response.arrayBuffer()), filename: `gateway-output${suffix}`, mime }
  }
}
