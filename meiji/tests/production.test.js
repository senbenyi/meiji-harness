import test from 'node:test'
import assert from 'node:assert/strict'
import { bindReferencePrompt, h3PromptFailures, retrieveFilm, shotReferenceImages, submitH3, videoRequestMode } from '../server/generate/film.js'
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
  assert.deepEqual(posted.body, { model: 'elysium-video', prompt: '张飞睁眼', seconds: '6', size: '576x1024' })
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
  assert.deepEqual(posted.body, { model: 'elysium-video', prompt: '张飞睁眼', seconds: '6', size: '1024x576' })
  assert.equal(landscape.shots[0].promptId, 'vid-1b')
  const followed = await submitH3({
    items: [{ track: 'S02', duration: 6, prompt: '张飞回头', inputReference: 'abc' }],
    route: { provider: 'elysium', baseUrl: 'http://43.154.247.11/v1', model: 'elysium-video', apiKey: 'test-key' },
    fetchImpl: async (_url, options) => {
      posted = { body: JSON.parse(options.body) }
      return new Response(JSON.stringify({ id: 'vid-2' }))
    },
  })
  assert.deepEqual(posted.body, { model: 'elysium-video', prompt: '张飞回头', seconds: '6', size: '1024x576', input_reference: 'abc' })
  const referenced = await submitH3({
    items: [{ track: 'S03', duration: 6, prompt: '张飞回头', inputReference: 'abc', referenceImages: ['data:image/png;base64,iVBORw0KGgo='] }],
    route: { provider: 'elysium', baseUrl: 'http://43.154.247.11/v1', model: 'elysium-video', apiKey: 'test-key' },
    fetchImpl: async (_url, options) => {
      posted = { body: JSON.parse(options.body) }
      return new Response(JSON.stringify({ id: 'vid-3' }))
    },
  })
  assert.deepEqual(posted.body, { model: 'elysium-video', prompt: '张飞回头', seconds: '6', size: '1024x576', reference_images: ['data:image/png;base64,iVBORw0KGgo='] })
  await assert.rejects(submitH3({
    items: [{ track: 'S04', duration: 6, prompt: '张飞回头', referenceImages: ['http://gateway/v1/files/file_a/content'] }],
    route: { provider: 'elysium', baseUrl: 'http://43.154.247.11/v1', model: 'elysium-video', apiKey: 'test-key' },
    fetchImpl: async () => assert.fail('远端地址不能提交'),
  }), /base64 data URL/)
  await assert.rejects(submitH3({
    items: [{ track: 'S05', duration: 6, prompt: '张飞回头', referenceImages: [`data:image/png;base64,${'A'.repeat(64 * 1024 * 1024)}`] }],
    route: { provider: 'elysium', baseUrl: 'http://43.154.247.11/v1', model: 'elysium-video', apiKey: 'test-key' },
    fetchImpl: async () => assert.fail('超过 64 MiB 不能提交'),
  }), { status: 413 })
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
    characters: { items: [{ name: '陈锋', localPath: '/plugins/meiji/asset-file?category=characters&id=a' }] },
    scenes: { items: [{ name: '虎牢关', localPath: '/plugins/meiji/asset-file?category=scenes&id=b' }] },
  } }
  const images = shotReferenceImages(project, { characters: ['陈锋'], scene: '虎牢关' })
  assert.deepEqual(images.map(image => image.url), ['/plugins/meiji/asset-file?category=characters&id=a', '/plugins/meiji/asset-file?category=scenes&id=b'])
  assert.throws(() => bindReferencePrompt('张飞睁眼', images), /subject_definitions/)
  const local = shotReferenceImages({ plot: {
    characters: { items: [{ id: 'C01', name: '麦克', localPath: '/plugins/meiji/projects/p/images/C01' }] },
    scenes: { items: [] },
  } }, { characters: ['麦克'] })
  assert.equal(local[0].url, '/plugins/meiji/projects/p/images/C01')
})

test('video reference images are read locally and sent as base64 in picture order', async t => {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { Readable } = await import('node:stream')
  const { setupModel } = await import('./fixtures/model.js')
  const { assetStore } = await import('../server/data/library.js')
  const { referenceImageData } = await import('../server/data/pictures.js')
  const e = await setupModel(t), project = await e.read()
  const asset = await assetStore(e.home).import('characters', '旅人.png', Readable.from([Buffer.from('person')]), undefined, { source: 'import' })
  const films = join(e.home, 'storages', 'meiji', 'projects', project.id, 'films', project.episodeId)
  await mkdir(films, { recursive: true })
  await writeFile(join(films, 'S01-x-last.png'), Buffer.from('tail'))
  const images = [
    { url: 'tail-frame:S01-x.mp4', kind: 'tailFrame', sourceVideoFile: 'S01-x.mp4', label: '上一镜尾帧' },
    { url: `/plugins/meiji/asset-file?category=characters&id=${asset.id}`, assetId: asset.id, assetCategory: 'characters', kind: 'characters', label: '旅人' },
  ]
  assert.deepEqual(await referenceImageData(e.home, project, images), [
    `data:image/png;base64,${Buffer.from('tail').toString('base64')}`,
    `data:image/png;base64,${Buffer.from('person').toString('base64')}`,
  ])
  await assert.rejects(referenceImageData(e.home, project, [{ ...images[0], sourceVideoFile: 'S02-y.mp4' }]), { status: 409 })
  await assert.rejects(referenceImageData(e.home, project, [{ ...images[0], sourceVideoFile: '../x.mp4' }]), /视频文件无效/)
})

test('reference format rejects missing sections, unbound subjects and missing pictures', () => {
  const text = 'subject_definitions: <Subject 1> from <Picture 1>.\nsummary: Walk.\nretention_analysis: Preserve.\ndetailed_description: <Subject 1> walks.\noverall_soundscape: Wind.\nnon_diegetic_music: None.'
  assert.deepEqual(h3PromptFailures(text, [{}]), [])
  assert.ok(h3PromptFailures(text.replace('detailed_description: <Subject 1>', 'detailed_description: <Subject 2>'), [{}]).some(s => s.includes('未定义')))
  assert.ok(h3PromptFailures(text, [{}, {}]).some(s => s.includes('编号')))
  assert.ok(h3PromptFailures('integrated_multimodal_description: Walk.\noverall_soundscape: Wind.\nnon_diegetic_music: None.', [{}]).length)
})
