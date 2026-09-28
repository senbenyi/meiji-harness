import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defaults, normalizeModels } from '../models/router.js'
import { modelStore } from '../server/data/models.js'

test('text, image, and video share one gateway config', async () => {
  const routes = { ...await defaults(), apiKey: 'sk-test-only' }
  const config = normalizeModels(routes)
  assert.equal(config.chat.baseUrl, 'https://43.154.247.11/v1')
  assert.equal(config.image.baseUrl, config.chat.baseUrl)
  assert.equal(config.video.apiKey, config.chat.apiKey)
  assert.equal(config.chat.model, 'elysium-chat')
  assert.equal(config.story.model, config.chat.model)
  assert.equal(config.image.model, 'elysium-image')
  assert.equal(config.video.model, 'elysium-video')
  assert.equal(config.chat.apiKey, 'sk-test-only')
  assert.throws(() => normalizeModels({ ...routes, image: routes.chat }))
  assert.throws(() => normalizeModels({ ...routes, story: null }))
  assert.throws(() => normalizeModels({ ...routes, apiKey: '' }))
  assert.throws(() => normalizeModels({ ...routes, baseUrl: 'http://43.154.247.11/v1?token=1' }))
})
test('local config file supplies the key and git-tracked defaults carry none', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meiji-test-'))
  try {
    const missing = await defaults(pathToFileURL(join(root, 'absent.json')))
    assert.equal(missing.apiKey, '')
    assert.equal(missing.chat.model, 'elysium-chat')
    const local = join(root, 'models.local.json')
    await writeFile(local, JSON.stringify({ apiKey: 'sk-local-only' }))
    const merged = await defaults(pathToFileURL(local))
    assert.equal(merged.apiKey, 'sk-local-only')
    assert.equal(merged.baseUrl, missing.baseUrl)
    assert.equal(normalizeModels(merged).video.apiKey, 'sk-local-only')
  } finally { await rm(root, { recursive: true }) }
})
test('saved routing survives a fresh store instance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meiji-test-'))
  try {
    const store = modelStore(root)
    const routes = await store.read()
    routes.story = { provider: 'story-provider', model: 'story-model' }
    await store.write(routes)
    assert.deepEqual(await modelStore(root).read(), routes)
  } finally { await rm(root, { recursive: true }) }
})
