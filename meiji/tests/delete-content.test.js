import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { setupModel, episodeFixture } from './fixtures/model.js'
import { runOperation } from './fixtures/operation.js'

async function file(path) {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, 'test')
  return path
}

test('episode deletion removes only selected episode data and local videos', async t => {
  const e = await setupModel(t), other = episodeFixture()
  await e.store.save(e.id, current => ({ episodes: [...current.episodes, other] }))
  const root = join(e.home, 'storages', 'meiji', 'projects', e.id)
  const clip = await file(join(root, 'films', e.episodeId, 'S01.mp4'))
  const assembly = await file(join(root, 'films', e.episodeId, 'assembly.mp4'))
  const kept = await file(join(root, 'films', other.id, 'S01.mp4'))
  const image = await file(join(root, 'images', e.episodeId, 'C01.png'))
  await runOperation(e.op('episode-delete'), { home: e.home })
  assert.deepEqual((await e.store.read(e.id)).episodes.map(item => item.id), [other.id])
  for (const path of [clip, assembly]) await assert.rejects(access(path), { code: 'ENOENT' })
  await access(kept)
  await assert.rejects(access(image), { code: 'ENOENT' })
})

test('project deletion removes all owned files while retaining other projects', async t => {
  const e = await setupModel(t)
  const other = await e.store.create({ mode: 'free', premise: '人的创作方向', title: '保留项目', summary: '保留内容' })
  const root = join(e.home, 'storages', 'meiji', 'projects')
  const clip = await file(join(root, e.id, 'films', e.episodeId, 'S01.mp4'))
  const image = await file(join(root, e.id, 'images', e.episodeId, 'C01.png'))
  await runOperation({ action: 'project-delete', projectId: e.id }, { home: e.home })
  await assert.rejects(e.store.read(e.id), { status: 404 })
  await assert.rejects(access(clip), { code: 'ENOENT' })
  await assert.rejects(access(image), { code: 'ENOENT' })
  assert.equal((await e.store.read(other.id)).title, '保留项目')
})

test('missing episode does not delete project data or videos', async t => {
  const e = await setupModel(t)
  await assert.rejects(runOperation(e.op('episode-delete', { episodeId: '../films' }), { home: e.home }), { status: 404 })
  assert.equal((await e.store.read(e.id)).episodes.length, 1)
})

test('删除项目同步删除对应工作区和选择记录，保留其他关联与旧会话数据', async t => {
  const e = await setupModel(t), { linkStore } = await import('../server/data/workspace-links.js')
  const other = await e.store.create({ title: '其他', premise: '另一故事' })
  const links = linkStore(e.home), selected = 'session-11111111-1111-4111-8111-111111111111', kept = 'session-22222222-2222-4222-8222-222222222222'
  await e.store.save(e.id, { workspaceId: 'project-workspace' })
  await links.selectProject(selected, e.id, e.store); await links.selectProject(kept, other.id, e.store)
  const oldSession = await file(join(e.home, 'sessions', selected, 'events.jsonl'))
  const deleted = []
  await runOperation({ action: 'project-delete', projectId: e.id }, { home: e.home, workspaceController: { async delete(input) { deleted.push(input) } } })
  assert.deepEqual(deleted, [{ workspaceId: 'project-workspace' }])
  await assert.rejects(access(join(e.home, 'storages', 'meiji', 'session-projects', selected + '.json')), { code: 'ENOENT' })
  assert.equal((await links.projectForSession(kept)).projectId, other.id)
  await access(oldSession)
})

test('工作区删除失败保留项目和关联；工作区已不存在时仍可删除项目', async t => {
  const e = await setupModel(t), { linkStore } = await import('../server/data/workspace-links.js')
  const selected = 'session-11111111-1111-4111-8111-111111111111', links = linkStore(e.home)
  await e.store.save(e.id, { workspaceId: 'project-workspace' }); await links.selectProject(selected, e.id, e.store)
  const op = { action: 'project-delete', projectId: e.id }
  await assert.rejects(runOperation(op, { home: e.home, workspaceController: { async delete() { throw new Error('删除工作区失败') } } }), /删除工作区失败/)
  assert.equal((await e.store.read(e.id)).id, e.id)
  assert.equal((await links.projectForSession(selected)).projectId, e.id)
  await runOperation(op, { home: e.home, workspaceController: { async delete() { throw Object.assign(new Error('不存在'), { code: 'workspace/not-found' }) } } })
  await assert.rejects(e.store.read(e.id), { status: 404 })
})
