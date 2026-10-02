import test from 'node:test'
import assert from 'node:assert/strict'
import { CapabilityRegistry } from '../../lib/capabilities/registry.js'

test('registry only resolves runtime verified workflows', () => {
  const registry = new CapabilityRegistry([
    { capability: 'image.text2image', tier: 'quality', status: 'runtime_verified', verifiedAt: '2026-10-02T00:00:00Z', hash: 'abc', workflowId: 'qwen-image-21' },
    { capability: 'video.image2video', tier: 'quality', status: 'configured', workflowId: 'h3' },
  ])
  assert.equal(registry.resolve('image.text2image', 'quality').workflowId, 'qwen-image-21')
  assert.throws(() => registry.resolve('video.image2video', 'quality'), /no runtime_verified workflow/)
})
