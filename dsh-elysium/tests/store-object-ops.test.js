// 职责：验证锚点、镜头与自动生产状态的对象级修改、字段校验和轮询标记。
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig } from '../src/config.js'
import { createProjectStore } from '../src/database/managers/projects.js'
import { anchorValue, autoValue, shotValue } from '../src/server/projects/schema.js'
import { job, seedProject, shot } from './fixtures/drama.mjs'

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'elysium-object-'))
  try {
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      const store = createProjectStore()
      const project = await store.change('create', { title: '项目', director: '导演' })
      await seedProject(root, project.id)
      await run(store, project.id, root)
    })
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('object operations preserve other fields and register materials', () => fixture(async (store, id, root) => {
  let value = await store.changeAnchor(id, 'update', { role: 'lin', source: { type: 'material', job_id: job('d') } })
  assert.deepEqual(value.anchors[0], { role: 'lin', kind: 'character', label: '林', description: '灰外套；音色：低沉；性格：克制', image_prompt: 'adult Chinese man, grey coat', image_job_id: job('c'), source: { type: 'material', job_id: job('d') } })
  assert.deepEqual(value.materials, [job('d')])
  value = await store.changeShot(id, { id: 's2', episode: 1, job_id: job('e'), keyframe_job_id: job('a'), status: 'pending' })
  assert.deepEqual(value.acts[0].shots[1], shot('s2', { job_id: job('e'), keyframe_job_id: job('a') }))
  assert.deepEqual(value.acts[0].shots[0], shot('s1'))
  assert.deepEqual(JSON.parse(await readFile(join(root, 'projects', id, 'materials.json'), 'utf8')), [job('d'), job('e'), job('a')])
  await store.changeAnchor(id, 'delete', { role: 'scene-room' })
  assert.deepEqual((await store.read(id)).anchors.map(item => item.role), ['lin'])
}))

test('invalid object changes fail without altering the project', () => fixture(async (store, id) => {
  const before = await store.readEpisode(id, 1)
  await assert.rejects(store.changeAnchor(id, 'add', { role: 'lin', kind: 'character', label: '重复', description: '', image_prompt: 'x' }), /锚点已存在/)
  await assert.rejects(store.changeAnchor(id, 'update', { role: 'lin', image_prompt: '' }), /锚点字段无效/)
  await assert.rejects(store.changeAnchor(id, 'update', { role: 'scene-room', source: { type: 'job', job_id: job('a') } }), /锚点字段无效/)
  await assert.rejects(store.changeAnchor(id, 'move', { role: 'lin' }), /锚点操作无效/)
  await assert.rejects(store.changeShot(id, { id: 's1', episode: 1, job_id: '../bad' }), /镜字段无效/)
  await assert.rejects(store.changeShot(id, { id: 's1', episode: 1, duration: 16 }), /镜字段无效/)
  await assert.rejects(store.changeShot(id, { id: 's1', episode: 0 }), /项目或集数无效/)
  await assert.rejects(store.changeAuto(id, auto => ({ ...auto, until_episode: 101 })), /自动生产状态无效/)
  assert.deepEqual(await store.readEpisode(id, 1), before)
  assert.throws(() => anchorValue({ role: 'x', kind: 'material', label: 'x', description: '', source: null }), /锚点字段无效/)
  assert.deepEqual(Object.keys(shotValue({ ...shot('s1'), mode: 't2va', role: 'lin', accepted: true })), Object.keys(shot('s1')))
  assert.deepEqual(autoValue({}), { enabled: false, until_episode: null, anchors_confirmed: false, cascade_confirmed: false, paused: null, attempts: {} })
}))

test('successful writes advance poll markers even within one millisecond and survive restart', t => fixture(async (store, id) => {
  const previous = await store.lastModified(id)
  t.mock.method(Date, 'now', () => previous)
  const updated = await store.change('update', { id, title: '更新' })
  assert.equal(updated.updated_at, previous + 1)
  const anchor = await store.changeAnchor(id, 'update', { role: 'lin', label: '林二' })
  assert.equal(anchor.updated_at, previous + 2)
  const shotValue = await store.changeShot(id, { id: 's1', episode: 1, status: 'failed' })
  assert.equal(shotValue.updated_at, previous + 3)
  const auto = await store.changeAuto(id, value => ({ ...value, enabled: true }))
  assert.equal(auto.updated_at, previous + 4)
  assert.equal((await store.changeAuto(id, value => value)).updated_at, previous + 4)
  await store.appendPlanningVersion(id, 'series', undefined, undefined, { logline: '草稿' })
  assert.equal(await store.lastModified(id), previous + 5)
  assert.equal(await createProjectStore().lastModified(id), previous + 5)
  await assert.rejects(store.changeShot(id, { id: 'missing', episode: 1, status: 'failed' }))
  assert.equal(await store.lastModified(id), previous + 5)
  await store.change('delete', { id })
  await assert.rejects(store.lastModified(id), { code: 'ENOENT' })
}))
