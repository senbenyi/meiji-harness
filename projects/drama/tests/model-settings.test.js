import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { JSDOM } from 'jsdom'
import { createModelSettings, modelOptions } from '../src/settings/model-settings.js'
import { renderModelSettings } from '../src/client/settings-ui.js'
import { createProjectHttpHandler } from '../src/harness_server/project_routes.js'
import { createServer } from 'node:http'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'drama-model-settings-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, models: createModelSettings(root) }
}

test('公共setting保存语言与四类模型，重开恢复；非法选择不覆盖已有配置', async t => {
  const { root, models } = await fixture(t)
  assert.equal((await models.read()).session.model, 'codex-gpt')
  await models.save({ text: { model: 'qwen3.5:27b' }, output_language: 'en' })
  const fresh = createModelSettings(root)
  assert.equal((await fresh.read()).text.model, 'qwen3.5:27b')
  assert.equal((await fresh.read()).output_language, 'en')
  const before = await readFile(join(root, 'models.json'), 'utf8')
  await assert.rejects(models.save({ image: { model: 'unknown' } }), /请选择有效模型/)
  await assert.rejects(models.save({ arbitrary: true }), /未知设置字段/)
  assert.equal(await readFile(join(root, 'models.json'), 'utf8'), before)
})

test('制作文本直接使用packages/http-client，根据当前设置发模型名及标准messages', async t => {
  const { models } = await fixture(t)
  let request
  const output = await models.complete({ messages: [{ role: 'user', content: '测试' }], fetchImpl: async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) }
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '成功' } }] }), { status: 200 })
  } })
  assert.equal(output, '成功')
  assert.equal(request.url, 'http://127.0.0.1:11435/v1/chat/completions')
  assert.equal(request.body.model, 'codex-gpt')
  assert.deepEqual(request.body.messages, [{ role: 'user', content: '测试' }])
})

test('设置HTTP独立于项目会话：鉴权、请求标识、保存与恢复', async t => {
  const { root } = await fixture(t)
  const handler = createProjectHttpHandler({ root }, { authorize: req => req.headers['x-test-user'] ? null : 401 })
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const url = `http://127.0.0.1:${server.address().port}/api/drama/settings`
  assert.equal((await fetch(url)).status, 401)
  const get = async () => (await fetch(url, { headers: { 'X-Test-User': '1' } })).json()
  const result = await get()
  assert.deepEqual(Object.keys(result.modelOptions), ['session', 'text', 'image', 'video'])
  assert.equal((await fetch(url, { method: 'POST', headers: { 'X-Test-User': '1' }, body: '{}' })).status, 403)
  const saved = await fetch(url, { method: 'POST', headers: { 'X-Test-User': '1', 'X-Drama-Request': '1' }, body: JSON.stringify({ settings: { image: { model: 'krea2 turbo V2.5' } } }) })
  assert.equal(saved.status, 200)
  assert.equal((await get()).settings.image.model, 'krea2 turbo V2.5')
})

test('四类模型UI显示主Agent GPT，保存失败回退原选择', async t => {
  const { models } = await fixture(t)
  const dom = new JSDOM('<main></main>'), previous = globalThis.document
  globalThis.document = dom.window.document
  t.after(() => { globalThis.document = previous; dom.window.close() })
  const root = document.querySelector('main')
  renderModelSettings(root, { settings: await models.read(), modelOptions, titles: { session: '主 Agent' }, saveSettings: async () => { throw new Error('保存失败') } })
  assert.equal(root.querySelectorAll('select').length, 4)
  assert.equal(root.querySelector('[name=session]').getAttribute('aria-label'), '主 Agent')
  assert.equal(root.querySelector('[name=session]').selectedOptions[0].textContent, 'GPT')
  const text = root.querySelector('[name=text]'); text.value = 'qwen3.5:27b'
  await text.onchange()
  assert.equal(text.value, 'codex-gpt')
  assert.match(root.textContent, /保存失败/)
})
