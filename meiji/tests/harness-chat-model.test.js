import test from 'node:test'
import assert from 'node:assert/strict'
import { catalog } from '../models/model-config.js'
import { syncChatModel } from '../server/host/harness-chat-model.js'

test('会话配置同步网关、模型和独立凭据引用，保留其他服务且不泄露密钥到 settings', async () => {
  const values = { 'llm-pi-ai': { providers: { other: { baseURL: 'https://other.example' } } } }, saved = new Map()
  const ctx = { settings: { mutate: async (id, ops) => { for (const op of ops) values[id].providers[op.path[1]] = op.value }, update: async (id, value) => { values[id] = value } }, credentials: { set: async (ref, value) => saved.set(ref, value) } }
  for (const [baseUrl, model, apiKey] of [['https://gateway.example/v1', 'elysium-chat', 'secret-one'], ['https://new.example/v1', 'new-chat', 'secret-two']]) {
    await syncChatModel(ctx, { baseUrl, chat: { model }, apiKey })
    const profile = values['llm-pi-ai'].providers['meiji-gateway']
    assert.equal(profile.baseURL, baseUrl)
    assert.equal(profile.models[0].id, model)
    assert.equal(saved.get(profile.apiKeyEnv), apiKey)
    assert.deepEqual(values['agent-default-model'], { provider: 'meiji-gateway', model })
    assert.equal(values['llm-pi-ai'].providers.other.baseURL, 'https://other.example')
    assert.ok(!JSON.stringify(values).includes(apiKey))
    assert.ok(catalog({ describe: () => [{ ns: 'llm-pi-ai', value: values['llm-pi-ai'] }] }).some(item => item.provider === 'meiji-gateway' && item.model === model))
  }
})

test('凭据写入失败时不发布无效会话模型配置', async () => {
  let updates = 0
  await assert.rejects(syncChatModel({ settings: { update: async () => updates++ }, credentials: { set: async () => { throw new Error('拒绝写入') } } }, { apiKey: 'test' }), /拒绝写入/)
  assert.equal(updates, 0)
})
