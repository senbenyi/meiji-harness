import assert from 'node:assert/strict'
import { GatewayClient } from '../lib/gateway.js'

const requests = []
let videoPolls = 0
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url), init })
  const path = new URL(url).pathname
  if (path === '/v1/capabilities') {
    return Response.json({ data: [{ name: 'image.text2image', tiers: ['fast', 'balanced', 'quality'] }] })
  }
  if (path === '/v1/images/generations') {
    const body = JSON.parse(init.body)
    assert.equal(body.capability, 'image.text2image')
    assert.equal(body.tier, 'fast')
    assert.equal(body.workflow, undefined)
    return Response.json({ data: [{ url: 'https://gateway.test/v1/media/media_1' }] })
  }
  if (path === '/v1/media/media_1') {
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
  }
  if (path === '/v1/videos' && init.method === 'POST') {
    const body = JSON.parse(init.body)
    assert.equal(body.capability, 'video.image2video')
    assert.equal(body.tier, 'quality')
    assert.equal(body.workflow, undefined)
    return Response.json({ id: 'video_1', status: 'queued' })
  }
  if (path === '/v1/videos/video_1') {
    videoPolls++
    return Response.json(videoPolls === 1
      ? { id: 'video_1', status: 'in_progress' }
      : { id: 'video_1', status: 'completed', url: 'https://gateway.test/v1/videos/video_1/content' })
  }
  if (path === '/v1/videos/video_1/content') {
    return new Response(new Uint8Array([4, 5, 6]), { headers: { 'content-type': 'video/mp4' } })
  }
  return Response.json({ error: { message: 'unexpected ' + path } }, { status: 500 })
}

const client = new GatewayClient({ baseUrl: 'https://gateway.test', apiKey: 'sk-test', pollMs: 0, timeoutMs: 1000 })
assert.equal((await client.capabilities())[0].name, 'image.text2image')
const image = await client.generateImage({ capability: 'image.text2image', tier: 'fast', prompt: 'p', width: 1024, height: 1024 })
assert.equal(image.filename, 'gateway-output.png')
const video = await client.generateTask({ capability: 'video.image2video', tier: 'quality', prompt: 'p', width: 768, height: 1344, frames: 121, fps: 24 }, null)
assert.equal(video.filename, 'gateway-output.mp4')
assert.ok(requests.every((request) => request.init.headers?.authorization === 'Bearer sk-test'))
console.log('✓ GatewayClient 只提交语义能力并完成图片/视频任务生命周期')
