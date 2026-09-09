import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMediaHandler } from '../src/http/media-jobs.js'
import { bindVideoCall, findVideoCall } from '../src/jobs/call-index.js'
import { apply } from '../src/index.js'

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
  assert.deepEqual(routes.map(route => route.path), ['/plugins/dsh-elysium/media/status', '/plugins/dsh-elysium/media/video', '/plugins/dsh-elysium/media/image', '/plugins/dsh-elysium/media/credentials'])
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
