import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMediaHandler, jobSummary } from '../src/http/media-jobs.js'
import { bindVideoCall, findVideoCall } from '../src/jobs/call-index.js'
import { apply } from '../src/index.js'

test('status summary carries timing and generation specification to recovered cards', () => {
  const timings = { total_ms: 33123 }, specification = { width: 384, height: 512, seconds: 73 / 24, steps: 8, audio: 'joint-generation-and-decoding' }
  const summary = jobSummary({ job_id: 'job', status: 'succeeded', timings, result: { profile: 'preview', specification } })
  assert.deepEqual(summary.timings, timings)
  assert.deepEqual(summary.specification, specification)
  assert.equal(summary.profile, 'preview')
})

test('media routes wait for webServer and inject browser configuration when it becomes available', () => {
  process.env.ARTIFACTS_ROOT = tmpdir()
  let activate
  apply({ on() {}, tools: { register() {} }, inject(dependencies, callback) {
    assert.deepEqual(dependencies, ['webServer'])
    activate = callback
  } })
  const routes = [], listeners = new Map()
  activate({ get: name => name === 'webServer' ? { register: route => { routes.push(route); return () => {} } } : undefined,
    on: (event, callback) => listeners.set(event, callback), effect: callback => callback() })
  assert.deepEqual(routes.map(route => route.path), ['/plugins/dsh-elysium/media/status', '/plugins/dsh-elysium/media/video', '/plugins/dsh-elysium/media/image', '/plugins/dsh-elysium/media/credentials', '/plugins/dsh-elysium/media/download', '/plugins/dsh-elysium/media/list', ...['list', 'get', 'create', 'update', 'delete'].map(suffix => `/plugins/dsh-elysium/storyboard/${suffix}`)])
  const rows = []
  listeners.get('webserver/index-inject')(rows)
  assert.equal(rows[0].name, '__ELYSIUM_MEDIA__')
  assert.equal(rows[0].value.base, '/plugins/dsh-elysium/media')
  assert.ok(rows[0].value.token)
})

test('call mapping survives reads and never uses an arbitrary client job/path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-index-')), previous = process.env.ELYSIUM_TOOLS_STATE_ROOT
  process.env.ELYSIUM_TOOLS_STATE_ROOT = root
  try {
    await bindVideoCall('a'.repeat(32), { agent: { session: { id: 'session-one' } }, callId: 'call-one' })
    assert.equal(await findVideoCall('session-one', 'call-one'), 'a'.repeat(32))
    assert.equal(await findVideoCall('session-two', 'call-one'), null)
    const session = { id: 'old', snapshotEvents: () => [{ type: 'tool/call', data: { name: 'workflow_generate_video', callId: 'c' } },
      { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'c', content: [{ type: 'text', text: JSON.stringify({ job_id: 'b'.repeat(32) }) }] }] } } }] }
    assert.equal(await findVideoCall('old', 'c', session), 'b'.repeat(32))
    assert.equal(await findVideoCall('other', 'c', session), null)
    assert.equal(await findVideoCall('preparing', 'c', { id: 'preparing', snapshotEvents: () => [
      { type: 'tool/call', data: { name: 'workflow_generate_video', callId: 'c' } },
    ] }), null)
  } finally {
    if (previous === undefined) delete process.env.ELYSIUM_TOOLS_STATE_ROOT
    else process.env.ELYSIUM_TOOLS_STATE_ROOT = previous
    await rm(root, { recursive: true, force: true })
  }
})
test('authenticated media routes redirect HTTP URLs and never serve local files', async () => {
  let job = { job_id: 'a'.repeat(32), status: 'running', stage: 'generate' }
  const server = createServer(createMediaHandler({ token: 't', findCall: async (s, c) => s === 's' && c === 'c' ? job.job_id : null, readJob: async () => job }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/plugins/dsh-elysium/media`, query = '?t=t&session=s&call=c'
  const get = (path, options = {}) => fetch(base + path + query, { redirect: 'manual', ...options })
  try {
    assert.equal((await fetch(base + '/status')).status, 401)
    assert.equal((await fetch(base + '/credentials')).status, 403)
    const headers = { 'X-Elysium-Media-Refresh': '1' }
    assert.equal((await fetch(base + '/credentials', { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
    assert.equal((await (await fetch(base + '/credentials', { headers })).json()).token, 't')
    assert.equal((await get('/status', { method: 'POST' })).status, 405)
    assert.equal((await get('/video')).status, 404)
    assert.equal((await fetch(base + '/download?t=t&session=missing&call=missing')).status, 404)
    for (const kind of ['image', 'video']) {
      const url = `https://comfy.test/view?filename=final.${kind === 'image' ? 'png' : 'mp4'}&type=output`
      job = { ...job, status: 'succeeded', result: { media_kind: kind, comfyui_view_url: url } }
      assert.equal((await (await get('/status')).json())[`has_${kind}`], true)
      for (const method of ['GET', 'HEAD']) {
        const response = await get('/' + kind, { method })
        assert.equal(response.status, 302)
        assert.equal(response.headers.get('location'), url)
        assert.equal(response.headers.get('content-disposition'), null)
        assert.equal(await response.text(), '')
      }
      assert.equal((await get('/' + (kind === 'image' ? 'video' : 'image'))).status, 404)
    }
    job.result = { path: '/etc/hosts', media_kind: 'video' }
    assert.equal((await get('/video')).status, 404)
    assert.equal((await (await get('/status')).json()).has_video, false)
    job.result.comfyui_view_url = 'file:///etc/hosts'
    assert.equal((await get('/video')).status, 403)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('download proxies bytes with attachment headers and rejects upstream failure', async () => {
  let status = 200
  const upstream = createServer((req, res) => { res.writeHead(status, { 'Content-Type': 'video/mp4', 'Content-Length': '5' }); res.end('video') })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const job = { job_id: 'a'.repeat(32), status: 'succeeded', result: { comfyui_view_url: `http://127.0.0.1:${upstream.address().port}/view` } }
  const server = createServer(createMediaHandler({ token: 't', findCall: async () => job.job_id, readJob: async () => job }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/plugins/dsh-elysium/media/download?session=s&call=c&t=t`
  try {
    const response = await fetch(url)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('location'), null)
    assert.match(response.headers.get('content-disposition'), /attachment; filename="elysium-.*\.mp4"/)
    assert.equal(await response.text(), 'video')
    assert.equal((await fetch(url, { method: 'HEAD' })).headers.get('content-length'), '5')
    assert.equal((await fetch(url.replace('t=t', 't=bad'))).status, 401)
    status = 500
    assert.equal((await fetch(url)).status, 502)
    job.status = 'running'
    assert.equal((await fetch(url)).status, 404)
  } finally { await Promise.all([server, upstream].map(s => new Promise(resolve => s.close(resolve)))) }
})
