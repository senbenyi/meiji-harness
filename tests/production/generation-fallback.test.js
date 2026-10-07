import test from 'node:test'
import assert from 'node:assert/strict'
import { groundedGenerationFallback, validateGeneration } from '../../lib/prompts/specification.js'

test('grounded image fallback satisfies the production generation contract', () => {
  const value = groundedGenerationFallback('image', { subject: '阿秀卧室', description: '正式剧本中的卧室', constraints: '场景无人' })
  assert.deepEqual(validateGeneration(value, 'image'), value)
  assert.match(value.prompt, /阿秀卧室/)
  assert.equal(Object.keys(value.details).length, 6)
})

test('grounded video fallback preserves supplied shot timing and dialogue', () => {
  const value = groundedGenerationFallback('video', { subject: '镜头一', description: '龙哥进入房间', timing: '在 6 秒内完成', sound: '龙哥：生日快乐' })
  assert.deepEqual(validateGeneration(value, 'video'), value)
  assert.equal(value.details.timing, '在 6 秒内完成')
  assert.equal(value.details.sound, '龙哥：生日快乐')
})
