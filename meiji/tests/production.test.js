import test from 'node:test'
import assert from 'node:assert/strict'
import { bindReferencePrompt, retrieveFilm, shotReferenceImages, submitH3, videoRequestMode } from '../server/generate/film.js'
import { normalizeCharacters, normalizeScenes } from '../server/generate/story.js'

const look = '二十出头的中国青年男子，短黑发，皮肤晒黑，穿着旧外套，站在空无一人的门口'
const characterLook = [
  '国籍：中国',
  '姓名：傻根',
  '身份：进京寻亲的主角',
  '性别：男',
  '年代：当代',
  '年龄：二十二岁',
  '服装：旧外套、布鞋',
  '身高：一米七二',
  '体型：偏瘦、肩窄',
  '身型：肩窄腰细、四肢修长',
  '面相：国字脸，浓眉，黑短发，肤色晒黑，无胡须',
].join('\n')

test('a text shot with an uploaded portrait submits as multimodal', () => {
  assert.equal(videoRequestMode({ video: 'text', continuity: '开场', hasOpening: false, imageCount: 1 }), 'reference')
  assert.equal(videoRequestMode({ video: 'first_frame', continuity: '接着做', hasOpening: true, imageCount: 1 }), 'first_frame')
  assert.equal(videoRequestMode({ video: 'text', continuity: '开场', hasOpening: false, imageCount: 0 }), 'text')
  assert.equal(videoRequestMode({ video: 'text', link: 'first_last', continuity: '开场', hasOpening: true, imageCount: 1 }), 'first_frame')
})

test('character and scene cards keep separate jobs and scenes have no people field', () => {
  const characters = normalizeCharacters({ items: [{ name: '傻根', role: '主角', appearance: '青年', costume: '旧外套', prop: '袋子', identity: '短黑发', look: characterLook }] })
  assert.equal(characters.items[0].id, 'C01')
  assert.equal(characters.items[0].type, 'role')
  assert.equal(characters.items[0].nationality, '中国')
  assert.deepEqual(characters.items[0].clothes, [])
  assert.deepEqual(characters.items[0].props, [])
  assert.deepEqual(characters.items[0].hairstyles, [])
  assert.equal(characters.items[0].gender, '男')
  assert.equal(characters.items[0].era, '当代')
  assert.equal(characters.items[0].age, '二十二岁')
  assert.equal(characters.items[0].height, '一米七二')
  assert.equal(characters.items[0].build, '偏瘦、肩窄，肩窄腰细、四肢修长')
  assert.equal(characters.items[0].features, '国字脸，浓眉，黑短发，肤色晒黑，无胡须')
  assert.throws(() => normalizeCharacters({ items: [{ name: '甲', role: '人', appearance: '脸', costume: '衣', identity: '标记', look: '太短' }] }), { status: 502 })
  const scenes = normalizeScenes({ items: [{ name: '门口', landmark: '门框在右', light: '顶光', space: '一条路', look }] })
  assert.equal(normalizeScenes({ items: [1, 2, 3].map(index => ({ name: `场景${index}`, landmark: '门框在右', light: '顶光', space: '一条路', look })) }).items.length, 3)
  assert.equal(scenes.items[0].id, 'E01')
  assert.equal(scenes.items[0].type, 'scene')
})

test('gateway video submits one shot and downloads the finished mp4', async () => {
  let posted
  const queued = await submitH3({
    items: [{ track: 'S01', duration: 6, prompt: '张飞睁眼' }],
    route: { provider: 'elysium', baseUrl: 'http://43.154.247.11/v1', model: 'elysium-video', apiKey: 'test-key' },
    projectId: 'p',
    aspectRatio: '768x1344',
    fetchImpl: async (url, options) => {
      posted = { url: String(url), body: JSON.parse(options.body), authorization: options.headers.Authorization }
      return new Response(JSON.stringify({ id: 'vid-1' }))
    },
  })
  assert.equal(posted.url, 'http://43.154.247.11/v1/videos')
  assert.deepEqual(posted.body, { model: 'elysium-video', prompt: '张飞睁眼', seconds: '6', quality: 'medium' })
  assert.equal(posted.authorization, 'Bearer test-key')
  const landscape = await submitH3({
    items: [{ track: 'S01b', duration: 6, prompt: '张飞睁眼' }],
    route: { provider: 'elysium', baseUrl: 'http://43.154.247.11/v1', model: 'elysium-video', apiKey: 'test-key' },
    aspectRatio: '1344x768',
    fetchImpl: async (_url, options) => {
      posted = { body: JSON.parse(options.body) }
      return new Response(JSON.stringify({ id: 'vid-1b' }))
    },
  })
  assert.equal(Object.hasOwn(posted.body, 'size'), false)
  assert.equal(landscape.shots[0].promptId, 'vid-1b')
  const followed = await submitH3({
    items: [{ track: 'S02', duration: 6, prompt: '张飞回头', inputReference: 'abc' }],
    route: { provider: 'elysium', baseUrl: 'http://43.154.247.11/v1', model: 'elysium-video', apiKey: 'test-key' },
    fetchImpl: async (_url, options) => {
      posted = { body: JSON.parse(options.body) }
      return new Response(JSON.stringify({ id: 'vid-2' }))
    },
  })
  assert.equal(posted.body.input_reference, 'abc')
  const referenced = await submitH3({
    items: [{ track: 'S03', duration: 6, prompt: '张飞回头', inputReference: 'abc', referenceImages: ['http://gateway/v1/files/file_a/content'] }],
    route: { provider: 'elysium', baseUrl: 'http://43.154.247.11/v1', model: 'elysium-video', apiKey: 'test-key' },
    fetchImpl: async (_url, options) => {
      posted = { body: JSON.parse(options.body) }
      return new Response(JSON.stringify({ id: 'vid-3' }))
    },
  })
  assert.deepEqual(posted.body.reference_images, ['http://gateway/v1/files/file_a/content'])
  assert.equal(posted.body.input_reference, undefined)
  assert.equal(referenced.shots[0].promptId, 'vid-3')
  assert.equal(followed.shots[0].promptId, 'vid-2')
  assert.equal(queued.provider, 'elysium')
  const bytes = await retrieveFilm({
    baseUrl: queued.baseUrl,
    promptId: queued.shots[0].promptId,
    provider: 'elysium',
    apiKey: 'test-key',
    pause: async () => {},
    fetchImpl: async url => String(url).endsWith('/content')
      ? new Response(Buffer.from('mp4'))
      : new Response(JSON.stringify({ status: 'completed' })),
  })
  assert.equal(Buffer.from(bytes).toString(), 'mp4')
})

test('a shot binds uploaded character views and the scene into picture order', () => {
  const project = { plot: {
    characters: { items: [{ name: '陈锋', imageUrl: 'http://gateway/person' }] },
    scenes: { items: [{ name: '虎牢关', imageUrl: 'http://gateway/scene' }] },
  } }
  const images = shotReferenceImages(project, { characters: ['陈锋'], scene: '虎牢关' })
  assert.deepEqual(images.map(image => image.url), ['http://gateway/person', 'http://gateway/scene'])
  assert.throws(() => bindReferencePrompt('张飞睁眼', images), /subject_definitions/)
  const local = shotReferenceImages({ plot: {
    characters: { items: [{ id: 'C01', name: '麦克', localPath: '/plugins/meiji/projects/p/images/C01' }] },
    scenes: { items: [] },
  } }, { characters: ['麦克'] })
  assert.equal(local[0].url, '/plugins/meiji/projects/p/images/C01')
})
