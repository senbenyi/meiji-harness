import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, readdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { setupModel } from './fixtures/model.js'
import { resetRuntimeData } from '../scripts/reset-runtime-data.js'

test('清空项目、历史、候选及上传文件，保留素材库和系统配置', async t => {
  const e = await setupModel(t), root = join(e.home, 'storages', 'meiji')
  for (const name of ['assets/characters/library', 'image-drafts/draft', 'incoming/upload', 'session-projects']) {
    await mkdir(join(root, name), { recursive: true }); await writeFile(join(root, name, 'test'), '原内容')
  }
  await writeFile(join(root, 'models.json'), '{"config":"keep"}')
  await writeFile(join(root, 'workspace-links.json'), JSON.stringify({ workspaces: { old: e.id } }))
  const result = await resetRuntimeData(e.home)
  assert.equal(result.projects, 1); assert.deepEqual(await readdir(join(root, 'projects')), [])
  assert.equal(await readFile(join(root, 'assets/characters/library/test'), 'utf8'), '原内容')
  assert.equal(await readFile(join(root, 'models.json'), 'utf8'), '{"config":"keep"}')
  assert.deepEqual(JSON.parse(await readFile(join(root, 'workspace-links.json'), 'utf8')).workspaces, {})
  for (const name of ['image-drafts', 'incoming', 'session-projects']) await assert.rejects(access(join(root, name)), { code: 'ENOENT' })
  assert.equal((await resetRuntimeData(e.home)).projects, 0)
})
