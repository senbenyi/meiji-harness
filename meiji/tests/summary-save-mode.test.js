import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { useWorkspaces } from './fixtures/host.js'
import { reviewPass } from './fixtures/review-result.js'
import { createRunService } from '../server/flow/runs/run-service.js'
import { createImmediateService } from '../server/flow/immediate-service.js'
import { linkStore } from '../server/data/workspace-links.js'
import { scriptStore } from '../server/data/script-store.js'
import { runStore } from '../server/data/run-store.js'
import { markPassed } from '../shared/content-state.js'
import { scriptBlockers, episodeHints } from '../shared/script-assembly.js'

const sessionId = 'session-11111111-1111-4111-8111-111111111111'
async function setup(t, mode, request) {
  const e = await setupModel(t); useWorkspaces(t)
  if (mode === 'script') {
    const project = await e.store.create({ mode, title: '剧本分集', script: '旅人进入庭院，找到了旧信。', summary: '旅人的故事' })
    e.id = project.id
    await e.store.save(e.id, current => {
      current.episodes = [e.episode]
      current.summary.basis = { scriptRevision: current.scriptRevision }
      markPassed(current.summary)
      return current
    })
  }
  await linkStore(e.home).selectProject(sessionId, e.id, e.store)
  const runs = createRunService({ home: e.home, deps: { request: message => request(message, e) } })
  const edits = createImmediateService({ home: e.home, runs })
  t.after(async () => { await edits.dispose(); await runs.dispose() })
  return { ...e, runs, edits }
}

for (const action of ['episode-add', 'episode-edit']) {
  test(`剧本模式 AI 生成摘要后 ${action} 不回写，旧素材/任务历史保留且能继续剧情`, async t => {
    const requests = []
    const e = await setup(t, 'script', async message => {
      requests.push(message)
      return message.skill === 'review' ? reviewPass : JSON.stringify({ summary: '旅人在庭院中发现了新的线索。' })
    })
    const before = await e.store.read(e.id), versions = await scriptStore(e.home, e.store).versions(e.id)
    const draft = await e.runs.plan({ projectId: e.id, episodeId: e.episodeId, goal: { to: 'summary', draft: true, durationSeconds: 10 } }, sessionId)
    assert.deepEqual(draft.run.steps.map(step => step.kind), ['generate', 'review'])
    await e.runs.confirm(e.id, draft.run.id, sessionId); await e.runs.drain()
    const completed = await e.runs.get(e.id, draft.run.id, sessionId)
    assert.equal(completed.status, 'completed')
    const generated = completed.steps.find(step => step.kind === 'generate').output.result.draft
    const saved = e.edits.start({ projectId: e.id, ...(action === 'episode-edit' ? { episodeId: e.episodeId } : {}), action, sessionId, origin: 'panel', confirmDelete: true, fields: { summary: generated.summary, durationSeconds: 10 } })
    const result = await saved.done; await e.runs.drain()
    assert.equal(result.status, 'completed'); assert.equal(saved.failure, null); assert.equal(result.continueRun, null)
    const root = await e.store.read(e.id), episode = root.episodes[0]
    assert.equal(episode.summary.content, generated.summary)
    assert.equal(root.script, before.script); assert.equal(root.scriptRevision, before.scriptRevision)
    assert.deepEqual(await scriptStore(e.home, e.store).versions(e.id), versions)
    assert.deepEqual(scriptBlockers(root), [])
    assert.equal(episodeHints(root, episode).pendingSync, false)
    assert.equal((await runStore(e.home, e.id).list()).length, 1, '保存不创建额外回写任务')
    if (action === 'episode-add') assert.deepEqual(root.episodes[1], before.episodes[0], '新增集不清除旧集人物或步骤依据')
    assert.ok(completed.steps.every(step => step.target !== 'script'))
    assert.ok(requests.every(message => !message.system.includes('needsChange')))
    // 真实 beforeStep 门禁必须允许新摘要的剧情生成，不只是静态删除提示。
    await e.runs.dispose()
    const continued = []
    const next = createRunService({ home: e.home, execute: async (_, step) => { continued.push(step); return { passed: true } } })
    t.after(() => next.dispose())
    const plan = await next.plan({ projectId: e.id, episodeId: episode.id, goal: { to: 'story', scope: { only: 'outline' }, mode: 'regenerate' } }, sessionId)
    await next.confirm(e.id, plan.run.id, sessionId, { confirmDelete: true }); await next.drain()
    assert.equal((await next.get(e.id, plan.run.id, sessionId)).status, 'completed')
    assert.ok(continued.some(step => step.target === 'outline'))
  })
}

test('剧本模式直接生成摘要不规划回写，完成后剧本版本不变', async t => {
  const e = await setup(t, 'script', async message => message.skill === 'review' ? reviewPass : JSON.stringify({ summary: '旅人沿线索继续前进。' }))
  const before = await e.store.read(e.id)
  const plan = await e.runs.plan({ projectId: e.id, episodeId: e.episodeId, goal: { to: 'summary', mode: 'regenerate' } }, sessionId)
  assert.deepEqual(plan.run.steps.map(step => step.kind), ['generate', 'review'])
  await e.runs.confirm(e.id, plan.run.id, sessionId, { confirmDelete: true }); await e.runs.drain()
  assert.equal((await e.runs.get(e.id, plan.run.id, sessionId)).status, 'completed')
  const root = await e.store.read(e.id)
  assert.equal(root.episodes[0].summary.content, '旅人沿线索继续前进。')
  assert.equal(root.script, before.script); assert.equal(root.scriptRevision, before.scriptRevision)
  assert.deepEqual(scriptBlockers(root), [])
})

for (const action of ['episode-add', 'episode-edit']) for (const outcome of ['success', 'failure']) {
  test(`自由模式 ${action} 先返回成功，后台回写 ${outcome} 后摘要保留且任务可查询`, async t => {
    const gate = Promise.withResolvers(), started = Promise.withResolvers()
    t.after(() => gate.resolve())
    const e = await setup(t, 'free', async (message, state) => {
      if (message.skill === 'review') return reviewPass
      started.resolve(); await gate.promise
      if (outcome === 'failure') throw new Error('模拟回写断网')
      const project = await state.store.read(state.id), episode = project.episodes[0]
      return JSON.stringify({ needsChange: true, note: '追加本集', changes: [{ target: { kind: 'episode', episodeId: episode.id }, before: '', after: episode.summary.content }] })
    })
    const before = await e.store.read(e.id)
    const save = e.edits.start({ projectId: e.id, ...(action === 'episode-edit' ? { episodeId: e.episodeId } : {}), action, sessionId, origin: 'panel', confirmDelete: true, fields: { summary: '旅人找到线索。', durationSeconds: 10 } })
    let timer
    const result = await Promise.race([save.done, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('保存被回写阻塞')), 1500) })]).finally(() => clearTimeout(timer))
    assert.equal(result.status, 'completed'); assert.equal(save.failure, null)
    assert.equal(result.continueRun.kind, 'sync')
    await started.promise
    const during = await e.store.read(e.id), active = await e.runs.get(e.id, result.continueRun.runId, sessionId)
    assert.equal(during.episodes[0].summary.content, '旅人找到线索。')
    assert.equal(during.script, before.script); assert.equal(active.status, 'running')
    if (action === 'episode-add') assert.deepEqual(during.episodes[1], before.episodes[0])
    gate.resolve(); await e.runs.drain()
    const completed = await e.runs.get(e.id, active.id, sessionId), after = await e.store.read(e.id)
    assert.equal(after.episodes[0].summary.content, '旅人找到线索。')
    if (outcome === 'success') {
      assert.equal(completed.status, 'completed'); assert.equal(after.script, '旅人找到线索。')
      assert.equal(after.episodes[0].summary.basis.scriptSyncedRevision, after.episodes[0].summary.revision)
    } else {
      assert.equal(completed.status, 'failed'); assert.equal(after.script, before.script)
      assert.match(completed.failure.message, /模拟回写断网/)
    }
  })
}

test('剧本模式摘要保存被进行中的摘要任务接管时也不插入回写', async t => {
  const e = await setup(t, 'script', async () => assert.fail('不应调用模型'))
  await e.runs.dispose(); await e.edits.dispose()
  const gate = Promise.withResolvers(), started = Promise.withResolvers()
  t.after(() => gate.resolve())
  const runs = createRunService({ home: e.home, execute: async (_, step) => {
    if (step.kind === 'generate') { started.resolve(); await gate.promise }
    return { passed: true }
  } })
  const edits = createImmediateService({ home: e.home, runs })
  t.after(async () => { await edits.dispose(); await runs.dispose() })
  const plan = await runs.plan({ projectId: e.id, episodeId: e.episodeId, goal: { to: 'summary', mode: 'regenerate' } }, sessionId)
  await runs.confirm(e.id, plan.run.id, sessionId, { confirmDelete: true }); await started.promise
  await runs.pause(e.id, plan.run.id, sessionId); gate.resolve(); await runs.drain()
  const save = edits.start({ projectId: e.id, episodeId: e.episodeId, action: 'episode-edit', sessionId, origin: 'panel', confirmDelete: true, fields: { summary: '人工保存新线索。', durationSeconds: 10 } })
  const result = await save.done
  assert.equal(result.status, 'completed'); assert.equal(result.continueRun.runId, plan.run.id)
  const amended = await runs.get(e.id, plan.run.id, sessionId)
  assert.ok(amended.steps.some(step => step.kind === 'manual_edit' && step.target === 'summary'))
  assert.ok(amended.steps.every(step => step.target !== 'script'))
  assert.equal((await e.store.read(e.id)).scriptRevision, 1)
})

test('剧本模式忽略未回写摘要和删除事实，显式剧本方案仍需处理', async t => {
  const e = await setup(t, 'script', async () => assert.fail('不应调用模型'))
  await e.store.save(e.id, root => {
    delete root.episodes[0].summary.basis.scriptSyncedRevision
    root.scriptPendingDeletes = [{ episodeId: 'removed', summaryBefore: '旧集', at: new Date().toISOString() }]
    return root
  })
  const root = await e.store.read(e.id)
  assert.deepEqual(scriptBlockers(root), [])
  const scripts = scriptStore(e.home, e.store)
  const id = await scripts.propose(e.id, { source: 'ai-edit', episodeId: null, baseRevision: root.scriptRevision, note: '显式修改', changes: [{ target: { kind: 'body' }, before: '旧信', after: '新信' }] })
  assert.deepEqual(scriptBlockers(await e.store.read(e.id)), [{ kind: 'proposal', id, episodeId: null }])
})
