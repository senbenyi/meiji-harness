import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { assetStore } from '../server/data/asset-library-store.js'
import { byteRange } from '../server/http/asset-library-routes.js'

async function fixture(run) {
  const home = await mkdtemp(join(tmpdir(), 'meiji-assets-'))
  try { await run(assetStore(home), home) } finally { await rm(home, { recursive: true }) }
}
const stream = value => Readable.from([Buffer.from(value)])

test('same-name imports preserve separate files and survive a new store instance', () => fixture(async (store, home) => {
  const [a, b] = await Promise.all([store.import('characters', '角色.png', stream('first')), store.import('characters', '角色.png', stream('second'))])
  assert.notEqual(a.id, b.id)
  assert.equal((await assetStore(home).list('characters')).length, 2)
  assert.deepEqual(await store.list('scenes'), [])
  assert.equal(await readFile((await store.file('characters', a.id)).path, 'utf8'), 'first')
  assert.equal(a.originalName, '角色.png')
  assert.equal(a.size, 5)
}))
test('invalid categories, paths, active formats, and mismatched media are rejected', () => fixture(async store => {
  await assert.rejects(store.import('../outside', 'x.png', stream('a')))
  await assert.rejects(store.file('characters', '../outside'))
  await assert.rejects(store.import('characters', 'x.svg', stream('<svg/>')))
  await assert.rejects(store.import('audio', 'x.png', stream('a')))
  await assert.rejects(store.import('video', 'x.html', stream('a')))
  const asset = await store.import('props', '../../name.png', stream('a'))
  assert.equal(asset.originalName, 'name.png')
  assert.equal(asset.file, 'original.png')
}))
test('oversize, empty and interrupted uploads leave no published or temporary assets', () => fixture(async (store, home) => {
  await assert.rejects(store.import('video', 'clip.mp4', stream('too large'), 2), { status: 413 })
  await assert.rejects(store.import('video', 'empty.mp4', stream('')), { status: 400 })
  const interrupted = Readable.from((async function* () { yield Buffer.from('part'); throw new Error('disconnected') })())
  await assert.rejects(store.import('video', 'broken.mp4', interrupted))
  assert.deepEqual(await store.list('video'), [])
  assert.deepEqual(await readdir(join(home, 'storages/meiji/assets/video')), [])
}))
test('audio/video byte ranges support seeking and reject invalid requests', () => {
  assert.deepEqual(byteRange('bytes=2-5', 10), { start: 2, end: 5, partial: true })
  assert.deepEqual(byteRange('bytes=-3', 10), { start: 7, end: 9, partial: true })
  assert.deepEqual(byteRange('bytes=8-', 10), { start: 8, end: 9, partial: true })
  for (const value of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=0-1,3-4', 'bad']) assert.equal(byteRange(value, 10), null)
})

test('七类素材移出列表后持久化，原文件与剧本仍可通过原 ID 读取', () => fixture(async (store, home) => {
  for (const [category, suffix] of [['characters', 'png'], ['scenes', 'png'], ['props', 'png'], ['audio', 'mp3'], ['video', 'mp4'], ['guidance', 'md'], ['scripts', 'txt']]) {
    const asset = await store.import(category, `素材.${suffix}`, stream('原始内容'))
    const other = await store.import(category, `保留.${suffix}`, stream('其他内容'))
    await store.remove(category, asset.id)
    const reopened = assetStore(home)
    assert.deepEqual((await reopened.list(category)).map(row => row.id), [other.id])
    const file = await reopened.file(category, asset.id)
    assert.ok(file.metadata.removedAt)
    assert.equal(await readFile(file.path, 'utf8'), '原始内容')
    if (category === 'scripts') assert.equal((await reopened.script(asset.id)).content, '原始内容')
    await reopened.remove(category, asset.id)
    assert.equal((await reopened.file(category, asset.id)).metadata.removedAt, file.metadata.removedAt)
    assert.deepEqual((await readdir(join(home, 'storages/meiji/assets', category, asset.id))).sort(), ['metadata.json', `original.${suffix}`])
  }
  await assert.rejects(store.remove('../outside', 'id'), { status: 400 })
  await assert.rejects(store.remove('characters', '../outside'), { status: 400 })
  await assert.rejects(store.remove('characters', '00000000-0000-4000-8000-000000000000'), { code: 'ENOENT' })
}))

test('guidance imports persist category, UTF-8 content and original files locally', () => fixture(async (store, home) => {
  const content = '\ufeff# 声音\n脚步声由远及近。\n'
  const asset = await store.import('guidance', '脚步.markdown', stream(content), undefined, { guidanceType: 'sound' })
  const loaded = (await assetStore(home).list('guidance'))[0]
  assert.equal(loaded.guidanceType, 'sound')
  assert.equal(loaded.content, '# 声音\n脚步声由远及近。')
  assert.equal(loaded.mime, 'text/plain; charset=utf-8')
  assert.equal(await readFile((await store.file('guidance', asset.id)).path, 'utf8'), content)
  assert.equal((await store.import('guidance', '其他.txt', stream('其他参考'))).guidanceType, 'other')
}))

test('guidance rejects invalid categories, encoding, blank, binary, oversized and nontext imports', () => fixture(async (store, home) => {
  await assert.rejects(store.import('guidance', 'a.txt', stream('a'), undefined, { guidanceType: 'unknown' }), { status: 400 })
  for (const content of ['   \n', 'a\0b', '字'.repeat(20001), Buffer.from([0xff, 0xfe])]) {
    await assert.rejects(store.import('guidance', 'a.txt', stream(content)), { status: 400 })
  }
  await assert.rejects(store.import('guidance', 'a.txt', stream('a'.repeat(128 * 1024 + 1))), { status: 413 })
  await assert.rejects(store.import('guidance', 'a.html', stream('<script>x</script>')), { status: 400 })
  await assert.rejects(store.import('audio', 'a.txt', stream('sound')), { status: 400 })
  assert.deepEqual(await readdir(join(home, 'storages/meiji/assets/guidance')), [])
}))
