import test from 'node:test'
import assert from 'node:assert/strict'
import { cascade, cascadePreview } from '../shared/pipeline-cascade.js'
import { node, setContent } from '../shared/drama-model.js'
import { episodeFixture, setupModel } from './fixtures/model.js'
import { scopeProjects } from '../server/data/episode-data.js'

function fixture() {
  const p = episodeFixture()
  p.shots.items.push(structuredClone(p.shots.items[1]))
  p.shots.items[2].id = 'S03'
  for (const [i, shot] of p.shots.items.entries()) {
    shot.content = i === 0 ? '旅人【旅人|C01】进入庭院【庭院|E01】' : '环境'
    if (i > 0) { shot.seconds.content.beats[0].action = '风吹树叶'; shot.seconds.content.beats[0].space = '室外' }
    for (const kind of ['video', 'tailFrame']) setContent(shot[kind], { file: `${i}.mp4`, localPath: '/tail.png' }, { passed: true, failures: [] })
    if (i === 1) shot.storyboard.content.tailReference = { sourceShotId: 'S01' }
  }
  setContent(p.assembly, { file: 'all.mp4' }, { passed: true, failures: [] })
  p.pendingImages = { card: { itemId: 'C01' }, shot: { track: 'S01' } }
  return p
}
for (const rule of [1, 2, 3]) test(`R${rule}: removes the complete downstream and preserves input`, () => {
  const p = fixture(), before = structuredClone(p)
  const { patch } = cascade(p, { type: `R${rule}`, key: 'characters' })
  assert.equal(patch.shots.items.length, 0)
  assert.equal(patch.assembly.content, null)
  assert.equal(patch.plot.props.items.length, 0)
  if (rule < 3) assert.equal(patch.plot.characters.items.length, 0)
  assert.deepEqual(p, before)
})
for (const rule of [4, 5, 6]) test(`R${rule}: only referenced shots and tail chain lose media`, () => {
  const { patch } = cascade(fixture(), { type: `R${rule}`, itemId: 'C01' })
  assert.equal(patch.shots.items[0].storyboard.content, null)
  assert.equal(patch.shots.items[1].video.content, null)
  assert.ok(patch.shots.items[2].video.content)
  assert.ok(patch.shots.items.every(shot => shot.seconds.content))
})
test('R7: referenced deletion removes table; unreferenced deletion only removes candidate', () => {
  assert.equal(cascade(fixture(), { type: 'R7', itemId: 'C01' }).patch.shots.items.length, 0)
  const p = fixture(); p.pendingImages.prop = { itemId: 'P99' }
  const result = cascade(p, { type: 'R7', itemId: 'P99' }).patch
  assert.equal(result.shots.items.length, 3); assert.equal(result.pendingImages.prop, undefined)
})
test('R8/R9: whole table clears all seconds; single shot clears from its position', () => {
  assert.ok(cascade(fixture(), { type: 'R8' }).patch.shots.items.every(shot => shot.seconds.content === null))
  const p = cascade(fixture(), { type: 'R9', track: 'S02' }).patch
  assert.ok(p.shots.items[0].seconds.content); assert.equal(p.shots.items[1].seconds.content, null)
  assert.equal(p.shots.items[2].video.content, null)
})
test('R10: retains current seconds, clears later seconds and current/later media', () => {
  const p = cascade(fixture(), { type: 'R10', track: 'S02' }).patch
  assert.ok(p.shots.items[1].seconds.content); assert.equal(p.shots.items[2].seconds.content, null)
  assert.equal(p.shots.items[1].video.content, null); assert.ok(p.shots.items[0].video.content)
})
for (const rule of [11, 12]) test(`R${rule}: follows tail chain until independent shot`, () => {
  const p = cascade(fixture(), { type: `R${rule}`, track: 'S01' }).patch
  assert.equal(p.shots.items[1].storyboard.content, null); assert.ok(p.shots.items[2].video.content)
  assert.ok(p.shots.items[0].storyboard.content)
  assert.equal(Boolean(p.shots.items[0].video.content), rule === 12)
})
test('R13: rules and reference changes preserve generated content', () => {
  const p = fixture(); assert.deepEqual(cascade(p, { type: 'R13' }).patch.shots, p.shots)
})
for (const rule of [14, 15]) test(`R${rule}: preserves cards/images/table/seconds and removes film`, () => {
  const p = fixture(), next = cascade(p, { type: `R${rule}` }).patch
  assert.deepEqual(next.plot, p.plot); assert.ok(next.shots.items.every(shot => shot.seconds.content))
  assert.ok(next.shots.items.every(shot => shot.storyboard.content === null))
})
test('R18: refuses executing episode and previews history deletion', () => {
  const p = fixture(); p.shots.items[1].video.operation = { id: 'running' }
  assert.throws(() => cascade(p, { type: 'R18' }), { status: 409 })
  assert.ok(cascadePreview(p, { type: 'R18' }).some(item => item.kind === 'episode'))
})
test('cascade save is atomic, rejects busy downstream, and isolates other episode', async t => {
  const e = await setupModel(t), other = episodeFixture()
  await e.store.save(e.id, current => ({ episodes: [...current.episodes, other] }))
  await e.store.save(e.id, current => { current.episodes[0].shots.items[0].video.operation = { id: 'running' }; return current })
  const before = await e.store.read(e.id)
  await assert.rejects(scopeProjects(e.store, e.episodeId).save(e.id, p => ({ summary: { ...p.summary, content: '新摘要' } })), { status: 409 })
  assert.deepEqual(await e.store.read(e.id), before)
  await e.store.save(e.id, current => { current.episodes[0].shots.items[0].video.operation = null; return current })
  await scopeProjects(e.store, e.episodeId).save(e.id, p => ({ summary: { ...p.summary, content: '新摘要' } }))
  const saved = await e.store.read(e.id)
  assert.equal(saved.episodes[0].plot.outline.content, null)
  assert.deepEqual(saved.episodes[1], before.episodes[1])
  assert.equal(Object.hasOwn(node('x'), 'stale'), false)
  assert.equal(Object.hasOwn(node('x'), 'dependencies'), false)
})

test('save rejects replacing busy downstream before cascade inspects the patch', async t => {
  const e = await setupModel(t)
  await e.store.save(e.id, current => {
    current.episodes[0].shots.items[0].video.operation = { id: 'running' }
    return current
  })
  const before = await e.store.read(e.id)
  await assert.rejects(e.store.save(e.id, current => {
    current.episodes[0].summary.content = '新摘要'
    current.episodes[0].shots = { ...node('shots'), items: [], seconds: node('seconds') }
    return current
  }), { status: 409 })
  assert.deepEqual(await e.store.read(e.id), before)
})

test('R3 clears candidates belonging to removed prop cards', () => {
  const p = fixture()
  p.plot.props.items = [{ ...node('P01'), image: node('image:P01') }]
  p.pendingImages.prop = { itemId: 'P01' }
  assert.equal(cascade(p, { type: 'cards', key: 'characters' }).patch.pendingImages.prop, undefined)
  assert.ok(cascade(p, { type: 'cards', key: 'characters' }).patch.pendingImages.card)
})

test('repeated deletion preserves already empty node revisions', () => {
  const once = { ...fixture(), ...cascade(fixture(), { type: 'R10', track: 'S01' }).patch }
  assert.deepEqual(cascade(once, { type: 'R10', track: 'S01' }).patch.shots, once.shots)
})
