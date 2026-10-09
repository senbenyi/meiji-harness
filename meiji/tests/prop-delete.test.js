import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel, episodeFixture } from './fixtures/model.js'
import { cardModel } from '../server/models/data/drama-model.js'
import { scopeProjects } from '../server/data/episode-data.js'
import { runOperation, latestRun } from './fixtures/operation.js'
import { historyStore } from '../server/data/history-store.js'
import { validateOperation } from '../server/flow/operations/operation-registry.js'

const prop = (id, name) => cardModel({ id, type: 'prop', name, category: 'prop', description: name, evidence: `旅人拿起${name}`, ownerId: 'C01' })

test('prop deletion only removes the selected card and its pending images in the selected episode', async t => {
  const e = await setupModel(t), second = episodeFixture()
  second.plot.props.items = [prop('P01', '另一集的旧信')]
  await e.store.save(e.id, p => ({ episodes: [...p.episodes, second] }))
  await scopeProjects(e.store, e.episodeId).save(e.id, p => ({
    plot: { ...p.plot, props: { ...p.plot.props, items: [prop('P01', '旧信'), prop('P02', '铁箱')] } },
    pendingImages: { deleted: { itemId: 'P01' }, kept: { itemId: 'P02' } },
  }))
  const before = await e.read(), otherEpisode = (await e.store.read(e.id)).episodes[1]
  await runOperation(e.op('prop-delete', { itemId: 'P01' }), { home: e.home, operationId: 'prop-delete-task' })
  const after = await e.read()
  assert.deepEqual(after.plot.props.items, [before.plot.props.items[1]])
  assert.equal(after.plot.props.revision, before.plot.props.revision + 1)
  assert.deepEqual(after.pendingImages, { kept: before.pendingImages.kept })
  for (const key of ['outline', 'characters', 'scenes']) assert.deepEqual(after.plot[key], before.plot[key])
  assert.deepEqual(after.shots, before.shots)
  assert.deepEqual(after.assembly, before.assembly)
  assert.deepEqual((await e.store.read(e.id)).episodes[1], otherEpisode)
  // 即时保存不建立制作任务，只在项目事件留痕。
  assert.equal(await latestRun(e.home, e.id), null)
  assert.deepEqual((await historyStore(e.home, e.id).list('events')).map(event => [event.type, event.actor, event.target, event.episodeId]), [['prop-delete', 'human', 'P01', e.episodeId]])
})

test('the last prop can be deleted while existing group review is preserved', async t => {
  const e = await setupModel(t)
  await scopeProjects(e.store, e.episodeId).save(e.id, p => ({ plot: { ...p.plot, props: { ...p.plot.props, items: [prop('P01', '旧信')] } } }))
  await runOperation(e.op('prop-delete', { itemId: 'P01' }), { home: e.home })
  const group = (await e.read()).plot.props
  assert.deepEqual(group.items, [])
  assert.equal(group.check.passed, true)
  assert.equal(group.check.revision, group.revision)
})

test('missing prop and non-prop IDs are rejected without changing cards', async t => {
  const e = await setupModel(t), before = await e.read()
  for (const itemId of ['P99', 'C01', 'E01', undefined]) {
    await assert.rejects(runOperation(e.op('prop-delete', { itemId }), { home: e.home }), { status: 404, message: '道具不存在' })
  }
  const after = await e.read()
  assert.deepEqual(after.plot, before.plot)
  assert.deepEqual(after.shots, before.shots)
})

test('prop deletion is restricted to human panel operations', () => {
  assert.doesNotThrow(() => validateOperation({ action: 'prop-delete' }))
  assert.throws(() => validateOperation({ action: 'prop-delete', origin: 'session' }), { status: 403 })
})
