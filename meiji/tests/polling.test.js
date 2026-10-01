import test from 'node:test'
import assert from 'node:assert/strict'
import { retrieveGatewayVideo } from '../server/generate/gateway.js'

test('video polling stops at its limit without submitting another task', async () => {
  const calls = []
  await assert.rejects(retrieveGatewayVideo({
    baseUrl: 'http://gateway.test/v1/', apiKey: 'test', promptId: 'job', maxPolls: 2, pause: async () => {},
    fetchImpl: async (url, options) => { calls.push([url.pathname, options.method]); return Response.json({ status: 'processing' }) },
  }), /查询超时/)
  assert.deepEqual(calls, [['/v1/videos/job', 'GET'], ['/v1/videos/job', 'GET']])
})

test('cancelled video is terminal', async () => {
  let calls = 0
  await assert.rejects(retrieveGatewayVideo({
    baseUrl: 'http://gateway.test/v1/', apiKey: 'test', promptId: 'job',
    fetchImpl: async () => { calls++; return Response.json({ status: 'cancelled' }) },
  }), /视频生成失败/)
  assert.equal(calls, 1)
})
