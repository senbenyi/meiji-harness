import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMediaHandler, byteRange } from '../src/http/media-jobs.js'
import { bindVideoCall, findVideoCall } from '../src/jobs/call-index.js'
import { apply } from '../src/index.js'

test('media routes wait for webServer and inject browser configuration when it becomes available', () => {
  let activate
  apply({ on() {}, tools: { register() {} }, inject(dependencies, callback) {
    if (dependencies.length === 1) {
      assert.deepEqual(dependencies, ['webServer'])
      activate = callback
    } else assert.deepEqual(dependencies, ['webServer', 'apiProxy'])
  } })
  const routes = [], listeners = new Map()
  activate({ get: name => name === 'webServer' ? { register: route => { routes.push(route); return () => {} } } : undefined,
    on: (event, callback) => listeners.set(event, callback), effect: callback => callback() })
  assert.deepEqual(routes.map(route => route.path), ['/plugins/dsh-elysium/media/status', '/plugins/dsh-elysium/media/video'])
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
    const session = { id: 'old', events: [{ type: 'tool/call', data: { name: 'workflow_generate_video', callId: 'c' } },
      { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'c', content: [{ type: 'text', text: JSON.stringify({ job_id: 'b'.repeat(32) }) }] }] } } }] }
    assert.equal(await findVideoCall('old', 'c', session), 'b'.repeat(32))
    assert.equal(await findVideoCall('other', 'c', session), null)
  } finally {
    if (previous === undefined) delete process.env.ELYSIUM_TOOLS_STATE_ROOT
    else process.env.ELYSIUM_TOOLS_STATE_ROOT = previous
    await rm(root, { recursive: true, force: true })
  }
})
test('authenticated same-origin endpoint serves bounded range streams and survives refresh', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-http-')), path = join(root, 'final.mp4')
  await writeFile(path, '0123456789')
  let job = { job_id: 'a'.repeat(32), status: 'running', workflow: { stage: 'generate' } }
  const handler = createMediaHandler({ token: 'test-token', artifactsRoot: root, findCall: async (s,c) => s === 's' && c === 'c' ? job.job_id : null, readJob: async () => job })
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/plugins/dsh-elysium/media`
  const query = '?t=test-token&session=s&call=c'
  try {
    assert.equal((await fetch(base + '/status')).status, 401)
    assert.equal((await fetch(base + '/status' + query, { method: 'POST' })).status, 405)
    assert.equal((await (await fetch(base + '/status' + query)).json()).stage, 'generate')
    assert.equal((await fetch(base + '/video' + query)).status, 404)
    job = { ...job, status: 'succeeded', result: { path, media_info: { duration_seconds: 8 } } }
    const status = await (await fetch(base + '/status' + query)).json()
    assert.equal(status.has_video, true); assert.equal(status.path, undefined)
    const ranged = await fetch(base + '/video' + query, { headers: { Range: 'bytes=2-4' } })
    assert.equal(ranged.status, 206); assert.equal(await ranged.text(), '234')
    assert.equal(ranged.headers.get('content-range'), 'bytes 2-4/10')
    assert.equal((await fetch(base + '/video' + query, { headers: { Range: 'bytes=11-' } })).status, 416)
    const head = await fetch(base + '/video' + query + '&download=1', { method: 'HEAD' })
    assert.match(head.headers.get('content-disposition'), /attachment/)
    assert.equal(await head.text(), '')
    await symlink('/etc/hosts', join(root, 'escape.mp4')); job.result.path = join(root, 'escape.mp4')
    assert.equal((await fetch(base + '/video' + query)).status, 403)
    assert.equal((await (await fetch(base + '/status?t=test-token&session=other&call=c')).json()).status, 'pending')
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})
test('Range syntax covers suffix, open end and invalid requests', () => {
  assert.deepEqual(byteRange('bytes=-3', 10), { start: 7, end: 9 })
  assert.deepEqual(byteRange('bytes=8-', 10), { start: 8, end: 9 })
  for (const value of ['bytes=-0', 'bytes=4-2', 'bytes=0-1,4-5', 'bytes=-', 'garbage']) assert.throws(() => byteRange(value, 10))
})
