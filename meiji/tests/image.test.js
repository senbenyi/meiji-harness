import { pictureOf, cardModel } from '../shared/drama-model.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaults, normalizeModels } from '../models/model-config.js'
import { appendImageAsset, characterImagePrompt, characterStillPrompt, imageAsset, imageAssets, imagePrompt, importAssetImage, nextPartId, partPrompt, pencilPrompt, readStill, saveCharacterReference, sceneStillPrompt, submitAssetImage, clearCharacterImage, usableLook, withPartText } from '../server/generate/image.js'
import { characterImageSize } from '../server/generate/gateway.js'
import { builtinSkill } from '../skills/load.js'

const assets = {
  status: 'analyzed',
  items: [
    { id: 'A01', name: '林', type: 'role', kind: 'base', desc: '成年男子', look: '二十出头的中国男子，短黑发，皮肤晒黑，穿着旧外套，手里拎着鼓囊的编织袋' },
    { id: 'A02', name: '信', type: 'tool', kind: 'base', desc: '一封信' },
    { id: 'A03', name: '房间', type: 'scene', kind: 'base', desc: '窗边书桌', look: '旧式绿皮火车硬座车厢内部，座椅磨旧，暖黄灯光，过道狭窄，窗边有行李架' },
  ],
}

test('a pencil sheet keeps one panel for every second', () => {
  const prompt = pencilPrompt({
    id: 'S01', duration: 2, scene: '天台',
    panels: [
      { time: '0–1s', pose: '背对镜头走向边缘', camera: '锁定中远景', space: '人在左' },
      { time: '1–2s', pose: '纵身跃下', camera: '仰角固定', space: '人在中' },
    ],
  })
  assert.match(prompt, /一共 2 格/)
  assert.match(prompt, /灰白纯色背景/)
  assert.match(prompt, /0–1s：背对镜头走向边缘/)
  assert.match(prompt, /1–2s：纵身跃下/)
  assert.match(prompt, /同一张图/)
  assert.throws(() => pencilPrompt({ panels: [] }), /文本分镜/)
})

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
    const href = String(url)
    if (init?.method === 'POST') {
      posts.push(JSON.parse(init.body))
      return Response.json({ prompt_id: posts.length === 1 ? 'role' : 'scene' })
    }
    if (href.includes('/history/role')) return Response.json({ role: { status: { completed: true }, outputs: { 7: { images: [{ filename: 'role.png', subfolder: 'meiji', type: 'output' }] } } } })
    if (href.includes('/history/scene')) return Response.json({ scene: { status: { completed: true }, outputs: { 7: { images: [{ filename: 'scene.png', subfolder: '', type: 'output' }] } } } })
    if (href.includes('/view')) return new Response(png)
    throw new Error(href)
  }
  const backend = { provider: 'comfyui', baseUrl: 'http://comfy.test/comfy' }
  const input = { assets, aspectRatio: '768x1344', backend, projectId: 'p1', directory, fetchImpl, pause: async () => {} }
  try {
    const saved = await submitAssetImage({ ...input, itemId: 'A01', seed: 11 })
    assert.equal(posts.length, 1)
    assert.equal(posts[0].prompt['1'].inputs.ckpt_name, 'RealVisXL_V5.0_fp16.safetensors')
    assert.deepEqual([posts[0].prompt['4'].inputs.width, posts[0].prompt['4'].inputs.height], [768, 1344])
    assert.equal(posts[0].prompt['2'].inputs.text, assets.items[0].look)
    assert.equal(posts[0].prompt['5'].inputs.seed, 11)
    assert.equal(/[A-Za-z]{4,}/.test(posts[0].prompt['2'].inputs.text), false)
    assert.equal(saved.items[1].localPath, undefined)
    assert.equal(saved.items[1].imageUrl, undefined)
    assert.match(pictureOf(saved.items[0]).localPath, /\?v=11$/)
    assert.equal(pictureOf(saved.items[0]).imageUrl, null)
    assert.equal((await readFile(join(directory, 'A01.png'))).equals(png), true)
    const again = await submitAssetImage({ ...input, assets: saved, itemId: 'A01', seed: 22 })
    assert.equal(posts.length, 2)
    assert.equal(posts[1].prompt['5'].inputs.seed, 22)
    assert.match(pictureOf(again.items[0]).localPath, /\?v=22$/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('clearing a character image drops the bound file', () => {
  const cleared = clearCharacterImage({
    items: [cardModel({ id: 'C01', name: '黄征', type: 'role', localPath: '/images/C01', imageUrl: 'http://gateway/a' })],
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

test('a character still prompt keeps the face and figure and drops clothing', () => {
  const card = {
    type: 'role',
    role: '桃园结义大哥',
    gender: '男',
    era: '三国',
    age: '四十三岁',
    costume: '绿袍锦缎长衣，青色战甲',
    height: '一米八五',
    build: '中等、肩宽',
    figure: '肩宽腰稳、四肢厚实',
    features: '面容温和，双耳垂肩，短须',
    name: '刘备',
    look: '国籍：中国 身份：桃园结义大哥 性别：男 年代：三国 年龄：四十三岁 服装：绿袍锦缎长衣 身高：一米八五 体型：中等、肩宽 身型：肩宽腰稳、四肢厚实 面相：面容温和，双耳垂肩，短须 面向：正面平视镜头',
  }
  // 人物资料只含外观字段；构图与着装约束来自固定文件，不再写死在代码或可编辑生成字段里。
  assert.equal(/正面全身照|上半身裸露|比基尼|3MB/.test(characterStillPrompt(card)), false)
  const prompt = characterImagePrompt(card, { style: '写实' })
  assert.ok(prompt.startsWith('正面全身照，从头到脚都在画面里，灰白纯色背景'))
  assert.ok(prompt.endsWith(characterStillPrompt(card)))
  assert.doesNotMatch(prompt, /根据人物卡生成|保持姓名对应的身份|未成年人保持完整服装/)
  assert.match(prompt, /中国，刘备，桃园结义大哥，男，三国，四十三岁，一米八五，中等、肩宽，肩宽腰稳、四肢厚实，面容温和，双耳垂肩，短须/)
  assert.equal(/国籍：|姓名：|身份：|性别：|年代：|年龄：|身高：|体型：|身型：|面相：|形态：|服装：/.test(prompt), false)
  assert.match(prompt, /面容温和，双耳垂肩，短须/)
  assert.match(prompt, /上半身裸露/)
  assert.match(builtinSkill('character-image').constraints, /## 成年人物/)
  assert.match(prompt, /正面全身照/)
  assert.match(prompt, /灰白纯色背景/)
  assert.equal(prompt.includes('无背景'), false)
  assert.match(prompt, /小于 3MB/)
  assert.equal(prompt.includes('绿袍'), false)
  assert.equal(prompt.includes('战甲'), false)
  assert.equal(prompt.includes('正面平视'), false)
})

test('a minor or unknown-age character still stays clothed and ignores editable constraints', () => {
  const project = { skills: { additions: { 'character-image': { generate: '本剧补充的着装要求' } } } }
  for (const card of [{ gender: '女', age: '十六岁', look: '年龄：十六岁 性别：女 面相：圆脸' }, { gender: '女', age: '青年', look: '年龄：青年 性别：女 面相：圆脸' }]) {
    const prompt = characterImagePrompt(card, project)
    assert.match(prompt, /正面全身照/)
    assert.match(prompt, /灰白纯色背景/)
    assert.match(prompt, /穿着完整服装/)
    assert.equal(prompt.includes('比基尼'), false)
    assert.equal(prompt.includes('上半身裸露'), false)
    assert.equal(prompt.includes('本剧补充的着装要求'), false)
  }
  const adult = characterImagePrompt({ gender: '女', age: '23', look: '年龄：23 性别：女' }, project)
  assert.doesNotMatch(adult, /本剧补充的着装要求/)
})

test('an image asset keeps only id, name, and the two paths', () => {
  const asset = imageAsset({ id: 'W01', name: '旧外套', localPath: '/plugins/meiji/projects/p/images/W01', imageUrl: 'http://gateway/coat', costume: '旧外套', file: { url: 'http://ignored' } })
  assert.deepEqual(asset, { id: 'W01', name: '旧外套', localPath: '/plugins/meiji/projects/p/images/W01', imageUrl: 'http://gateway/coat' })
  assert.deepEqual(imageAssets([{ name: '缺编号' }, { id: 'H01', name: '短发' }]), [{ id: 'H01', name: '短发', localPath: null, imageUrl: null }])
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
  assert.deepEqual(saved.items[0].clothes, [{ id: 'C01-W01', name: '衣服01', localPath: '/plugins/meiji/projects/p/images/C01-W01', imageUrl: null }])
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
      backend: { provider: 'elysium', baseUrl: 'http://43.154.247.11/v1', model: 'elysium-image', apiKey: 'test-key' },
      prompt,
      fetchImpl: async (url, options) => {
        if (options.method === 'POST') {
          posted = { url: String(url), body: JSON.parse(options.body), authorization: options.headers.Authorization }
          return Response.json({ id: 'image_test', status: 'queued' })
        }
        if (url.pathname.endsWith('/content')) return new Response(png)
        return Response.json({ status: 'completed' })
      },
    })
    assert.equal(posted.url, 'http://43.154.247.11/v1/images/tasks')
    assert.equal(posted.body.model, 'elysium-image')
    assert.equal(posted.body.size, '768x1344')
    assert.equal(posted.body.prompt, prompt)
    assert.equal(posted.body.image, undefined)
    assert.equal(posted.authorization, 'Bearer test-key')
    assert.equal(pictureOf(saved.items[0]).localPath.includes('/images/A01'), true)
    assert.deepEqual(await readFile(join(directory, 'A01.png')), png)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('reference image generation posts a data URL and keeps the reference beside the character', async () => {
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
      backend: { provider: 'elysium', baseUrl: 'http://43.154.247.11/v1', model: 'elysium-image', apiKey: 'test-key' },
      prompt: '二十出头的中国男子',
      referenceImage: `data:${file.mime};base64,${file.bytes.toString('base64')}`,
      fetchImpl: async (url, options) => {
        if (options.method === 'POST') {
          posted = JSON.parse(options.body)
          return Response.json({ id: 'image_ref', status: 'queued' })
        }
        if (url.pathname.endsWith('/content')) return new Response(png)
        return Response.json({ status: 'completed' })
      },
    })
    assert.equal(posted.size, '768x1344')
    assert.equal(posted.image, `data:image/png;base64,${png.toString('base64')}`)
    assert.equal(Object.hasOwn(posted, 'reference_images'), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('text-to-image stops when ComfyUI is not configured or nothing is visual', async () => {
  const input = { assets, projectId: 'p', directory: '/tmp/meiji-unused', fetchImpl: async () => { throw new Error('should not fetch') } }
  await assert.rejects(submitAssetImage({ ...input, itemId: 'A01', backend: null, env: {} }), { status: 409 })
  await assert.rejects(submitAssetImage({ ...input, itemId: 'A02', backend: { provider: 'comfyui', baseUrl: 'http://comfy.test/comfy' } }), { status: 400 })
})
