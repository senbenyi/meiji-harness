import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { useWorkspaces } from './fixtures/host.js'
import { fakeJobs } from './fixtures/fake-jobs.js'
import { linkStore } from '../server/data/workspace-links.js'
import { createRunService } from '../server/flow/runs/run-service.js'
import { createHarnessRunJobs } from '../server/host/harness-run-jobs.js'
import { subscribeProject } from '../server/data/project-events.js'
import { runTools } from '../tools/run-tools.js'
import { contextQueryTool } from '../tools/operation-context-query.js'
const sessionId = 'session-11111111-1111-4111-8111-111111111111'
async function setup(t, execute = async () => ({ passed: true })) {
  const e = await setupModel(t); useWorkspaces(t); await linkStore(e.home).selectProject(sessionId, e.id, e.store)
  const runs = createRunService({ home: e.home, execute }), registry = fakeJobs(), runJobs = createHarnessRunJobs({ home: e.home, registry, readRun: (...args) => runs.get(...args), cancelRun: (...args) => runs.cancel(...args), subscribeProject })
  t.after(async () => { runJobs.dispose(); await runs.dispose() })
  const exec = { agent: { session: { id: sessionId } } }, tools = runTools({ home: e.home, runs, runJobs })
  return { ...e, runs, registry, runJobs, exec, tools, call: async (name, args) => JSON.parse(await tools.find(tool => tool.name === name).execute(args, exec)) }
}
test('会话先预览再确认，一次目标由同一引擎执行；context-query 返回暂停信息', async t => {
  let calls = 0; const e = await setup(t, async () => { calls++; return { passed: true } })
  const preview = await e.call('run-plan', { episodeNumber: 1, goal: { to: 'story', scope: { only: 'outline' }, mode: 'regenerate' } })
  assert.equal(calls, 0); assert.equal(preview.run.initiator, 'session')
  await assert.rejects(e.call('run-confirm', { runId: preview.runId }), { code: 'DELETIONS_PENDING' })
  const accepted = await e.call('run-confirm', { runId: preview.runId, confirmDelete: true })
  assert.ok(accepted.jobId); await e.runs.drain(); assert.equal(calls, 2)
  assert.equal((await e.runs.get(e.id, preview.runId, sessionId)).status, 'completed')
  const info = JSON.parse(await contextQueryTool({ home: e.home, runs: e.runs }).execute({}, e.exec))
  assert.deepEqual(info.current.runs, [])
})
test('面板任务可被会话找到并追加意见，模型不能调用人工放行', async t => {
  let failing = true
  const e = await setup(t, async () => { if (failing) throw new Error('连接失败'); return { passed: true } })
  const preview = await e.runs.plan({ projectId: e.id, episodeId: e.episodeId, goal: { to: 'story', scope: { only: 'outline' }, mode: 'regenerate' } }, sessionId, 'panel')
  await e.runs.confirm(e.id, preview.run.id, sessionId, { confirmDelete: true }); await e.runs.drain()
  const info = JSON.parse(await contextQueryTool({ home: e.home, runs: e.runs }).execute({}, e.exec))
  assert.equal(info.current.runs[0].pause.reasons[0].code, 'step_failed')
  await assert.rejects(e.call('run-resume', { runId: preview.run.id, action: 'override', target: 'outline' }), /无效/)
  failing = false
  const amended = await e.call('run-amend', { runId: preview.run.id, target: 'outline', feedback: '加强因果', confirmDelete: true })
  assert.equal(amended.runId, preview.run.id); await e.runs.drain()
  assert.equal((await e.runs.get(e.id, preview.run.id, sessionId)).status, 'completed')
  assert.equal(e.runJobs.guard({ name: 'job_kill', arguments: { job_id: amended.jobId } }), undefined)
})
test('会话拒绝未知参数、跳集及未绑定项目，不接受客户端身份和执行步骤', async t => {
  const e = await setup(t)
  await assert.rejects(e.call('run-plan', { goal: { to: 'film' }, actor: 'human' }), /不受支持/)
  await assert.rejects(e.call('run-plan', { episodeNumber: 3, goal: { to: 'summary' } }), /不能跳集/)
  const tool = e.tools.find(item => item.name === 'run-plan')
  await assert.rejects(tool.execute({ goal: { to: 'film' } }, { agent: { session: { id: 'another' } } }), /没有项目/)
})
