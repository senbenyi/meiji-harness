import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { access, mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { createMediaHandler, MEDIA_ROUTE } from '../src/server/routes/media.js'
import { jobSummary } from '../src/worker/results/summary.js'
import { bindActiveJobCall, findJobCall, releaseActiveJobCall } from '../src/worker/intake/call-bindings.js'
import { mediaInvocation, mediaSession } from '../src/session/index.js'
import { apply } from '../src/index.js'
import { withConfig } from '../src/config.js'
import { mediaReference } from '../src/worker/models/protocols/comfyui/media-reference.js'
import { ComfyClient } from '../src/worker/models/protocols/comfyui/client.js'

const comfyConfig = { COMFYUI_URL: 'https://comfy.test/comfy/' }

test('media references reuse only safe files from the configured backend', () => withConfig(comfyConfig, () => {
  const reference = mediaReference('https://comfy.test/comfy/view?filename=图.png&subfolder=shots/01&type=output')
  assert.equal(reference.name, 'shots/01/图.png [output]')
  assert.equal(new URL(reference.url).origin, 'https://comfy.test')
  assert.equal(ComfyClient.prototype.upload, undefined)
  for (const value of ['/tmp/a.png', 'file:///tmp/a.png', 'ssh://host/root/a.png', 'https://foreign.test/view?filename=a.png',
    'https://comfy.test/comfy/view?filename=../a.png', 'https://comfy.test/comfy/view?filename=a.png&subfolder=../outside',
    'https://comfy.test/comfy/view?filename=a.png&type=temp']) assert.throws(() => mediaReference(value))
}))

async function localFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'elysium-local-')), id = 'a'.repeat(32), projectId = 'b'.repeat(8)
  const project = join(root, 'projects', projectId)
  const job = { job_id: id, project_id: projectId, status: 'succeeded', result: { media_kind: 'video', local_media_path: 'media/clip.mp4' } }
  await mkdir(join(project, 'media'), { recursive: true })
  const records = ['clip.mp4', 'image.png', 'subtitles.srt'].map(name => ({ path: `media/${name}`, job_id: id, size_bytes: 10 }))
  for (const record of records) await writeFile(join(project, record.path), '0123456789')
  const save = () => writeFile(join(project, 'media/manifest.json'), JSON.stringify({ project_id: projectId, files: records }))
  await save()
  const handler = createMediaHandler({ token: 'test', readJob: async () => job })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  const url = kind => `http://127.0.0.1:${server.address().port}${MEDIA_ROUTE}/${kind}?job=${id}&t=test`
  return { project, job, records, save, get: (kind, options) => fetch(url(kind), options) }
}

test('registered local media supports authenticated reads and byte ranges', async t => {
  const f = await localFixture(t)
  for (const [file, kind, endpoint] of [['image.png', 'image', 'image'], ['clip.mp4', 'video', 'video'], ['subtitles.srt', 'file', 'download']]) {
    Object.assign(f.job.result, { local_media_path: `media/${file}`, media_kind: kind })
    const response = await f.get(endpoint)
    assert.equal(response.status, 200); assert.equal(await response.text(), '0123456789')
    assert.equal((await f.get(endpoint, { method: 'HEAD' })).status, 200)
  }
  f.job.result = { media_kind: 'video', local_media_path: 'media/clip.mp4' }
  for (const [range, body] of [['bytes=2-4', '234'], ['bytes=-3', '789'], ['bytes=8-', '89']]) {
    const response = await f.get('video', { headers: { Range: range } })
    assert.equal(response.status, 206); assert.equal(await response.text(), body)
  }
  for (const range of ['bytes=10-', 'bytes=4-2', 'bytes=0-1,3-4']) assert.equal((await f.get('video', { headers: { Range: range } })).status, 416)
})

test('local media rejects traversal, unregistered files and symlink escapes', async t => {
  const f = await localFixture(t)
  for (const path of ['/etc/hosts', '../clip.mp4', 'media/test/../../clip.mp4', 'media/test/%2e%2e/clip.mp4', 'file:///etc/hosts', 'media/test/no.mp4']) {
    f.job.result.local_media_path = path
    assert.equal((await f.get('video')).status, 403, path)
  }
  const outside = await mkdtemp(join(tmpdir(), 'elysium-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(join(outside, 'clip.mp4'), '0123456789')
  await rm(join(f.project, 'media/clip.mp4'))
  await symlink(join(outside, 'clip.mp4'), join(f.project, 'media/clip.mp4'))
  assert.equal((await f.get('video')).status, 403)
})

test('status summary carries generation specification to recovered cards', () => {
  const specification = { width: 384, height: 512, seconds: 73 / 24, steps: 8, audio: 'joint-generation-and-decoding' }
  const summary = jobSummary({ job_id: 'job', status: 'succeeded', result: { profile: 'preview', specification } })
  assert.deepEqual(summary.specification, specification)
  assert.equal(summary.profile, 'preview')
})

test('media routes wait for webServer and inject browser configuration when it becomes available', () => {
  let activate
  apply({ on() {}, tools: { register() {} }, inject(dependencies, callback) {
    assert.deepEqual(dependencies, ['webServer'])
    activate = callback
  } })
  const routes = [], listeners = new Map()
  activate({ get: name => name === 'webServer' ? { register: route => { routes.push(route); return () => {} } } : undefined,
    on: (event, callback) => listeners.set(event, callback), effect: callback => callback() })
  assert.deepEqual(routes.map(route => route.path), ['/plugins/dsh-elysium/media/status', '/plugins/dsh-elysium/media/video', '/plugins/dsh-elysium/media/image', '/plugins/dsh-elysium/media/credentials', '/plugins/dsh-elysium/media/download', '/plugins/dsh-elysium/media/list', '/plugins/dsh-elysium/media/delete', '/plugins/dsh-elysium/media/upload', '/plugins/dsh-elysium/media/retry', ...['list', 'register', 'check', 'switch', 'set-enabled', 'models', 'model-status', 'model-connect', 'tunnel-status', 'tunnel-connect', 'third-party-select', 'creation-quality'].map(suffix => `/plugins/dsh-elysium/settings/${suffix}`), ...['list', 'get', 'episode', 'episode-save', 'create', 'update', 'delete', 'import', 'update-anchor', 'update-shot', 'plan-generate', 'plan-edit', 'plan-finalize', 'plan-read', 'produce', 'retry', 'compose', 'poll'].map(suffix => `/plugins/dsh-elysium/project/${suffix}`), ...['list', 'get', 'create', 'save', 'reorder', 'remove'].map(suffix => `/plugins/dsh-elysium/director/${suffix}`)])
  const rows = []
  listeners.get('webserver/index-inject')(rows)
  assert.equal(rows[0].name, '__ELYSIUM_MEDIA__')
  assert.equal(rows[0].value.base, '/plugins/dsh-elysium/media')
  assert.ok(rows[0].value.token)
  assert.equal(rows[0].value.projectBase, '/plugins/dsh-elysium/project')
  assert.equal(rows[0].value.settingsBase, '/plugins/dsh-elysium/settings')
  assert.equal(rows[0].value.directorBase, '/plugins/dsh-elysium/director')
})

test('active calls use memory until Harness logs the result and never create a runtime index', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-index-')), previous = process.env.ELYSIUM_STATE_ROOT
  process.env.ELYSIUM_STATE_ROOT = root
  try {
    const active = mediaInvocation({ agent: { session: { id: 'session-one' } }, callId: 'call-one' })
    bindActiveJobCall('a'.repeat(32), active)
    assert.equal(await findJobCall('session-one', 'call-one'), 'a'.repeat(32))
    assert.equal(await findJobCall('session-two', 'call-one'), null)
    await assert.rejects(access(join(root, 'runtime', 'calls')), { code: 'ENOENT' })
    const completed = { id: 'session-one', snapshotEvents: () => [{ type: 'tool/call', data: { name: 'call_tools_video', callId: 'call-one' } },
      { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'call-one', content: [{ type: 'text', text: JSON.stringify({ job_id: 'b'.repeat(32) }) }] }] } } }] }
    assert.equal(await findJobCall('session-one', 'call-one', mediaSession(completed)), 'b'.repeat(32))
    assert.equal(await findJobCall('session-one', 'call-one'), null)
    const released = mediaInvocation({ agent: { session: { id: 'session-one' } }, callId: 'released' })
    bindActiveJobCall('c'.repeat(32), released)
    releaseActiveJobCall(released)
    assert.equal(await findJobCall('session-one', 'released'), null)
    const session = { id: 'old', snapshotEvents: () => [{ type: 'tool/call', data: { name: 'call_tools_video', callId: 'c' } },
      { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'c', content: [{ type: 'text', text: JSON.stringify({ job_id: 'b'.repeat(32) }) }] }] } } }] }
    assert.equal(await findJobCall('old', 'c', mediaSession(session)), 'b'.repeat(32))
    assert.equal(await findJobCall('other', 'c', mediaSession(session)), null)
    assert.equal(await findJobCall('legacy', 'c', mediaSession({ id: 'legacy', snapshotEvents: () => session.snapshotEvents().map(event => event.type === 'tool/call' ? { ...event, data: { ...event.data, name: 'workflow_generate_video' } } : event) })), null)
    assert.equal(await findJobCall('preparing', 'c', mediaSession({ id: 'preparing', snapshotEvents: () => [
      { type: 'tool/call', data: { name: 'call_tools_video', callId: 'c' } },
    ] })), null)
  } finally {
    if (previous === undefined) delete process.env.ELYSIUM_STATE_ROOT
    else process.env.ELYSIUM_STATE_ROOT = previous
    await rm(root, { recursive: true, force: true })
  }
})
test('authenticated media routes proxy HTTP URLs and never serve local files', async () => {
  const upstream = createServer((req, res) => { res.writeHead(200, { 'Content-Type': req.url.includes('.png') ? 'image/png' : 'video/mp4' }); res.end('media') })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
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
      const url = `http://127.0.0.1:${upstream.address().port}/view?filename=final.${kind === 'image' ? 'png' : 'mp4'}&type=output`
      job = { ...job, status: 'succeeded', result: { media_kind: kind, comfyui_view_url: url } }
      assert.equal((await (await get('/status')).json())[`has_${kind}`], true)
      for (const method of ['GET', 'HEAD']) {
        const response = await get('/' + kind, { method })
        assert.equal(response.status, 200)
        assert.equal(response.headers.get('location'), null)
        assert.equal(response.headers.get('content-disposition'), null)
        assert.equal(await response.text(), method === 'HEAD' ? '' : 'media')
      }
      assert.equal((await get('/' + (kind === 'image' ? 'video' : 'image'))).status, 404)
    }
    job.result = { path: '/etc/hosts', media_kind: 'video' }
    assert.equal((await get('/video')).status, 404)
    assert.equal((await (await get('/status')).json()).has_video, false)
    job.result.comfyui_view_url = 'file:///etc/hosts'
    assert.equal((await get('/video')).status, 403)
  } finally { await Promise.all([server, upstream].map(s => new Promise(resolve => s.close(resolve)))) }
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

test('preview proxy forwards Range and HEAD, preserves 206/416, and never redirects browsers', async () => {
  const received = []
  const upstream = createServer((req, res) => {
    received.push(req.headers)
    const invalid = req.headers.range === 'bytes=99-'
    res.writeHead(invalid ? 416 : req.headers.range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': invalid ? '0' : req.headers.range ? '3' : '5',
      'Accept-Ranges': 'bytes', ...(req.headers.range ? { 'Content-Range': invalid ? 'bytes */5' : 'bytes 1-3/5' } : {}) })
    res.end(invalid ? '' : req.headers.range ? 'ide' : 'video')
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const job = { job_id: 'a'.repeat(32), status: 'succeeded', result: { comfyui_view_url: `http://127.0.0.1:${upstream.address().port}/view` } }
  const server = createServer(createMediaHandler({ token: 't', readJob: async () => job, projectBase: '/plugins/dsh-elysium/project' }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/plugins/dsh-elysium/media`, url = `${base}/video?t=t&job=${job.job_id}`
  try {
    let response = await fetch(url, { headers: { Range: 'bytes=1-3', 'If-Range': '"v1"' }, redirect: 'manual' })
    assert.equal(response.status, 206); assert.equal(response.headers.get('location'), null)
    assert.equal(response.headers.get('content-range'), 'bytes 1-3/5'); assert.equal(response.headers.get('accept-ranges'), 'bytes')
    assert.equal(await response.text(), 'ide')
    assert.equal(received[0].range, 'bytes=1-3'); assert.equal(received[0]['if-range'], '"v1"')
    response = await fetch(url, { headers: { Range: 'bytes=99-' } })
    assert.equal(response.status, 416); assert.equal(response.headers.get('content-range'), 'bytes */5')
    response = await fetch(url, { method: 'HEAD' })
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-length'), '5'); assert.equal(await response.text(), '')
    response = await fetch(`${base}/credentials`, { headers: { 'X-Elysium-Media-Refresh': '1' } })
    assert.equal((await response.json()).projectBase, '/plugins/dsh-elysium/project')
  } finally { await Promise.all([server, upstream].map(s => new Promise(resolve => s.close(resolve)))) }
})

test('preview proxy cancels the upstream stream when the browser closes playback', async () => {
  let closeUpstream
  const upstreamClosed = new Promise(resolve => { closeUpstream = resolve })
  const upstream = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/mp4' })
    res.write('video')
    const timer = setInterval(() => res.write('video'), 20)
    res.on('close', () => { clearInterval(timer); closeUpstream() })
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const job = { job_id: 'a'.repeat(32), status: 'succeeded', result: { media_kind: 'video', comfyui_view_url: `http://127.0.0.1:${upstream.address().port}/view` } }
  const server = createServer(createMediaHandler({ token: 't', readJob: async () => job }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${MEDIA_ROUTE}/video?t=t&job=${job.job_id}`)
    assert.equal(response.status, 200)
    await response.body.cancel()
    assert.equal(await Promise.race([upstreamClosed.then(() => true), delay(500, false)]), true)
  } finally { await Promise.all([server, upstream].map(s => new Promise(resolve => s.close(resolve)))) }
})

test('workcard retry is POST-only, authenticated, scoped to the bound call and never waits', async t => {
  const retried = []
  const handler = createMediaHandler({ token: 'test', findCall: async (session, call) => session === 's' && call === 'c' ? 'a'.repeat(32) : null,
    retryJob: async id => { retried.push(id); return { job_id: id, project_id: 'bbbbbbbb', status: 'queued' } } })
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = (query, token = 'test') => `http://127.0.0.1:${server.address().port}${MEDIA_ROUTE}/retry?${query}&t=${token}`
  assert.equal((await fetch(url('session=s&call=c'), { method: 'POST' })).status, 202)
  assert.deepEqual(retried, ['a'.repeat(32)])
  assert.equal((await fetch(url('session=s&call=c'))).status, 405)
  assert.equal((await fetch(url('session=s&call=c', 'wrong'), { method: 'POST' })).status, 401)
  assert.equal((await fetch(url('session=s&call=other'), { method: 'POST' })).status, 404)
  assert.equal((await fetch(url('session=s'), { method: 'POST' })).status, 400)
  assert.equal(retried.length, 1)
})
