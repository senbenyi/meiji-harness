import { pictureOf, cardModel } from '../shared/drama-model.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaults, normalizeModels } from '../models/model-config.js'
import { appendImageAsset, imageAsset, imageAssets, imagePrompt, nextPartId, partPrompt, sceneStillPrompt, clearCharacterImage, usableLook, withPartText } from '../shared/image-assets.js'
import { importAssetImage, saveCharacterReference, submitAssetImage } from '../server/flow/shared/image-files.js'
import { readStill } from '../server/media/image-files.js'
import { characterImageSize } from '../server/gateway/model-gateway.js'

const assets = {
  status: 'analyzed',
  items: [
    { id: 'A01', name: '林', type: 'role', kind: 'base', desc: '成年男子', look: '二十出头的中国男子，短黑发，皮肤晒黑，穿着旧外套，手里拎着鼓囊的编织袋' },
    { id: 'A02', name: '信', type: 'tool', kind: 'base', desc: '一封信' },
    { id: 'A03', name: '房间', type: 'scene', kind: 'base', desc: '窗边书桌', look: '旧式绿皮火车硬座车厢内部，座椅磨旧，暖黄灯光，过道狭窄，窗边有行李架' },
  ],
}



test('gateway image route is stored and a chat model cannot take that slot', async () => {
  const routes = { ...await defaults(), apiKey: 'sk-test-only' }
  const image = normalizeModels(routes).image
  assert.equal(image.model, 'elysium-image')
  assert.equal(image.baseUrl, 'http://43.154.247.11/v1')
  assert.equal(normalizeModels({ ...routes, baseUrl: 'https://43.154.247.11/v1/' }).image.baseUrl, 'https://43.154.247.11/v1')
  assert.throws(() => normalizeModels({ ...routes, image: routes.chat }))
  assert.throws(() => normalizeModels({ ...routes, baseUrl: 'http://43.154.247.11/v1?token=1' }))
})

test('each AI click generates a new still and replaces the previous file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiji-image-'))
  const posts = []
  const png = Buffer.from([137, 80, 78, 71])
  const fetchImpl = async (url, init) => {
    posts.push(JSON.parse(init.body))
    return Response.json({ data: [{ b64_json: png.toString('base64') }] })
  }
  const backend = { baseUrl: 'http://gateway.test/v1', apiKey: 'test', model: 'image' }
  const input = { assets, aspectRatio: '768x1344', backend, projectId: 'p1', directory, fetchImpl, pause: async () => {} }
  try {
    const saved = await submitAssetImage({ ...input, itemId: 'A01', seed: 11 })
    assert.equal(posts.length, 1)
    assert.equal(posts[0].size, '768x1344')
    assert.equal(posts[0].prompt, assets.items[0].look)
    assert.equal(posts[0].seed, 11)
    assert.equal(saved.items[1].localPath, undefined)
    assert.equal(saved.items[1].imageUrl, undefined)
    assert.match(pictureOf(saved.items[0]).localPath, /\?v=11$/)
    assert.equal(Object.hasOwn(pictureOf(saved.items[0]), 'imageUrl'), false)
    assert.equal(saved.items[0].image.status, 'passed')
    assert.equal((await readFile(join(directory, 'A01.png'))).equals(png), true)
    const again = await submitAssetImage({ ...input, assets: saved, itemId: 'A01', seed: 22 })
    assert.equal(posts.length, 2)
    assert.equal(posts[1].seed, 22)
    assert.match(pictureOf(again.items[0]).localPath, /\?v=22$/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('clearing a character image drops the bound file', () => {
  const cleared = clearCharacterImage({
    items: [cardModel({ id: 'C01', name: '黄征', type: 'role', localPath: '/images/C01' })],
  }, 'C01')
  assert.equal(cleared.items[0].image.content, null)
  assert.equal(cleared.items[0].image.status, 'not-generated')
  assert.equal(cleared.items[0].file, undefined)
  assert.equal(cleared.items[0].name, '黄征')
  assert.throws(() => clearCharacterImage({ items: [{ id: 'E01', type: 'scene', imageUrl: '/images/E01' }] }, 'E01'), { status: 400 })
})

test('importing a still replaces the generated file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiji-import-'))
  const jpeg = Buffer.from([0xff, 0xd8, 0xff])
  try {
    await writeFile(join(directory, 'A01.png'), Buffer.from('old'))
    const saved = await importAssetImage({ assets, itemId: 'A01', projectId: 'p1', directory, bytes: jpeg, mime: 'image/jpeg' })
    const file = await readStill(directory, 'A01')
    assert.equal(file.mime, 'image/jpeg')
    assert.equal(file.bytes.equals(jpeg), true)
    await assert.rejects(readFile(join(directory, 'A01.png')), { code: 'ENOENT' })
    assert.match(pictureOf(saved.items[0]).localPath, /\/images\/A01\?v=/)
    assert.equal(saved.items[1].imageUrl, undefined)
    await assert.rejects(importAssetImage({ assets, itemId: 'A02', projectId: 'p1', directory, bytes: jpeg, mime: 'image/png' }), { status: 400 })
    await assert.rejects(importAssetImage({ assets, itemId: 'A01', projectId: 'p1', directory, bytes: jpeg, mime: 'image/gif' }), { status: 400 })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('an image asset keeps only id, name, and the two paths', () => {
  const asset = imageAsset({ id: 'W01', name: '旧外套', localPath: '/plugins/meiji/projects/p/images/W01', costume: '旧外套' })
  assert.deepEqual(asset, { id: 'W01', name: '旧外套', localPath: '/plugins/meiji/projects/p/images/W01' })
  assert.deepEqual(imageAssets([{ name: '缺编号' }, { id: 'H01', name: '短发' }]), [{ id: 'H01', name: '短发', localPath: null }])
})

test('clothes, props, and hairstyles append as image assets', () => {
  const character = { id: 'C01', name: '刘备', type: 'role', costume: '绿袍', prop: '双股剑', hairstyle: '长耳', mount: '赤兔马', features: '方脸' }
  assert.equal(nextPartId(character, 'clothes'), 'C01-W01')
  assert.match(partPrompt(character, 'clothes'), /绿袍/)
  assert.match(partPrompt(character, 'clothes'), /灰白纯色背景/)
  assert.match(partPrompt(character, 'props'), /双股剑/)
  assert.match(partPrompt(character, 'hairstyles'), /长耳/)
  assert.equal(/方脸/.test(partPrompt(character, 'hairstyles')), false)
  assert.match(partPrompt(character, 'mounts'), /赤兔马/)
  const noted = withPartText({ id: 'C01', name: '刘备', type: 'role', look: '国籍：中国\n姓名：刘备\n身份：主公\n性别：男\n年代：三国\n年龄：四十岁\n服装：旧袍\n身高：一米八\n体型：结实\n面相：方脸' }, 'clothes', '绿袍')
  assert.equal(noted.costume, '绿袍')
  assert.match(noted.look, /服装：绿袍/)
  assert.match(noted.look, /姓名：刘备/)
  assert.equal(nextPartId(character, 'mounts'), 'C01-M01')
  assert.equal(characterImageSize(''), '768x1344')
  assert.equal(characterImageSize('16:9'), '1344x768')
  assert.throws(() => characterImageSize('21:9'), { status: 400 })
  const saved = appendImageAsset({ items: [character] }, 'C01', 'clothes', { id: 'C01-W01', name: '衣服01', localPath: '/plugins/meiji/projects/p/images/C01-W01', extra: 'no' })
  assert.deepEqual(saved.items[0].clothes, [{ id: 'C01-W01', name: '衣服01', localPath: '/plugins/meiji/projects/p/images/C01-W01' }])
  assert.equal(nextPartId(saved.items[0], 'clothes'), 'C01-W02')
})

test('image prompts come from each asset look and derived items keep their own text', () => {
  const look = '三十岁左右的中国女子，黑发束起，穿着宽松外套，一只手搭在隆起的腹部'
  assert.equal(imagePrompt({ name: '王丽', type: 'role', look }), look)
  assert.equal(sceneStillPrompt({ name: '沙漠', look: '烈日下无垠黄沙沙漠空镜，沙丘起伏，热浪扭曲空气' }), '烈日下无垠黄沙沙漠空镜，沙丘起伏，热浪扭曲空气')
  assert.equal(usableLook('怀孕'), '')
  assert.equal(usableLook('A young Chinese man in a worn jacket holding a bag'), 'A young Chinese man in a worn jacket holding a bag')
  assert.throws(() => imagePrompt({ name: '王丽', look: '怀孕' }), { status: 400 })
})

test('gateway text-to-image posts the supplied Chinese prompt and stores the returned png', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiji-gateway-'))
  const png = Buffer.from([137, 80, 78, 71])
  const prompt = '二十出头的中国男子，短黑发，正面全身照'
  let posted
  try {
    const saved = await submitAssetImage({
      assets, itemId: 'A01', aspectRatio: '768x1344', projectId: 'p1', directory, seed: 4,
      backend: { provider: 'elysium', baseUrl: 'http://43.154.247.11/v1', model: 'elysium-image', apiKey: 'test-key', model: 'elysium-image' },
      prompt,
      fetchImpl: async (url, options) => {
        if (options.method === 'GET') {
          assert.equal(url.pathname, '/v1/media/image_1')
          assert.equal(options.headers.Authorization, 'Bearer test-key')
          return new Response(png)
        }
        assert.equal(options.method, 'POST')
        posted = { url: String(url), body: JSON.parse(options.body), authorization: options.headers.Authorization }
        return Response.json({ created: 1, data: [{ url: 'http://43.154.247.11/v1/media/image_1' }] })
      },
    })
    assert.equal(posted.url, 'http://43.154.247.11/v1/images/generations')
    assert.deepEqual(posted.body, { model: 'elysium-image', prompt, size: '768x1344', seed: 4 })
    assert.equal(posted.authorization, 'Bearer test-key')
    assert.equal(pictureOf(saved.items[0]).localPath.includes('/images/A01'), true)
    assert.deepEqual(await readFile(join(directory, 'A01.png')), png)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('reference image generation uploads the reference to images/edits and keeps the reference beside the character', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiji-ref-'))
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  let posted
  try {
    const saved = await saveCharacterReference({
      assets, itemId: 'A01', projectId: 'p1', episodeId: 'e1', directory, bytes: png, mime: 'image/png',
    })
    assert.equal(saved.items[0].reference.mime, 'image/png')
    assert.match(saved.items[0].reference.localPath, /A01-ref/)
    assert.deepEqual(await readFile(join(directory, 'A01-ref.png')), png)
    const file = await readStill(directory, 'A01-ref')
    await submitAssetImage({
      assets: saved, itemId: 'A01', aspectRatio: '768x1344', projectId: 'p1', directory, seed: 4,
      backend: { provider: 'elysium', baseUrl: 'http://43.154.247.11/v1', model: 'elysium-image', apiKey: 'test-key', model: 'elysium-image' },
      prompt: '二十出头的中国男子',
      referenceBytes: file.bytes, referenceMime: file.mime,
      fetchImpl: async (url, options) => {
        if (options.method === 'GET') {
          assert.equal(url.pathname, '/v1/media/image_1')
          assert.equal(options.headers.Authorization, 'Bearer test-key')
          return new Response(png)
        }
        assert.equal(options.method, 'POST')
        assert.equal(options.headers['Content-Type'], undefined)
        posted = { url: String(url), form: options.body }
        return Response.json({ created: 1, data: [{ url: 'http://43.154.247.11/v1/media/image_1' }] })
      },
    })
    assert.equal(posted.url, 'http://43.154.247.11/v1/images/edits')
    assert.deepEqual([...posted.form.keys()], ['model', 'prompt', 'size', 'image[]'])
    assert.equal(posted.form.get('size'), '768x1344')
    assert.equal(posted.form.get('model'), 'elysium-image')
    const sent = posted.form.get('image[]')
    assert.equal(sent.type, 'image/png')
    assert.deepEqual(Buffer.from(await sent.arrayBuffer()), png)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('text-to-image stops at the gateway when credentials are missing or prompt is empty', async () => {
  const input = { assets, projectId: 'p', directory: '/tmp/meiji-unused', fetchImpl: async () => { throw new Error('should not fetch') } }
  await assert.rejects(submitAssetImage({ ...input, itemId: 'A01', backend: null, env: {} }), { status: 400 })
  await assert.rejects(submitAssetImage({ ...input, itemId: 'A02', backend: { provider: 'comfyui', baseUrl: 'http://comfy.test/comfy' } }), { status: 400 })
})


test('all image entry points save and register candidates inside their third planned step', async t => {
  const { recordSteps } = await import('./fixtures/nodes.js')
  const { activeNode, executionNodes } = await import('../server/runtime/task-context.js')
  const { finalizeNodes } = await import('../server/runtime/task-state.js')
  const { generateStillFile } = await import('../server/flow/shared/image-files.js')
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  for (const [generate, target] of [[submitAssetImage, 'image:A01'], [generateStillFile, 'image:A01:clothes']]) {
    for (const legacy of [false, true]) {
      const directory = await mkdtemp(join(tmpdir(), 'meiji-image-nodes-'))
      t.after(() => rm(directory, { recursive: true, force: true }))
      const planned = ['image_generate', 'image_download', 'image_save'].map((kind, index) => ({ id: String(index), kind, target, status: 'pending' }))
      let registered = false
      await recordSteps(() => generate({ assets, itemId: 'A01', track: 'S01', projectId: 'p', directory, prompt: '正面全身人物图', stepTarget: target,
        backend: { ...{ baseUrl: 'https://gateway.test/v1', apiKey: 'test-key', model: 'elysium-image' }, provider: 'elysium' },
        fetchImpl: async (_url, options) => options.method === 'POST'
          ? Response.json({ data: [legacy ? { b64_json: png.toString('base64') } : { url: '/v1/media/image' }] })
          : new Response(png),
        onSaved: async () => {
          assert.equal(activeNode().kind, 'image_save')
          assert.equal(executionNodes().filter(step => step.status === 'running').length, 1)
          assert.deepEqual(await readFile(join(directory, 'A01.png')), png)
          registered = true
        },
      }), planned)
      assert.equal(registered, true)
      finalizeNodes(planned)
      assert.deepEqual(planned.map(step => step.status), legacy ? ['completed', 'skipped', 'completed'] : ['completed', 'completed', 'completed'])
      assert.ok(planned.every(step => !step.unplanned))
    }
  }
})

test('candidate registration failure is recorded on the save step', async t => {
  const { recordSteps } = await import('./fixtures/nodes.js')
  const directory = await mkdtemp(join(tmpdir(), 'meiji-image-save-fail-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const planned = ['image_generate', 'image_download', 'image_save'].map((kind, index) => ({ id: String(index), kind, target: 'image:A01', status: 'pending' }))
  await recordSteps(async () => {
    await assert.rejects(submitAssetImage({ assets, itemId: 'A01', projectId: 'p', directory, prompt: '正面全身人物图', stepTarget: 'image:A01',
      backend: { baseUrl: 'https://gateway.test/v1', apiKey: 'test-key', model: 'elysium-image' },
      fetchImpl: async (_url, options) => options.method === 'POST' ? Response.json({ data: [{ url: '/v1/media/image' }] }) : new Response(Buffer.from([137, 80, 78, 71])),
      onSaved: () => { throw new Error('候选登记失败') },
    }), /候选登记失败/)
  }, planned)
  assert.deepEqual(planned.map(step => step.status), ['completed', 'completed', 'failed'])
})
