// 职责：验证对象级修改、镜头身份迁移及旧整数组接口兼容性。
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig } from '../src/utils/config.js'
import { createProjectStore } from '../src/business/projects/store.js'
import { actsValue, anchorValue, validShotId } from '../src/business/projects/schema.js'

const shot = { role: 'lin', action: '走入画面', subtitle: '', mode: 't2va', job_id: null, status: 'pending', notes: '' }
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'elysium-object-'))
  try {
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      const store = createProjectStore()
      const project = await store.change('create', { title: '项目', director: '导演', profile: 'preview' })
      await store.change('update', { id: project.id, acts: [{ title: '第一幕', shots: [] }, { title: '第二幕', shots: [] }] })
      await run(store, project.id, root)
    })
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('object operations preserve other fields, register materials and rename linked roles', () => fixture(async (store, id) => {
  await store.changeAnchor(id, 'add', { role: 'lin', label: '林', description: '白衣' })
  await store.changeAnchor(id, 'add', { role: 'room', label: '房间' })
  await store.changeShot(id, 'add', { act_index: 0, ...shot })
  await Promise.all([
    store.changeAnchor(id, 'update', { role: 'lin', new_role: 'xiaolin' }),
    store.changeAnchor(id, 'update', { role: 'room', description: '夜晚' }),
  ])
  let value = await store.read(id)
  assert.equal(value.anchors[0].description, '白衣')
  assert.equal(value.anchors[1].description, '夜晚')
  assert.equal(value.acts[0].shots[0].role, 'xiaolin')
  const shotId = value.acts[0].shots[0].id
  await store.changeShot(id, 'update', { id: shotId, subtitle: '你好', job_id: 'a'.repeat(32) })
  value = await store.read(id)
  assert.equal(value.acts[0].shots[0].action, shot.action)
  assert.equal(value.acts[0].shots[0].subtitle, '你好')
  assert.deepEqual(value.materials, ['a'.repeat(32)])
  await store.changeAnchor(id, 'delete', { role: 'room' })
  await store.changeShot(id, 'delete', { id: shotId })
  value = await store.read(id)
  assert.equal(value.anchors.length, 1)
  assert.equal(value.acts[0].shots.length, 0)
  assert.deepEqual(value.materials, ['a'.repeat(32)])
}))

test('shot IDs survive reordering, partial edits and reload, and moves stay within the act', () => fixture(async (store, id) => {
  await store.changeShot(id, 'add', { act_index: 0, ...shot })
  await store.changeShot(id, 'add', { act_index: 0, ...shot, action: '转身' })
  let value = await store.read(id)
  const [first, second] = value.acts[0].shots.map(shot => shot.id)
  assert.ok(validShotId(first)); assert.notEqual(first, second)
  value = await store.changeShot(id, 'move', { id: second, direction: -1 })
  assert.deepEqual(value.acts[0].shots.map(shot => [shot.id, shot.index]), [[second, 1], [first, 2]])
  await assert.rejects(store.changeShot(id, 'move', { id: second, direction: -1 }), /边界/)
  await store.changeShot(id, 'update', { id: first, notes: '保留身份' })
  assert.equal((await createProjectStore().read(id)).acts[0].shots[1].id, first)
}))

test('act operations let an empty project build and reorder a storyboard', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elysium-act-'))
  try {
    await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
      const store = createProjectStore()
      const project = await store.change('create', { title: '项目', director: '导演', profile: 'preview' })
      await store.changeAct(project.id, 'add', { title: '第一幕' })
      await store.changeAct(project.id, 'add', { title: '第二幕' })
      await store.changeShot(project.id, 'add', { act_index: 0, ...shot })
      await store.changeAct(project.id, 'update', { act_index: 1, title: '结尾' })
      const moved = await store.changeAct(project.id, 'move', { act_index: 1, direction: -1 })
      assert.deepEqual(moved.acts.map(act => act.title), ['结尾', '第一幕'])
      assert.equal(moved.acts[1].shots.length, 1)
      await assert.rejects(store.changeAct(project.id, 'move', { act_index: 0, direction: -1 }), /边界/)
      await store.changeAct(project.id, 'delete', { act_index: 0 })
      assert.deepEqual((await store.read(project.id)).acts.map(act => act.title), ['第一幕'])
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('missing IDs migrate once for split and monolithic projects; legacy update remains usable', () => fixture(async (store, id, root) => {
  const directory = join(root, 'projects', id)
  const legacyActs = [{ title: '旧幕', shots: [{ index: 1, ...shot }] }]
  await writeFile(join(directory, 'storyboard.json'), JSON.stringify(legacyActs))
  let value = await store.read(id)
  const first = value.acts[0].shots[0].id
  assert.ok(validShotId(first))
  assert.equal((await store.read(id)).acts[0].shots[0].id, first)
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'storyboard.json'), 'utf8')), value.acts)
  value = await store.change('update', { id, title: '新标题', acts: value.acts })
  assert.equal(value.acts[0].shots[0].id, first)
  await writeFile(join(directory, 'project.json'), JSON.stringify({ ...value, acts: legacyActs }))
  value = await createProjectStore().read(id)
  assert.ok(validShotId(value.acts[0].shots[0].id))
  value = await store.change('update', { id, acts: legacyActs })
  assert.ok(validShotId(value.acts[0].shots[0].id))
  assert.equal((await store.read(id)).acts[0].shots[0].id, value.acts[0].shots[0].id)
}))

test('invalid object changes fail without altering the project', () => fixture(async (store, id) => {
  await store.changeAnchor(id, 'add', { role: 'lin' })
  await store.changeAnchor(id, 'add', { role: 'room' })
  const before = await store.read(id)
  for (const run of [
    () => store.changeAnchor(id, 'add', { role: 'lin' }),
    () => store.changeAnchor(id, 'update', { role: 'lin', new_role: 'room' }),
    () => store.changeAnchor(id, 'update', { role: 'lin', image_url: 'file:///tmp/a.png' }),
    () => store.changeAnchor(id, 'delete', { role: 'missing' }),
    () => store.changeShot(id, 'add', { act_index: 9 }),
    () => store.changeShot(id, 'update', { id: 'missing' }),
    () => store.changeShot(id, 'move', { id: '../bad', direction: 2 }),
    () => store.read('../bad'),
  ]) await assert.rejects(run)
  assert.deepEqual(await store.read(id), before)
  assert.throws(() => actsValue([{ title: '', shots: [{ ...shot, id: 'same' }, { ...shot, id: 'same' }] }]), /重复/)
  assert.throws(() => anchorValue(before.anchors[0], new Set(['lin'])), /重复/)
}))

test('successful writes advance poll markers even within one millisecond and survive restart', t => fixture(async (store, id) => {
  const previous = await store.lastModified(id)
  t.mock.method(Date, 'now', () => previous)
  const updated = await store.change('update', { id, title: '更新' })
  assert.equal(updated.updated_at, previous + 1)
  const anchor = await store.changeAnchor(id, 'add', { role: 'lin' })
  assert.equal(anchor.updated_at, previous + 2)
  const shot = await store.changeShot(id, 'add', { act_index: 0 })
  assert.equal(shot.updated_at, previous + 3)
  assert.equal(await store.lastModified(id), shot.updated_at)
  assert.equal(await createProjectStore().lastModified(id), shot.updated_at)
  await assert.rejects(store.changeShot(id, 'delete', { id: 'missing' }))
  assert.equal(await store.lastModified(id), shot.updated_at)
  await store.change('delete', { id })
  await assert.rejects(store.lastModified(id), { code: 'ENOENT' })
}))
