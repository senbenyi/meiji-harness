import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { storyPackageFixture, outlineFixture } from './fixtures/story-package.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'
import { linkStore } from '../server/data/workspace-links.js'
import { createOperationManager } from '../server/flow/operations/operation-manager.js'
import { recordStore } from '../server/data/task-store.js'
import { planTasks } from '../server/flow/operations/operation-registry.js'
import { operationDeletes } from '../shared/operation-cascade.js'
import { operationTools } from '../tools/session-operation-tools.js'
import { modelPatch } from '../shared/drama-model.js'
import { secondsForRequest } from './fixtures/seconds.js'

async function setup(t) {
  const e = await setupModel(t), sessionId = 'session-11111111-1111-4111-8111-111111111111'
  await e.store.save(e.id, root => ({ episodes: root.episodes.map(episode => modelPatch(episode, {})) }))
  await linkStore(e.home).selectProject(sessionId, e.id, e.store)
  const manager = createOperationManager({ home: e.home }); t.after(() => manager.dispose())
  return { ...e, manager,
    op: (action, fields = {}) => e.op(action, { origin: 'session', sessionId, mode: 'regenerate', ...fields }),
    run: async (action, fields, request) => {
      const run = manager.start(e.op(action, { origin: 'session', sessionId, mode: 'regenerate', ...fields }), null, { request })
      await run.ready; return run.done
    },
    nodes: async result => (await recordStore(e.home, e.id).read('tasks', result.tasks[0].id)).nodes,
  }
}

test('会话单独提取场景只执行生成，随后只审核不重写正文及下游', async t => {
  const e = await setup(t), before = await e.read(), calls = []
  const result = await e.run('story', { only: 'scenes' }, async message => { calls.push(message); return JSON.stringify(storyPackageFixture().scenes) })
  assert.equal(result.status, 'completed'); assert.equal(result.reviewPassed, null)
  assert.deepEqual((await e.nodes(result)).map(node => node.kind), ['generate']); assert.equal(calls.length, 1)
  const generated = await e.read()
  assert.equal(generated.plot.scenes.check.passed, null); assert.equal(generated.plot.scenes.error, null)
  assert.deepEqual(generated.plot.outline.content, before.plot.outline.content)
  assert.deepEqual(generated.plot.characters.items, before.plot.characters.items)
  const audit = await e.run('story', { only: 'scenes', mode: 'review' }, async message => { assert.equal(message.skill, 'review'); return reviewFail('场景与大纲存在冲突') })
  assert.equal(audit.status, 'review_failed')
  assert.deepEqual((await e.nodes(audit)).map(node => node.kind), ['review'])
  const after = await e.read()
  assert.deepEqual(after.plot.scenes.items, generated.plot.scenes.items)
  assert.deepEqual(after.shots, generated.shots)
  assert.equal(after.plot.scenes.revision, generated.plot.scenes.revision)
  assert.equal(after.plot.scenes.check.passed, false)
})

test('只审核大纲：不通过时正文、版本、人物场景道具及所有镜头均保留', async t => {
  const e = await setup(t), before = await e.read(); let requests = 0
  const result = await e.run('story', { only: 'outline', mode: 'review' }, async message => { requests++; assert.equal(message.skill, 'review'); return reviewFail('动机不足') })
  assert.equal(requests, 1); assert.equal(result.status, 'review_failed')
  const after = await e.read()
  assert.deepEqual(after.plot.outline.content, before.plot.outline.content)
  assert.equal(after.plot.outline.revision, before.plot.outline.revision)
  for (const key of ['characters', 'scenes', 'props']) assert.deepEqual(after.plot[key], before.plot[key])
  assert.deepEqual(after.shots, before.shots)
  assert.deepEqual(operationDeletes(await e.store.read(e.id), e.op('story', { only: 'outline', mode: 'review' })), [])
})

test('重新审核通过与审核接口失败都不会生成或改写正文', async t => {
  const e = await setup(t), before = await e.read()
  const audit = await e.run('story', { only: 'outline', mode: 'review' }, async () => reviewPass)
  assert.equal(audit.status, 'completed'); assert.equal(audit.reviewPassed, true)
  const saved = await e.read()
  const failed = await e.run('story', { only: 'outline', mode: 'review' }, async () => { throw new Error('审核服务不可用') })
  assert.equal(failed.status, 'failed')
  assert.deepEqual((await e.read()).plot.outline, saved.plot.outline)
  assert.deepEqual((await e.read()).shots, before.shots)
})

test('按意见修订大纲只产生 revise 节点，正文待审核；重新生成不携带旧稿或意见', async t => {
  const e = await setup(t), requests = []
  const modified = await e.run('story', { only: 'outline', mode: 'modify', generationMode: 'modify', review: '结尾增加悬念' }, async message => { requests.push(message); return JSON.stringify(outlineFixture('新的悬念')) })
  assert.equal(modified.status, 'completed')
  assert.deepEqual((await e.nodes(modified)).map(node => node.kind), ['revise'])
  assert.equal((await e.read()).plot.outline.check.passed, null)
  assert.match(requests[0].user, /结尾增加悬念/)
  requests.length = 0
  const regenerated = await e.run('story', { only: 'outline', mode: 'regenerate' }, async message => { requests.push(message); return JSON.stringify(outlineFixture('全新正文')) })
  assert.equal(regenerated.status, 'completed'); assert.equal(requests.length, 1)
  assert.doesNotMatch(requests[0].user, /新的悬念|结尾增加悬念|【本次修订基稿】/)
})

test('会话单镜每秒指令只生成，审核独立执行且不提升正文版本', async t => {
  const e = await setup(t)
  const result = await e.run('seconds', { track: 'S01' }, async message => secondsForRequest(message))
  assert.equal(result.status, 'completed'); assert.deepEqual((await e.nodes(result)).map(node => node.kind), ['generate'])
  const before = await e.read(), revision = before.shots.items[0].seconds.revision
  assert.equal(before.shots.items[0].seconds.check.passed, null)
  const audit = await e.run('seconds', { track: 'S01', mode: 'review' }, async () => reviewPass)
  assert.equal(audit.reviewPassed, true)
  assert.equal((await e.read()).shots.items[0].seconds.revision, revision)
  assert.deepEqual((await e.read()).shots.items[1], before.shots.items[1])
})

test('没有待审正文、未指定 only/track 或不支持的步骤时在入队前拒绝', async t => {
  const e = await setup(t)
  await assert.rejects(planTasks(e.home, e.op('story', {})), /only/)
  await assert.rejects(planTasks(e.home, e.op('seconds', {})), /track/)
  await e.store.save(e.id, root => { root.episodes[0].plot.outline.content = null; return root })
  await assert.rejects(planTasks(e.home, e.op('story', { mode: 'review', only: 'outline' })), /没有可审核/)
  let starts = 0
  const tools = operationTools({ home: e.home, jobs: { start: () => { starts++ } } })
  await assert.rejects(tools.find(tool => tool.name === 'operation-generate-story').execute({ episodeNumber: 1, mode: 'review' }, {}), /only/)
  assert.equal(starts, 0)
})

test('面板剧情流程仍生成和自审，且审核失败时动态修订复审', async t => {
  const e = await setup(t), kinds = []
  const run = e.manager.start(e.op('story', { origin: 'panel', only: 'outline' }), null, { request: async message => {
    kinds.push(message.skill)
    return message.skill === 'review' ? kinds.length === 2 ? reviewFail('因果不足') : reviewPass : JSON.stringify(outlineFixture())
  } })
  const result = await run.done
  assert.equal(result.status, 'completed')
  assert.deepEqual((await e.nodes(result)).map(node => node.kind), ['generate', 'review', 'revise', 're_review'])
})

test('项目摘要的生成、修订与审核分开；修改请求包含当前基稿及意见', async t => {
  const e = await setup(t)
  await e.store.save(e.id, { script: '旅人进入庭院寻找家人。' })
  const result = await e.run('project-summary', {}, async () => JSON.stringify({ summary: '原项目摘要' }))
  assert.equal(result.status, 'completed'); assert.equal(result.reviewPassed, null)
  assert.deepEqual((await e.nodes(result)).map(node => node.kind), ['generate'])
  const modified = await e.run('project-summary', { mode: 'modify', review: '突出寻找家人' }, async message => {
    assert.match(message.user, /原项目摘要/); assert.match(message.user, /突出寻找家人/)
    return JSON.stringify({ summary: '旅人寻找家人' })
  })
  assert.equal(modified.status, 'completed')
  assert.deepEqual((await e.nodes(modified)).map(node => node.kind), ['revise'])
  const before = await e.store.read(e.id)
  const reviewed = await e.run('project-summary', { mode: 'review' }, async () => reviewPass)
  assert.equal(reviewed.reviewPassed, true)
  const after = await e.store.read(e.id)
  assert.equal(after.summary.content, before.summary.content)
  assert.equal(after.summary.revision, before.summary.revision)
})

test('镜头表生成与审核独立；缺少大纲审核不入队、不清理场景', async t => {
  const e = await setup(t)
  const generation = await e.run('shot-table', {}, async () => JSON.stringify({ shots: [{ shotId: 'S01', durationSeconds: 10, title: '入院', content: '旅人走进庭院。' }] }))
  assert.equal(generation.status, 'completed')
  assert.deepEqual((await e.nodes(generation)).map(node => node.kind), ['generate'])
  const before = await e.read()
  const reviewed = await e.run('shot-table', { mode: 'review' }, async () => reviewPass)
  assert.equal(reviewed.reviewPassed, true)
  assert.deepEqual((await e.read()).shots.items, before.shots.items)
  await e.store.save(e.id, root => { root.episodes[0].plot.outline.check.passed = false; return root })
  const blocked = await e.read()
  await assert.rejects(planTasks(e.home, e.op('story', { only: 'scenes' })), /大纲审核/)
  assert.deepEqual((await e.read()).plot.scenes, blocked.plot.scenes)
})

test('业务生成、审核和修订注册到各自 step 文件，面板和会话使用同一组实现', async t => {
  const e = await setup(t)
  const { generateOutline } = await import('../server/flow/steps/step-generate-outline.js')
  const { reviewOutline } = await import('../server/flow/steps/step-review-outline.js')
  const { reviseOutline } = await import('../server/flow/steps/step-revise-outline.js')
  for (const mode of ['generate', 'regenerate', 'modify', 'review']) {
    if (mode === 'generate') await e.store.save(e.id, root => { root.episodes[0].plot.outline.check.passed = null; return root })
    const [task] = await planTasks(e.home, e.op('story', { only: 'outline', mode, review: mode === 'modify' ? '修改结尾' : undefined }))
    assert.equal(task.steps.generate, generateOutline); assert.equal(task.steps.review, reviewOutline); assert.equal(task.steps.revise, reviseOutline)
    assert.deepEqual(task.plan.map(node => node.kind), [mode === 'review' ? 'review' : mode === 'modify' ? 'revise' : 'generate'])
  }
  const [panel] = await planTasks(e.home, e.op('story', { origin: 'panel', only: 'outline' }))
  assert.equal(panel.steps.generate, generateOutline)
  assert.deepEqual(panel.plan.map(node => node.kind), ['generate', 'review'])
})

test('独立审核不隐式补项目摘要或回写，审核未通过不要求自动重试', async t => {
  const e = await setup(t)
  await e.store.save(e.id, root => { delete root.episodes[0].summary.basis.scriptSyncedRevision; root.script = '当前剧本'; root.scriptRevision = 2; root.summary.basis = { scriptRevision: 1 }; return root })
  const tasks = await planTasks(e.home, e.op('story', { only: 'outline', mode: 'review' }))
  assert.deepEqual(tasks.map(task => task.type), ['outline'])
  const result = await e.run('project-summary', { mode: 'review' }, async () => reviewFail('依据不足'))
  assert.equal(result.status, 'review_failed')
  const { operationResult } = await import('../server/host/harness-jobs.js')
  const output = operationResult(result)
  assert.equal(output.step, 'review'); assert.equal(output.stepCompleted, true)
  assert.equal(output.retryable, undefined)
  assert.equal(result.result.scriptSyncOperationId, undefined)
})
