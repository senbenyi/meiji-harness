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
    // 生成步骤挂起时用户暂停任务；生成收尾后任务停在用户暂停，人工编辑接管同一任务。
    let calls = 0; const gate = Promise.withResolvers()
    const runs = createRunService({ home: e.home, execute: async (_run, step) => { calls++; if (calls === 1) await gate.promise; return step.kind.includes('review') ? { passed: true } : {} } })
    const edits = createImmediateService({ home: e.home, runs })
    t.after(async () => { await edits.dispose(); await runs.dispose() })
    const { run } = await runs.plan({ projectId: e.id, episodeId: e.episodeId, goal: { to: 'story', scope: { only: 'outline' }, mode: 'regenerate' } }, sessionId)
    await runs.confirm(e.id, run.id, sessionId, { confirmDelete: true })
    while (calls < 1) await new Promise(resolve => setTimeout(resolve, 5))
    await runs.pause(e.id, run.id, sessionId)
    gate.resolve(); await runs.drain()
    assert.equal((await runs.get(e.id, run.id, sessionId)).status, 'paused')
    const saved = edits.start({ ...e.op('outline-text', { outline: outlineFixture('人工修改正文') }), sessionId, origin: 'panel' })
    const result = await saved.done
    assert.equal(saved.failure, null)
    assert.equal(result.status, 'completed'); assert.equal(result.continueRun.runId, run.id)
    const edited = await runs.get(e.id, run.id, sessionId)
    assert.ok(edited.pause.reasons.some(reason => reason.code === 'manual_edit'))
    assert.equal(calls, 1, '人工保存不调用模型')
    const manual = edited.steps.findLast(step => step.kind === 'manual_edit')
    assert.equal(manual.status, 'done')
    assert.equal((await e.read()).plot.outline.source.stepId, manual.id)
    assert.equal((await runStore(e.home, e.id).records(run.id, manual.id, 'artifacts')).length, 1)
    await runs.resume(e.id, run.id, sessionId, { action, stepId: result.continueRun.stepId })
    await runs.resume(e.id, run.id, sessionId, { action: 'resume' }); await runs.drain()
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

test('项目删除不受已有项目占用锁阻塞', async t => {
  const e = await setupModel(t), pending = Promise.withResolvers()
  const edits = createImmediateService({ home: e.home, execute: async operation => operation.action === 'overview' ? pending.promise : {} })
  t.after(() => edits.dispose())
  const active = edits.start({ ...e.op('overview', { fields: { title: '占用中' } }), origin: 'panel' })
  const deleted = edits.start({ projectId: e.id, action: 'project-delete', confirmDelete: true, origin: 'panel' })
  assert.equal((await deleted.done).status, 'completed')
  pending.resolve({})
  assert.equal((await active.done).status, 'completed')
})

test('即时编辑可按剧集停止', async t => {
  const e = await setupModel(t)
  const edits = createImmediateService({ home: e.home, execute: async (operation, definition, { signal }) => await new Promise((resolve, reject) => { if (signal.aborted) return reject(signal.reason); signal.addEventListener('abort', () => reject(signal.reason), { once: true }) }) })
  t.after(() => edits.dispose())
  const active = edits.start({ ...e.op('overview', { fields: { title: '占用中' } }), origin: 'panel' })
  await edits.cancel(e.id, e.episodeId)
  assert.equal((await active.done).status, 'failed')
})
