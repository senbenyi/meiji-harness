// 职责：验证素材分类、独立文字记录、旧索引迁移及导演归档契约。
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { withConfig } from '../src/config.js'
import { createMediaHandler } from '../src/server/routes/media.js'
import { createDirectorStore } from '../src/database/managers/directors.js'
import { syncMaterials, addMaterial } from '../src/database/managers/materials.js'
import { listAssets } from '../src/server/media/catalog.js'
import { libraryMaterials, generateSlugs } from '../resources/library-catalog.mjs'

test('categorized text CRUD requires authentication and never creates fake jobs; tombstones survive discovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-category-'))
  const handler = createMediaHandler({ token: 't' })
  const server = createServer((req, res) => withConfig({ ELYSIUM_STATE_ROOT: root }, () => handler(req, res)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/plugins/dsh-elysium/media`
  const post = (action, value, token = 't') => fetch(`${base}/${action}?t=${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
  try {
    const data = { category: 'theme', title: '青梅重逢', description: '成年后回乡，在公交站相遇' }
    assert.equal((await post('create', data, 'bad')).status, 401)
    assert.equal((await post('create', { ...data, category: 'invalid' })).status, 400)
    const response = await post('create', data)
    assert.equal(response.status, 201)
    const material = await response.json()
    assert.match(material.id, /^[a-f0-9]{32}$/); assert.equal(material.job_id, undefined)
    let listed = await (await fetch(`${base}/list?t=t&category=theme&q=${encodeURIComponent('公交站')}`)).json()
    assert.equal(listed.total, 1); assert.equal(listed.items[0].media_kind, 'text'); assert.equal(listed.items[0].has_image, false)
    assert.equal((await (await fetch(`${base}/list?t=t&category=scene`)).json()).total, 0)
    assert.equal((await fetch(`${base}/list?t=t&category=invalid`)).status, 400)
    assert.equal((await post('update', { ...material, category: 'scene', title: '乡村公交站' })).status, 200)
    assert.equal((await (await fetch(`${base}/list?t=t&category=scene`)).json()).total, 1)
    assert.equal((await fetch(`${base}/delete?t=t&id=${material.id}`, { method: 'POST' })).status, 200)
    assert.equal((await (await fetch(`${base}/list?t=t`)).json()).total, 0)
    assert.equal((await post('update', material)).status, 404)
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      const legacy = { job_id: 'a'.repeat(32), project_id: 'b'.repeat(8), source: 'creation', deleted: true }
      await writeFile(join(root, 'pools', 'materials.json'), JSON.stringify({ version: 1, materials: [legacy] }))
      assert.equal((await syncMaterials([{ ...legacy, deleted: false }]))[0].deleted, true)
      const text = await addMaterial({ ...data, source: 'creation' })
      const index = JSON.parse(await readFile(join(root, 'pools', 'materials.json'), 'utf8'))
      assert.equal(index.version, 2); assert.equal(index.materials[0].deleted, true)
      assert.equal((await listAssets(0, 10)).items[0].id, text.id)
    })
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})

test('archived directors remain resolvable for historical projects but are omitted from the active list and reorder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-director-archive-'))
  try { await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    await mkdir(join(root, 'pools'), { recursive: true })
    await writeFile(join(root, 'pools', 'directors.json'), JSON.stringify([
      { name: '旧导演', style: '旧风格', works: [], archived: true },
      { name: '新导演', style: '自然光', works: ['示例作品'], sources: ['https://example.org/film'] },
    ]))
    const store = createDirectorStore()
    assert.equal(await store.has('旧导演'), true)
    assert.deepEqual((await store.list()).map(item => item.name), ['新导演'])
    await store.reorder(['新导演'])
    await store.update({ name: '新导演', style: '柔光', works: ['示例作品'] })
    assert.equal((await store.list())[0].sources[0], 'https://example.org/film')
    assert.equal(await store.has('旧导演'), true)
  }) } finally { await rm(root, { recursive: true, force: true }) }
})

test('music and video categories persist; three views collapse into one set with tags', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-library-schema-'))
  try { await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const music = await addMaterial({ category: 'music', title: '片尾曲', source: 'creation' })
    const video = await addMaterial({ category: 'video', title: '预告片', source: 'creation' })
    assert.equal(music.category, 'music'); assert.equal(video.category, 'video')
    const set_id = 'c'.repeat(32)
    for (const [view, id] of [['front', '1'], ['side', '2'], ['back', '3']]) {
      await addMaterial({ id: id.repeat(32), set_id, view, category: 'character', subcategory: '热门漫剧', title: '陆沉', tags: ['霸总', '禁欲系'], prompt: 'nude adult base', source: 'creation' })
    }
    const listed = await listAssets(0, 20, { category: 'character', subcategory: '热门漫剧' })
    assert.equal(listed.total, 1)
    assert.equal(listed.items[0].views.length, 3)
    assert.deepEqual(listed.items[0].views.map(item => item.view), ['front', 'side', 'back'])
    assert.deepEqual(listed.items[0].tags, ['霸总', '禁欲系'])
    assert.equal((await listAssets(0, 20, { category: 'music' })).items[0].title, '片尾曲')
  }) } finally { await rm(root, { recursive: true, force: true }) }
})

test('library catalog uses nude adult bases and uncolored animals across three views', () => {
  assert.equal(libraryMaterials.length, 126)
  assert.equal(generateSlugs.length, 5)
  assert.equal(libraryMaterials.filter(item => generateSlugs.includes(item.slug)).length, 15)
  assert.equal(new Set(libraryMaterials.map(item => item.set_id)).size, 42)
  const people = libraryMaterials.filter(item => ['热门漫剧', '娱乐明星'].includes(item.subcategory))
  assert.equal(people.length, 18)
  for (const item of people) {
    assert.match(item.prompt, /nude/i)
    assert.match(item.prompt, /no clothing|no clothes/i)
    assert.doesNotMatch(item.prompt, /fully clothed|school jacket|hoodie|three-piece suit/i)
    assert.match(item.description, /裸体底模/)
  }
  const animals = libraryMaterials.filter(item => item.subcategory === '动物')
  assert.equal(animals.length, 9)
  for (const item of animals) {
    assert.match(item.prompt, /no fur color/)
    assert.doesNotMatch(item.prompt, /golden shaded|cream-gold|black and white border collie|arctic fox|white fur/i)
    assert.match(item.description, /无皮毛颜色/)
  }
})
