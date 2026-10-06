import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarnessRunGoals } from '../server/host/harness-run-goals.js'
function setup() {
  const agent = {}, records = new Map(), calls = []; let current
  const goals = { get: () => current, create: (_, fields) => current = { id: 'goal', revision: 1, phase: 'active', ...fields }, disarm: () => calls.push('disarm'), complete: () => { current = { ...current, revision: current.revision + 1, phase: 'complete' }; calls.push('complete') }, block: (_, ref, reason) => { current = { ...current, revision: current.revision + 1, phase: 'blocked', blockedReason: reason }; calls.push('block') }, clear: () => current = null }
  const run = { id: 'run', projectId: 'project', goal: { to: 'film' }, status: 'draft' }
  records.set(run.id, run)
  const adapter = createHarnessRunGoals({ goals, resolveAgent: async () => ({ agent }), readBinding: async (_, id) => records.get(id), saveBinding: async (_, id, value) => records.set(id, { ...records.get(id), ...value }) })
  return { run, records, calls, adapter, current: () => current, change: value => current = value }
}
test('会话目标绑定 Run，暂停保持进行中；完成才结算，同目标修改不覆盖', async () => {
  const e = setup(); await e.adapter.attach(e.run, 'session')
  assert.equal(e.records.get('run').goalRef.id, 'goal'); assert.match(e.current().objective, /run/)
  e.adapter.observe({ ...e.run, status: 'paused' }); await e.adapter.drain()
  assert.equal(e.current().phase, 'active'); assert.deepEqual(e.calls, ['disarm'])
  await e.adapter.attach(e.run, 'session')
  e.adapter.observe({ ...e.run, status: 'completed' }); await e.adapter.drain()
  assert.equal(e.current().phase, 'complete'); assert.equal(e.calls.at(-1), 'complete')
})
test('取消结算为阻断；人工修改目标和其他目标不会被覆盖或完成', async () => {
  const e = setup(); e.change({ id: 'other', revision: 1, phase: 'active' })
  await assert.rejects(e.adapter.attach(e.run, 'session'), { code: 'GOAL_ALREADY_EXISTS' })
  e.change(null); await e.adapter.attach(e.run, 'session')
  e.change({ ...e.current(), revision: 2, objective: '人工调整' })
  e.adapter.observe({ ...e.run, status: 'completed' }); await e.adapter.drain()
  assert.equal(e.current().phase, 'active')
  e.change({ ...e.current(), revision: 1 })
  e.adapter.observe({ ...e.run, status: 'cancelled' }); await e.adapter.drain()
  assert.equal(e.current().blockedReason.code, 'meiji-run-cancelled')
})
test('没有会话绑定的面板任务不创建或结算 Harness 目标', async () => {
  const e = setup(); e.adapter.observe({ ...e.run, status: 'completed' }); await e.adapter.drain()
  assert.equal(e.current(), undefined); assert.deepEqual(e.calls, [])
})
