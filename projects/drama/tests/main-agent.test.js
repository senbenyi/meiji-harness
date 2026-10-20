import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { configureMainAgent, mainAgentProvider } from '../src/settings/main-agent.js'
import { createModelSettings } from '../src/settings/model-settings.js'

test('登记主Agent GPT路由并配置宿主默认，模型地址与制作文本一致', async () => {
  const calls = []
  const ctx = { credentials: { async set(...args) { calls.push(['credential', ...args]) } }, settings: {
    async mutate(...args) { calls.push(['provider', ...args]) }, async update(...args) { calls.push(['default', ...args]) },
  } }
  await configureMainAgent(ctx, { baseUrl: 'http://127.0.0.1:11435/v1', session: { model: 'codex-gpt' } })
  assert.equal(calls[1][2][0].path[1], mainAgentProvider)
  assert.equal(calls[1][2][0].value.baseURL, 'http://127.0.0.1:11435/v1')
  assert.deepEqual(calls[2], ['default', 'agent-default-model', { provider: mainAgentProvider, model: 'codex-gpt' }])
})

test('主Agent设置同步失败不写配置；制作文本选择不改变主Agent', async t => {
  const root = await mkdtemp(join(tmpdir(), 'drama-main-agent-')); t.after(() => rm(root, { recursive: true, force: true }))
  let synced = 0
  const models = createModelSettings(root, { onSessionModel: async () => { synced++; throw new Error('主Agent配置失败') } })
  await models.save({ text: { model: 'qwen3.5:27b' } })
  assert.equal(synced, 0)
  const before = await models.read()
  await assert.rejects(models.save({ session: { model: 'codex-gpt' }, output_language: 'en' }), /配置失败/)
  assert.deepEqual(await models.read(), before)
  assert.equal(synced, 1)
})
