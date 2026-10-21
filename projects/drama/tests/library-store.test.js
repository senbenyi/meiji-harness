import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLibraryStore } from '../src/library/library_store.js'

test('剧本素材跨重启读取，列表不泄露正文，拒绝空文件、非文本和目录穿越', async t => {
  const root = await mkdtemp(join(tmpdir(), 'drama-library-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createLibraryStore(root)
  assert.deepEqual(await store.list(), [])
  const asset = await store.importScript({ originalName: '剧本.md', body: '# 开场\n甲：你好。' })
  const restarted = createLibraryStore(root)
  assert.deepEqual(await restarted.list(), [asset])
  assert.equal(await restarted.readScript(asset.id), '# 开场\n甲：你好。')
  assert.equal('body' in asset, false)
  for (const originalName of ['../x.txt', 'x.exe', 'a\\b.txt'])
    await assert.rejects(store.importScript({ originalName, body: 'x' }), /文件/)
  await assert.rejects(store.importScript({ originalName: 'x.txt', body: '  ' }), /不能为空/)
  await assert.rejects(store.importScript({ originalName: 'x.txt', body: '剧'.repeat(400000) }), /1MB/)
  await assert.rejects(store.readScript('../bindings.json'), /素材ID/)
  assert.equal((await store.list()).length, 1)
})
