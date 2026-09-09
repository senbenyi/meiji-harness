import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { ComfyClient, readJson, saveJson } from '../src/functions/comfyui/client.js'
import { comfyuiTaskTool } from '../src/functions/comfyui/comfyui-task.js'

const directory = await mkdtemp(join(tmpdir(), 'comfy-client-'))
after(() => rm(directory, { recursive: true, force: true }))

test('lost submit response is recovered from remote job identity without a second POST', async () => {
  const client = new ComfyClient('http://example.invalid'), path = join(directory, 'lost.json')
  let submissions = 0
  client.request = async (route, body) => {
    if (route === 'prompt') { submissions++; throw new Error('connection lost after accept') }
    if (route === 'queue') return { queue_running: [[0, 'original', {}, { elysium_job_id: 'job' }]], queue_pending: [] }
    if (route === 'history') return {}
    throw new Error('unexpected request')
  }
  await assert.rejects(client.submit({}, 'job', path), /connection lost/)
  assert.equal(await client.submit({}, 'job', path), 'original')
  assert.equal(submissions, 1)
  assert.equal((await readJson(path)).prompt_id, 'original')
})

test('unknown submit outcome stays blocked and switching servers cannot resubmit', async () => {
  const client = new ComfyClient('http://example.invalid'), path = join(directory, 'unknown.json')
  await saveJson(path, { server_url: client.url.href, submitting: true })
  client.request = async route => route === 'queue' ? { queue_running: [], queue_pending: [] } : {}
  await assert.rejects(client.submit({}, 'job', path), /禁止自动重复提交/)
  await assert.rejects(new ComfyClient('http://other.invalid').submit({}, 'job', path), /其他后端/)
})

test('only explicit resume retries a confirmed failed prompt', async () => {
  const client = new ComfyClient('http://example.invalid'), path = join(directory, 'failed.json')
  await saveJson(path, { server_url: client.url.href, prompt_id: 'old' })
  let submissions = 0
  client.request = async route => {
    if (route === 'history/old') return { old: { status: { status_str: 'error' } } }
    submissions++
    return { prompt_id: 'new' }
  }
  assert.equal(await client.submit({}, 'job', path), 'old')
  assert.equal(submissions, 0)
  assert.equal(await client.submit({}, 'job', path, true), 'new')
  assert.equal(submissions, 1)
})

test('validation catches incompatible socket types before submission', async () => {
  const client = new ComfyClient('http://example.invalid')
  client.request = async () => ({ Source: { input: {}, output: ['IMAGE'] },
    Sink: { input: { required: { audio: ['AUDIO'] } }, output: [] } })
  await assert.rejects(client.validate({ a: { class_type: 'Source', inputs: {} },
    b: { class_type: 'Sink', inputs: { audio: ['a', 0] } } }), /连线类型不匹配/)
})

test('wait distinguishes queue stages and tolerates a completion snapshot race', async () => {
  const client = new ComfyClient('http://example.invalid'), stages = []
  let histories = 0
  client.request = async route => {
    if (route === 'history/p') return ++histories === 4 ? { p: { status: { completed: true } } } : {}
    return { queue_pending: histories === 1 ? [[0, 'p']] : [], queue_running: histories === 2 ? [[0, 'p']] : [] }
  }
  await client.wait('p', 1000, async (_, stage) => stages.push(stage), 1)
  assert.deepEqual(stages, ['queued', 'execute', 'reconcile'])
})

test('deleted prompt stops waiting and never authorizes a duplicate submission', async () => {
  const client = new ComfyClient('http://example.invalid'), path = join(directory, 'deleted.json')
  await saveJson(path, { server_url: client.url.href, prompt_id: 'deleted' })
  client.request = async route => {
    assert.notEqual(route, 'prompt')
    return route === 'queue' ? { queue_pending: [], queue_running: [] } : {}
  }
  await assert.rejects(client.wait('deleted', 1000, undefined, 1), { code: 'COMFYUI_TASK_NOT_FOUND' })
  assert.equal(await client.submit({}, 'job', path, true), 'deleted')
})

test('poll timeout recovers the original prompt without submission and honors cancellation', async () => {
  const controller = new AbortController(), client = new ComfyClient('http://example.invalid', controller.signal)
  let reads = 0
  client.request = async route => {
    assert.equal(route, 'history/original')
    if (++reads === 1) throw new DOMException('timeout', 'TimeoutError')
    return { original: { status: { completed: true } } }
  }
  const stages = []
  await client.wait('original', 1000, async (_, stage) => stages.push(stage), 1)
  assert.deepEqual(stages, ['reconcile'])
  client.request = async () => { controller.abort(); throw new DOMException('timeout', 'TimeoutError') }
  await assert.rejects(client.wait('original', 1000, undefined, 1), { name: 'AbortError' })
})

test('task management uses HTTP results and never interrupts another running job', async () => {
  const mutations = []
  const server = createServer(async (req, res) => {
    if (req.method === 'POST') {
      let body = ''
      for await (const bytes of req) body += bytes
      mutations.push([req.url, JSON.parse(body)])
      res.end('{}'); return
    }
    res.end(JSON.stringify(req.url === '/queue' ? { queue_running: [[0, 'running']], queue_pending: [[1, 'pending']] }
      : { done: { status: { completed: true, status_str: 'success' }, outputs: { final: { videos: [{ filename: 'movie.mp4', type: 'output' }] } } } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const previous = process.env.MINIMAX_H3_COMFYUI_URL
  process.env.MINIMAX_H3_COMFYUI_URL = `http://127.0.0.1:${server.address().port}`
  try {
    const result = await comfyuiTaskTool('result', '').execute({ server: 'minimax-h3', prompt_id: 'done' })
    assert.equal(result.status, 'succeeded')
    assert.ok(result.artifacts[0].view_url.includes('/view?filename=movie.mp4'))
    assert.equal((await comfyuiTaskTool('cancel', '').execute({ server: 'minimax-h3', prompt_id: 'running' })).ok, false)
    assert.equal(mutations.length, 0)
    await comfyuiTaskTool('cancel', '').execute({ server: 'minimax-h3', prompt_id: 'pending' })
    assert.deepEqual(mutations, [['/queue', { delete: ['pending'] }]])
  } finally {
    if (previous === undefined) delete process.env.MINIMAX_H3_COMFYUI_URL
    else process.env.MINIMAX_H3_COMFYUI_URL = previous
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  }
})
