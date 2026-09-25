import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { retrieveGatewayVideo } from '../server/generate/gateway.js'
import { generateStill } from '../server/generate/image.js'

test('video polling stops at its limit without submitting another task', async () => {
  const calls = []
  await assert.rejects(retrieveGatewayVideo({
    baseUrl: 'http://gateway.test/v1/', promptId: 'job', maxPolls: 2, pause: async () => {},
    fetchImpl: async (url, options) => { calls.push([url.pathname, options.method]); return Response.json({ status: 'processing' }) },
  }), /查询超时/)
  assert.deepEqual(calls, [['/v1/videos/job', 'GET'], ['/v1/videos/job', 'GET']])
})

test('cancelled video is terminal', async () => {
  let calls = 0
  await assert.rejects(retrieveGatewayVideo({
    baseUrl: 'http://gateway.test/v1/', promptId: 'job',
    fetchImpl: async () => { calls++; return Response.json({ status: 'cancelled' }) },
  }), /视频生成失败/)
  assert.equal(calls, 1)
})

test('queued image stops polling and keeps its submitted job for subsequent queries', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-poll-'))
  let submissions = 0
  let queries = 0
  try {
    const input = {
      baseUrl: 'http://comfy.test/', prompt: '角色', seed: 1, width: 512, height: 512,
      prefix: 'test', jobId: 'local', journalFile: join(home, 'job.json'), maxPolls: 2, pause: async () => {},
      fetchImpl: async url => {
        if (url.pathname.endsWith('/prompt')) { submissions++; return Response.json({ prompt_id: 'job' }) }
        if (url.pathname.includes('/history/')) { queries++; return Response.json({}) }
        return Response.json({ queue_running: [[0, 'job']] })
      },
    }
    await assert.rejects(generateStill(input), /图片查询超时/)
    await assert.rejects(generateStill(input), /图片查询超时/)
    assert.equal(submissions, 1)
    assert.equal(queries, 4)
  } finally { await rm(home, { recursive: true, force: true }) }
})
