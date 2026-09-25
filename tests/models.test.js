import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaults, normalizeModels } from '../models/router.js'
import { modelStore } from '../server/data/models.js'

test('text, image, and video share one gateway config', async () => {
  const routes = await defaults()
  const config = normalizeModels(routes)
  assert.equal(config.chat.baseUrl, 'http://43.154.247.11/v1')
  assert.equal(config.image.baseUrl, config.chat.baseUrl)
  assert.equal(config.video.apiKey, config.chat.apiKey)
  assert.equal(config.chat.model, 'elysium-chat')
  assert.equal(config.story.model, config.chat.model)
  assert.equal(config.image.model, 'elysium-image')
  assert.equal(config.video.model, 'elysium-video')
  assert.equal(config.chat.apiKey.startsWith('sk-'), true)
  assert.throws(() => normalizeModels({ ...routes, image: routes.chat }))
  assert.throws(() => normalizeModels({ ...routes, story: null }))
  assert.throws(() => normalizeModels({ ...routes, apiKey: '' }))
  assert.throws(() => normalizeModels({ ...routes, baseUrl: 'http://43.154.247.11/v1?token=1' }))
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
