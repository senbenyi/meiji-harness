import test from 'node:test'
import assert from 'node:assert/strict'
import { readGatewayImage } from '../server/generate/image-access.js'
const input = { baseUrl: 'https://gateway.test/v1', apiKey: 'test-secret', imageUrl: 'https://gateway.test/v1/files/file_123/content' }
test('image verification sends the key only in Authorization and returns remote bytes', async () => {
  const result = await readGatewayImage({ ...input, fetchImpl: async (url, options) => {
    assert.equal(url.href, input.imageUrl)
    assert.equal(options.headers.Authorization, 'Bearer test-secret')
    assert.equal(options.redirect, 'error')
    return new Response('remote-image', { headers: { 'content-type': 'image/png' } })
  } })
  assert.equal(result.bytes.toString(), 'remote-image')
  assert.equal(result.mime, 'image/png')
})
test('foreign hosts and non-file URLs never receive a gateway key', async () => {
  for (const imageUrl of ['https://other.test/v1/files/file_123/content', 'https://gateway.test/v1/models', input.imageUrl + '?key=secret', 'https://user:pass@gateway.test/v1/files/file_123/content']) {
    await assert.rejects(readGatewayImage({ ...input, imageUrl, fetchImpl: () => assert.fail('must not fetch') }), { status: 400 })
  }
})
test('auth and ownership errors are readable and never expose upstream content', async () => {
  for (const status of [401, 403, 404]) await assert.rejects(readGatewayImage({ ...input, fetchImpl: async () => new Response('secret-upstream-body', { status }) }), error => error.status === 502 && !error.message.includes('secret'))
  await assert.rejects(readGatewayImage({ ...input, fetchImpl: async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) }), /未返回支持的图片格式/)
})
