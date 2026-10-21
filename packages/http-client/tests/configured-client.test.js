import test from 'node:test'
import assert from 'node:assert/strict'
import { createConfiguredModelClient } from '../src/configured-client.js'

test('按每次最新设置路由任意方法用途，传输选项和返回保持，调用参数不能覆盖所选模型', async () => {
  let config = { endpoint: 'first', writer: { model: 'a' }, painter: { model: 'image' } }
  const calls = [], signal = new AbortController().signal, record = () => {}
  const client = { async complete(options) { calls.push(options); return '文本' }, async generateImage(options) { calls.push(options); return Buffer.from('image') } }
  const routed = createConfiguredModelClient({ settings: { read: async () => structuredClone(config) }, client,
    methods: { complete: 'writer', generateImage: 'painter' }, connection: value => ({ baseUrl: value.endpoint }),
  })
  assert.equal(await routed.complete({ model: 'override', baseUrl: 'override', signal, record, messages: [] }), '文本')
  assert.equal(calls[0].model, 'a'); assert.equal(calls[0].baseUrl, 'first'); assert.equal(calls[0].signal, signal); assert.equal(calls[0].record, record)
  config = { ...config, endpoint: 'second', writer: { model: 'b' } }
  await routed.complete(); assert.equal(calls[1].model, 'b'); assert.equal(calls[1].baseUrl, 'second')
  assert.deepEqual(await routed.generateImage(), Buffer.from('image')); assert.equal(calls[2].model, 'image')
})

test('配置/映射错误在发送前拒绝，失败原样透传，默认使用配置的baseUrl', async () => {
  assert.throws(() => createConfiguredModelClient(), /settings.read/)
  assert.throws(() => createConfiguredModelClient({ settings: { read() {} }, methods: { unknown: 'x' } }), /无效模型/)
  let calls = 0
  const error = new Error('远端错误'), client = { async complete() { calls++; throw error } }
  let config = { baseUrl: 'local', writer: {} }
  const routed = createConfiguredModelClient({ settings: { read: async () => config }, methods: { complete: 'writer' }, client })
  await assert.rejects(routed.complete(), /缺少模型/); assert.equal(calls, 0)
  config.writer.model = 'selected'
  await assert.rejects(routed.complete(), failure => failure === error); assert.equal(calls, 1)
})
