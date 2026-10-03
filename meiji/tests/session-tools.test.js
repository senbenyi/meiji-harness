import { reviewPass, reviewFail } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setupModel } from './fixtures/model.js'
import { storyPackageFixture, outlineFixture } from './fixtures/story-package.js'
import { createOperationManager } from '../server/flow/operations/operation-manager.js'
import { runOperation } from './fixtures/operation.js'
import { generateEpisode } from '../server/flow/tasks/text/task-summary.js'
import { generateStoryPackage } from './fixtures/story-generation.js'
import { modelStore } from '../server/data/model-settings.js'
import { linkStore } from '../server/data/workspace-links.js'
import { contentGenerateTool } from '../tools/session-content-generate-tool.js'
import { contextQueryTool } from '../tools/session-context-query-tool.js'
import { projectManageTool } from '../tools/session-project-manage-tool.js'
import { taskControlTool } from '../tools/session-task-control-tool.js'
import { useWorkspaces } from './fixtures/host.js'

async function setup(t, review = reviewPass) {
  const e = await setupModel(t), calls = [], logs = []
  await e.store.save(e.id, { episodes: [] })
  const models = modelStore(e.home); await models.write({ ...await models.read(), apiKey: 'test-only' })
  const exec = { agent: { session: { id: 'session-' + randomUUID(), append: (type, data) => logs.push({ type, data }) } }, signal: new AbortController().signal }
  await linkStore(e.home).selectProject(exec.agent.session.id, e.id, e.store)
  const fixture = storyPackageFixture(), storyReplies = [JSON.stringify(outlineFixture()), review, JSON.stringify(fixture.characters), review, JSON.stringify(fixture.scenes), review, JSON.stringify(fixture.props), review]
  const tasks = createOperationManager({ home: e.home, execute: (op, deps) => runOperation(op, { ...deps,
    generateEpisode: opts => generateEpisode({ ...opts, request: async message => { calls.push(message); return message.skill === 'review' ? review : JSON.stringify({ summary: '武松带着工地经历醒来，发现自己身处景阳冈。', durationSeconds: 150 }) } }),
    fetchImpl: async (_url, options) => { const payload = JSON.parse(options.body); const [system, user] = payload.messages; calls.push({ system: system.content, user: user.content }); return Response.json({ choices: [{ message: { content: storyReplies.shift() } }] }) },
  }) })
  const generate = contentGenerateTool({ home: e.home, tasks }), control = taskControlTool({ home: e.home, tasks })
  const start = async args => JSON.parse(await generate.execute(args, exec))
  const wait = async task => JSON.parse(await control.execute({ action: 'wait', operationId: task.operationId }, exec))
  return { ...e, exec, calls, logs, tasks, start, wait, control }
}

test('session executes summary then story through real workflows and carries requirements into review', async t => {
  const e = await setup(t)
  const summary = await e.wait(await e.start({ stage: 'summary', episodeNumber: 1, mode: 'generate', requirements: '保留工地经历' }))
  assert.equal(summary.status, 'completed'); assert.equal(summary.reviewPassed, true)
  assert.ok(summary.episodeId)
  const story = await e.wait(await e.start({ stage: 'story', episodeNumber: 1, mode: 'generate', requirements: '侧重心理反应' }))
  assert.equal(story.status, 'completed', JSON.stringify(story)); assert.equal(story.reviewPassed, true)
  assert.equal(story.episodeId, summary.episodeId)
  assert.equal(e.calls.length, 10)
  for (const message of e.calls.slice(0, 2)) assert.match(message.user, /保留工地经历/)
  for (const message of e.calls.slice(2)) assert.match(message.user, /侧重心理反应/)
  for (const message of e.calls.slice(2, 4)) assert.match(message.user, /武松带着工地经历醒来/)
  const duplicate = await e.start({ stage: 'story', episodeNumber: 1, mode: 'generate' })
  assert.equal(duplicate.alreadyCompleted, true); assert.equal(e.calls.length, 10)
  const context = JSON.parse(await contextQueryTool({ home: e.home, tasks: e.tasks }).execute({}, e.exec))
  assert.equal(context.current.episodes[0].episodeNumber, 1)
  assert.equal(context.current.episodes[0].stages.outline.passed, true)
  const detail = JSON.parse(await contextQueryTool({ home: e.home, tasks: e.tasks }).execute({ episodeNumber: 1 }, e.exec))
  assert.ok(detail.episode.plot.characters.items.length)
  assert.ok(e.logs.length > 0)
})

test('failed summary blocks story and reports review_failed without a tool retry', async t => {
  const e = await setup(t, reviewFail('缺少关键因果'))
  const result = await e.wait(await e.start({ stage: 'summary', episodeNumber: 1, mode: 'generate' }))
  assert.equal(result.status, 'review_failed')
  await assert.rejects(e.start({ stage: 'story', episodeNumber: 1, mode: 'generate' }), /摘要尚未通过/)
  // 生成 + 自审 + 默认 2 轮（修订 + 复审）。
  assert.equal(e.calls.length, 6)
})

test('regeneration excludes old output and history; modification includes original and new opinion', async t => {
  const e = await setup(t)
  await e.wait(await e.start({ stage: 'summary', episodeNumber: 1, mode: 'generate' }))
  e.calls.length = 0
  await e.wait(await e.start({ stage: 'summary', episodeNumber: 1, mode: 'regenerate', requirements: '增加悬念' }))
  assert.doesNotMatch(e.calls[0].user, /武松带着工地经历醒来/)
  assert.match(e.calls[0].user, /增加悬念/)
  e.calls.length = 0
  await e.wait(await e.start({ stage: 'summary', episodeNumber: 1, mode: 'modify', review: '改变结尾' }))
  assert.match(e.calls[0].user, /武松带着工地经历醒来/)
  assert.match(e.calls[0].user, /改变结尾/)
})

test('tools reject skipped episodes, missing opinions and cross-session task access', async t => {
  const e = await setup(t)
  await assert.rejects(e.start({ stage: 'summary', episodeNumber: 3, mode: 'generate' }), /不能跳集/)
  await e.wait(await e.start({ stage: 'summary', episodeNumber: 1, mode: 'generate' }))
  await assert.rejects(e.start({ stage: 'summary', episodeNumber: 1, mode: 'modify' }), /修改意见/)
  const task = await e.start({ stage: 'summary', episodeNumber: 1, mode: 'regenerate' })
  await assert.rejects(e.control.execute({ action: 'cancel', operationId: task.operationId }, { agent: { session: { id: 'other' } } }), { status: 404 })
  await e.wait(task)
})

test('session creates project using shared operation and selects it without affecting other sessions', async t => {
  const e = await setup(t), workspaceId = randomUUID()
  useWorkspaces(t, { [workspaceId]: { title: '穿越成武松', path: '/project', sessionIds: [] } })
  const workspaceController = { create: async () => ({ workspace: { workspaceId, sessionIds: [] } }), rename: async () => {} }
  const tool = projectManageTool({ home: e.home, tasks: e.tasks, workspaceController })
  await assert.rejects(tool.execute({ action: 'create', fields: { title: '缺少摘要' } }, e.exec), /摘要/)
  const created = JSON.parse(await tool.execute({ action: 'create', fields: { title: '穿越成武松', summary: '农民工穿越成为武松' } }, e.exec))
  assert.equal(created.status, 'completed')
  assert.equal((await e.store.read(created.projectId)).episodes.length, 0)
  assert.equal((await linkStore(e.home).projectForSession(e.exec.agent.session.id)).projectId, created.projectId)
  assert.equal((await linkStore(e.home).projectForSession('session-' + randomUUID())).projectId, null)
  const summary = await e.wait(await e.start({ stage: 'summary', episodeNumber: 1, mode: 'generate' }))
  assert.equal(summary.projectId, created.projectId)
  assert.equal(summary.status, 'completed')
})
