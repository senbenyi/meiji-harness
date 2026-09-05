import test from 'node:test'
import assert from 'node:assert/strict'
import { PUBLIC_STATES, describeState, progressOf, publicStateOf } from '../../src/domain/production-state.js'

const producerPlan = { source: 'producer-agent' }
const draftPlan = { source: 'auto-draft' }

test('内部状态到六状态的完整映射', () => {
  assert.equal(publicStateOf({ status: 'approved' }), 'completed')
  assert.equal(publicStateOf({ status: 'awaiting_review' }), 'awaiting_review')
  assert.equal(publicStateOf({ status: 'running' }), 'producing')
  assert.equal(publicStateOf({ status: 'ready', authorizedAt: null }), 'awaiting_authorization')
  assert.equal(publicStateOf({ status: 'ready', authorizedAt: '2026-09-05T00:00:00Z' }), 'queued')
  assert.equal(publicStateOf({ status: 'draft' }, draftPlan), 'draft')
  assert.equal(publicStateOf({ status: 'draft' }, producerPlan), 'awaiting_authorization')
})

test('失败与暂停如实透出，不伪装成生产中', () => {
  assert.equal(publicStateOf({ status: 'needs_attention' }), 'needs_attention')
  // paused 是用户动作，不在六状态里，但显示成 producing 会骗人。
  assert.equal(publicStateOf({ status: 'paused' }), 'paused')
})

test('只有授权与终审两处允许打断用户', () => {
  const cases = [
    ['draft', { status: 'draft' }, draftPlan, null],
    ['awaiting_authorization', { status: 'ready', authorizedAt: null }, producerPlan, 'consent'],
    ['queued', { status: 'ready', authorizedAt: 'x' }, producerPlan, null],
    ['producing', { status: 'running' }, producerPlan, null],
    ['awaiting_review', { status: 'awaiting_review' }, producerPlan, 'review'],
    ['completed', { status: 'approved' }, producerPlan, null],
    ['needs_attention', { status: 'needs_attention' }, producerPlan, null],
    ['paused', { status: 'paused' }, producerPlan, null],
  ]
  for (const [expectedState, state, plan, expectedNeeds] of cases) {
    const described = describeState(state, plan, [])
    assert.equal(described.state, expectedState)
    assert.equal(described.needsUser, expectedNeeds, `${expectedState} 的打断策略不符`)
  }
})

test('未知状态回落到 draft 而不是抛错', () => {
  assert.equal(publicStateOf({ status: 'something-new' }), 'draft')
  assert.equal(publicStateOf(null), 'draft')
})

test('进度按任务完成度计算', () => {
  const tasks = [
    { status: 'succeeded' }, { status: 'succeeded' },
    { status: 'running' }, { status: 'needs_attention' }, { status: 'pending' },
  ]
  assert.deepEqual(progressOf(tasks), { total: 5, succeeded: 2, failed: 1, active: 1, ratio: 0.4 })
  assert.deepEqual(progressOf([]), { total: 0, succeeded: 0, failed: 0, active: 0, ratio: 0 })
})

test('describeState 输出界面需要的全部字段', () => {
  const described = describeState({ status: 'running', updatedAt: '2026-09-05T00:00:00Z' }, producerPlan, [{ status: 'succeeded' }])
  assert.equal(described.state, 'producing')
  assert.equal(described.label, '生产中')
  assert.equal(described.needsUser, null)
  assert.equal(described.progress.succeeded, 1)
  assert.equal(described.updatedAt, '2026-09-05T00:00:00Z')
})

test('六状态清单与上游一致', () => {
  assert.deepEqual(PUBLIC_STATES, [
    'draft', 'awaiting_authorization', 'queued', 'producing', 'awaiting_review', 'completed',
  ])
})
