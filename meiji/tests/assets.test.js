import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { assetStore } from '../server/data/library.js'
import { byteRange } from '../server/http/library-routes.js'

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
