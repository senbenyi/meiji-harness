import test from 'node:test'
import assert from 'node:assert/strict'
import { startPanelOperation } from '../server/http/panel-operation-start.js'

function fixture({ restoreError, jobError } = {}) {
  const count = { start: 0, jobs: 0, resolve: 0, warns: [] }
  const ctx = { sessions: { get: () => ({ id: 's' }) }, logger: { warn: text => count.warns.push(text) }, sessionController: { resolveAgent: async () => { count.resolve++; if (restoreError) throw new Error('恢复失败'); return { agent: {} } } } }
  const manager = { start() { count.start++; return { id: 'operation', ready: Promise.resolve() } } }
  const jobs = { async start() { count.jobs++; if (jobError) throw jobError; count.start++; return { operationId: 'operation', jobId: 'meiji-1' } } }
  return { count, ctx, manager, jobs, operation: { action: 'summary', origin: 'panel', sessionId: 's' } }
}

test('面板恢复会话后登记 job，只启动一次', async () => {
  const e = fixture(), result = await startPanelOperation(e)
  assert.equal(result.jobId, 'meiji-1'); assert.equal(e.count.start, 1); assert.equal(e.count.resolve, 1)
})
test('恢复或登记失败警告后仍生成，业务拒绝不重启', async () => {
  for (const options of [{ restoreError: true }, { jobError: Object.assign(new Error('登记失败'), { code: 'JOBS_UNAVAILABLE' }) }]) {
    const e = fixture(options), result = await startPanelOperation(e)
    assert.equal(result.jobId, undefined); assert.equal(e.count.start, 1); assert.equal(e.count.warns.length, 1)
  }
  const e = fixture({ jobError: Object.assign(new Error('剧本未处理'), { code: 'SCRIPT_PENDING' }) })
  await assert.rejects(startPanelOperation(e), { code: 'SCRIPT_PENDING' }); assert.equal(e.count.start, 0)
})
test('摘要草稿和面板回写不登记 job', async () => {
  for (const operation of [{ action: 'summary', draft: true }, { action: 'script-sync' }]) {
    const e = fixture(); e.operation = { ...e.operation, ...operation }
    await startPanelOperation(e)
    assert.equal(e.count.start, 1); assert.equal(e.count.jobs, 0); assert.equal(e.count.resolve, 0)
  }
})
