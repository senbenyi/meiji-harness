import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ComfyClient, readJson, saveJson } from '../src/functions/comfyui/client.js'

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
