import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeFixture } from './fixtures/model.js'
import { operationDeletes } from '../shared/operation-cascade.js'
import { confirmOperationDelete } from '../client/cascade-confirm.js'

test('摘要删除清单覆盖本集下游，取消或已有授权只处理一次', () => {
  const ep = episodeFixture(), project = { episodes: [ep] }
  const op = { action: 'summary', episodeId: ep.id }
  let calls = 0
  assert.equal(confirmOperationDelete(project, op, message => { calls++; assert.match(message, /镜头表/); return false }), false)
  assert.equal(calls, 1)
  assert.equal(confirmOperationDelete(project, { ...op, confirmDelete: true }, () => { throw new Error('重复确认') }), true)
  assert.deepEqual(operationDeletes(project, { ...op, draft: true }), [])
})

test('图片确认旁路删除引用媒体，不影响其他集或放弃动作', () => {
  const ep = episodeFixture(), other = episodeFixture()
  ep.pendingImages = { d: { itemId: 'C01' } }
  const p = { episodes: [ep, other] }, op = { action: 'confirm-image', episodeId: ep.id, draftId: 'd' }
  const list = operationDeletes(p, op)
  assert.ok(list.some(item => item.kind === 'storyboard'))
  assert.ok(list.every(item => item.episodeId === ep.id))
  assert.deepEqual(operationDeletes(p, { ...op, action: 'discard-image' }), [])
  assert.deepEqual(operationDeletes(p, { ...op, draftId: 'missing' }), [])
})

test('无内容或不改变生成输入时不弹确认', () => {
  const ep = episodeFixture()
  const p = { episodes: [ep] }
  assert.equal(confirmOperationDelete(p, { action: 'episode-edit', episodeId: ep.id, fields: { summary: ep.summary.content, durationSeconds: ep.durationSeconds } }, () => { throw new Error('无删除') }), true)
  ep.shots.items = []; ep.assembly.content = null
  assert.deepEqual(operationDeletes(p, { action: 'film', episodeId: ep.id }), [])
})


test('库身份字段修改的预览覆盖同条目所有变体关联集', () => {
  const first = episodeFixture(), second = episodeFixture()
  first.plot.characters.items[0].ref = { libraryId: 'R01', variantId: 'R01-V01' }
  second.plot.characters.items[0].ref = { libraryId: 'R01', variantId: 'R01-V02' }
  const project = { episodes: [first, second] }
  const identity = operationDeletes(project, { action: 'entry-edit', libraryKind: 'characters', libraryId: 'R01', variantId: 'R01-V01', fields: { name: '新名字' } })
  assert.deepEqual(new Set(identity.map(item => item.episodeId)), new Set([first.id, second.id]))
  confirmOperationDelete(project, { action: 'entry-edit', libraryKind: 'characters', libraryId: 'R01', variantId: 'R01-V01', fields: { name: '新名字' } }, message => { assert.match(message, /将同步到 2 集/); return true })
  const appearance = operationDeletes(project, { action: 'entry-edit', libraryKind: 'characters', libraryId: 'R01', variantId: 'R01-V01', fields: { age: '老年' } })
  assert.deepEqual(new Set(appearance.map(item => item.episodeId)), new Set([first.id]))
})
