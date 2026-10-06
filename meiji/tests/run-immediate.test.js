import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { useWorkspaces } from './fixtures/host.js'
import { outlineFixture } from './fixtures/story-package.js'
import { createImmediateService } from '../server/flow/immediate-service.js'
import { createRunService } from '../server/flow/runs/run-service.js'
import { runStore } from '../server/data/run-store.js'
import { linkStore } from '../server/data/workspace-links.js'
const sessionId = 'session-11111111-1111-4111-8111-111111111111'
test('即时保存不排队、不建立旧任务；同 Run 的人工编辑需要选择复审或放行', async t => {
  for (const action of ['review', 'override']) {
    const e = await setupModel(t); useWorkspaces(t)
    await linkStore(e.home).selectProject(sessionId, e.id, e.store)
    let passed = false, calls = 0
    const runs = createRunService({ home: e.home, execute: async () => { calls++; return { passed } } })
    const edits = createImmediateService({ home: e.home, runs })
    t.after(async () => { await edits.dispose(); await runs.dispose() })
    const { run } = await runs.plan({ projectId: e.id, episodeId: e.episodeId, goal: { to: 'story', scope: { only: 'outline' }, mode: 'review' } }, sessionId)
    await runs.confirm(e.id, run.id, sessionId); await runs.drain()
    const saved = edits.start({ ...e.op('outline-text', { outline: outlineFixture('人工修改正文') }), sessionId, origin: 'panel' })
    const result = await saved.done
    assert.equal(saved.failure, null)
    assert.equal(result.status, 'completed'); assert.equal(result.continueRun.runId, run.id)
    const edited = await runs.get(e.id, run.id, sessionId)
    assert.equal(edited.pause.reasons[0].code, 'manual_edit')
    assert.equal(calls, 1, '人工保存不调用模型')
    assert.ok(edited.steps.some(step => step.kind === 'manual_edit' && step.status === 'done'))
    const manual = edited.steps.findLast(step => step.kind === 'manual_edit')
    assert.equal((await e.read()).plot.outline.source.stepId, manual.id)
    assert.equal((await runStore(e.home, e.id).records(run.id, manual.id, 'artifacts')).length, 1)
    passed = true
    await runs.resume(e.id, run.id, sessionId, { action, stepId: result.continueRun.stepId }); await runs.drain()
    assert.equal((await runs.get(e.id, run.id, sessionId)).status, 'completed')
    assert.equal(calls, action === 'review' ? 2 : 1)
  }
})
test('即时创建返回结果且不建立制作任务；生成旧入口被拒绝', async t => {
  const e = await setupModel(t), rows = {}; useWorkspaces(t, rows)
  const workspaceController = { rename: async () => {}, create: async ({ path }) => { rows.created = { path, title: '即时创建', sessionIds: [] }; return { workspace: { workspaceId: 'created' } } } }
  const edits = createImmediateService({ home: e.home, workspaceController }); t.after(() => edits.dispose())
  const started = edits.start({ action: 'create', origin: 'panel', fields: { title: '即时创建', premise: '人工提供方向', mode: 'free' } })
  const result = await started.done
  assert.equal(started.failure, null); assert.equal(result.status, 'completed')
  assert.equal((await e.store.read(result.result.projectId)).title, '即时创建')
  assert.throws(() => edits.start(e.op('story')), { code: 'RUN_GOAL_REQUIRED' })
})
