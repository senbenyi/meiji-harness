import { operationRequest } from '../client/operation-request.js'
import { tableResponse } from './fixtures/shot-response.js'
import { secondsForRequest } from './fixtures/seconds.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'
// 任务与步骤：状态推导、结束落定、计划与执行的对应、逐镜成片单一任务、人工专属操作。
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { overrideBlocker } from '../shared/review-feedback.js'
import { shotsReady } from '../shared/generation-gates.js'
import { StepStatus, currentStep, deriveTaskStatus, groupByTarget, reviewFailures, reviewPassed } from '../shared/task-nodes.js'
import { finalizeNodes } from '../server/runtime/task-state.js'
import { recordStore } from '../server/data/task-store.js'
import { linkStore } from '../server/data/workspace-links.js'
import { modelStore } from '../server/data/model-settings.js'
import { runOperation, latestTask } from './fixtures/operation.js'
import { operations as definitions, planTasks, validateOperation } from '../server/flow/operations/operation-registry.js'
import { createOperationManager } from '../server/flow/operations/operation-manager.js'
import { generateAllSeconds } from './fixtures/seconds-generation.js'
import { generateShotStoryboard, generateStoryboard } from '../server/flow/steps/step-generate-storyboard.js'
import { generateShots } from '../server/flow/tasks/text/task-shot-table.js'
import { storyboardFixture } from './fixtures/storyboard.js'
import { setupModel, tempHome } from './fixtures/model.js'

const step = (status, extra = {}) => ({ kind: 'generate', target: 'summary', status, verdict: null, reasons: [], ...extra })
const reply = (text, verdict = reviewPass) => async ({ skill, user }) => skill === 'review' ? verdict : skill === 'storyboard' ? storyboardFixture(user) : skill === 'shots' ? tableResponse(text) : text
const prompt = 'integrated_multimodal_description: 旅人朝北进入庭院，摄影机位于旅人身后\noverall_soundscape: 风声\nnon_diegetic_music: N/A'
const table = '## S01 / 5s\n第一镜\n## S02 / 5s\n第二镜'
let submitted = 0
const filmDeps = { submitH3: async ({ items }) => ({ baseUrl: 'http://video.test', shots: items.map(item => ({ ...item, promptId: `remote-${++submitted}` })) }),
  retrieveGatewayVideo: async () => Buffer.from('video'), saveLastFrame: async (_video, frame) => { await writeFile(frame, Buffer.from('frame')); return Buffer.from('frame') } }

async function setup(t) {
  const e = await setupModel(t), models = modelStore(e.home)
  await models.write({ ...await models.read(), apiKey: 'test-only' })
  return { ...e, history: recordStore(e.home, e.id) }
}

test('task status is derived from nodes in the documented priority order', () => {
  const { PENDING, RUNNING, WAITING, COMPLETED, FAILED, CANCELLED, SKIPPED } = StepStatus
  assert.equal(deriveTaskStatus([]), 'queued')
  assert.equal(deriveTaskStatus([step(PENDING), step(PENDING)]), 'queued')
  assert.equal(deriveTaskStatus([step(COMPLETED), step(RUNNING), step(PENDING)]), 'running')
  assert.equal(deriveTaskStatus([step(COMPLETED), step(WAITING)]), 'waiting')
  assert.equal(deriveTaskStatus([step(COMPLETED), step(CANCELLED), step(PENDING)]), 'cancelled')
  assert.equal(deriveTaskStatus([step(COMPLETED), step(FAILED), step(PENDING)]), 'failed')
  // 两个步骤之间（上一步完成、下一步尚未开始）仍是执行中。
  assert.equal(deriveTaskStatus([step(COMPLETED), step(PENDING)]), 'running')
  assert.equal(deriveTaskStatus([step(COMPLETED), step(COMPLETED, { kind: 'review', verdict: 'fail' }), step(SKIPPED)]), 'review_failed')
  // 修订后复审通过：以同一目标最新的结论为准。
  assert.equal(deriveTaskStatus([step(COMPLETED, { kind: 'review', verdict: 'fail' }), step(COMPLETED, { kind: 're_review', verdict: 'pass' })]), 'completed')
  assert.equal(deriveTaskStatus([step(COMPLETED), step(SKIPPED)]), 'completed')
})

test('review summary, grouping and current step read from nodes', () => {
  const nodes = [
    step('completed', { kind: 'review', target: 'storyboard:S01', verdict: 'pass' }),
    step('completed', { kind: 'review', target: 'storyboard:S02', verdict: 'fail', reasons: [reviewFail('动作冲突')] }),
    step('running', { kind: 'video_submit', target: 'film:S01' }),
  ]
  assert.equal(reviewPassed(nodes), false)
  assert.deepEqual(reviewFailures(nodes), [reviewFail('动作冲突')])
  assert.equal(reviewPassed(nodes.slice(0, 1)), true)
  assert.equal(reviewPassed([step('completed')]), null)
  assert.deepEqual(groupByTarget(nodes).map(group => [group.target, group.status]), [['storyboard:S01', 'completed'], ['storyboard:S02', 'review_failed'], ['film:S01', 'running']])
  assert.equal(currentStep(nodes).kind, 'video_submit')
  assert.equal(currentStep(nodes.slice(0, 2)), null)
})

test('ending a task settles open nodes by how it ended', () => {
  const plan = () => [step('completed'), step('running', { kind: 'review' }), step('pending', { kind: 'revise' })]
  assert.deepEqual(finalizeNodes(plan(), new Error('网络'), null).map(item => item.status), ['completed', 'failed', 'pending'])
  assert.deepEqual(finalizeNodes(plan(), new Error('任务已停止'), { aborted: true }).map(item => item.status), ['completed', 'cancelled', 'pending'])
  const done = finalizeNodes([step('completed'), step('pending', { kind: 'revise' })], null, null)
  assert.deepEqual(done.map(item => item.status), ['completed', 'skipped'])
  const checked = finalizeNodes([step('completed'), step('pending', { kind: 'review' })], Object.assign(new Error('时长不符'), { code: 'CONTENT_CHECK_FAILED' }), null)
  assert.deepEqual(checked.map(item => `${item.kind}:${item.status}:${item.verdict}`), ['generate:completed:null', 'review:skipped:null', 'check:completed:fail'])
  assert.equal(deriveTaskStatus(checked), 'review_failed')
  // 出队后尚未真正开始的「准备中」步骤：正常结束时恢复为未执行再记为已跳过；出错时记为失败。
  assert.deepEqual(finalizeNodes([step('running', { preparing: true }), step('pending')], null, null).map(item => item.status), ['skipped', 'skipped'])
  const failed = finalizeNodes([step('running', { preparing: true }), step('pending')], new Error('请先写好镜头表'), null)
  assert.deepEqual(failed.map(item => item.status), ['failed', 'pending'])
  assert.equal(failed[0].preparing, undefined)
})

test('latest completed reviews determine both status and reasons, without duplicating failed checks', () => {
  const nodes = [
    step('completed', { target: 'a', verdict: 'fail', reasons: ['旧意见'] }),
    step('completed', { target: 'b', verdict: 'fail', reasons: ['未解决'] }),
    step('completed', { target: 'a', kind: 're_review', verdict: 'pass' }),
    step('pending', { target: 'b', kind: 're_review' }),
  ]
  assert.equal(deriveTaskStatus(nodes), 'running')
  assert.equal(reviewPassed(nodes), false)
  assert.deepEqual(reviewFailures(nodes), ['未解决'])
  finalizeNodes(nodes, Object.assign(new Error('审核失败'), { code: 'CONTENT_CHECK_FAILED' }))
  assert.equal(nodes.length, 4)
  assert.equal(deriveTaskStatus(nodes), 'review_failed')
  nodes.push(step('completed', { target: 'b', kind: 're_review', verdict: 'pass' }))
  assert.equal(deriveTaskStatus(nodes), 'completed')
  assert.equal(reviewPassed(nodes), true)
  assert.deepEqual(reviewFailures(nodes), [])
  finalizeNodes(nodes, Object.assign(new Error('新增内容错误'), { code: 'CONTENT_CHECK_FAILED' }))
  assert.equal(nodes.at(-1).kind, 'check')
  assert.deepEqual(reviewFailures(nodes), ['新增内容错误'])
  nodes.push(step('cancelled'))
  assert.equal(deriveTaskStatus(nodes), 'cancelled')
})

test('text operations execute exactly their planned nodes', async t => {
  const e = await setup(t)
  const cases = [
    ['shots', { generateShots: options => generateShots({ ...options, request: reply(table) }) }],
    ['seconds', { request: async message => message.skill === 'review' ? reviewPass : secondsForRequest(message) }],
    ['shot-storyboard', { generateShotStoryboard: options => generateShotStoryboard({ ...options, request: reply(prompt) }) }, { track: 'S01' }],
    ['storyboard', { generateStoryboard: options => generateStoryboard({ ...options, request: reply(prompt) }) }],
  ]
  for (const [action, deps, fields = {}] of cases) {
    const operation = e.op(action, fields), plan = await planSteps(e.home, operation)
    const before = new Set((await e.history.list()).map(task => task.id))
    await runOperation(operation, { home: e.home, operationId: `task-${action}`, ...deps })
    // 多任务操作（每秒指令、整集分镜按镜头划分）：本次执行的全部任务按计划顺序拼接后与计划一致。
    const at = task => plan.findIndex(item => item.target === task.nodes[0].target)
    const tasks = (await e.history.list()).filter(task => !before.has(task.id)).sort((a, b) => at(a) - at(b))
    assert.ok(tasks.every(task => task.id !== task.operationId), action)
    assert.deepEqual(tasks.flatMap(task => task.nodes).map(item => `${item.kind}:${item.target}`), plan.map(item => `${item.kind}:${item.target}`), action)
    for (const task of tasks) {
      assert.ok(task.nodes.every(item => ['completed', 'skipped'].includes(item.status) && !item.unplanned), action)
      assert.equal(task.status, 'completed', action)
      assert.ok(task.endedAt)
    }
  }
})

test('produce-all: each shot is a storyboard-prompt task then a video task, running only the nodes it needs, in order', async t => {
  const e = await setup(t)
  await e.store.save(e.id, project => { project.episodes[0].shots.items[0].storyboard.status = 'not-generated'; return project })
  await runOperation(e.op('film', {}), { home: e.home, operationId: 'one-click', waitForBackground: true, ...filmDeps,
    generateShotStoryboard: options => generateShotStoryboard({ ...options, request: reply(prompt) }) })
  const tasks = await e.history.list()
  assert.equal(tasks.length, 4); assert.ok(tasks.every(task => task.operationId && task.id !== task.operationId))
  assert.deepEqual(tasks.map(task => `${task.type}:${task.targets[0]}`).sort(), ['storyboard-prompt:storyboard:S01', 'storyboard-prompt:storyboard:S02', 'video:film:S01', 'video:film:S02'])
  assert.ok(tasks.every(task => task.status === 'completed'))
  const task = { nodes: tasks.flatMap(item => item.nodes).sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || '')) }
  assert.ok(task.nodes.every(item => !item.unplanned))
  assert.deepEqual(task.nodes.filter(item => item.status === 'completed').map(item => `${item.kind}:${item.target}`),
    // S01 成片后抽出尾帧，S02 的文本分镜按新尾帧重写后再提交。
    ['generate:storyboard:S01', 'review:storyboard:S01', 'video_submit:film:S01', 'video_generate:film:S01', 'tail_frame:film:S01', 'generate:storyboard:S02', 'review:storyboard:S02', 'video_submit:film:S02', 'video_generate:film:S02', 'tail_frame:film:S02'])
  const remote = task.nodes.filter(item => item.kind === 'video_generate').map(item => item.remoteId)
  assert.equal(new Set(remote).size, 2); assert.ok(remote.every(id => /^remote-\d+$/.test(id)))
  // 子操作的步骤各有作用域，互不混淆。
  assert.notEqual(tasks.find(task => task.target === 'storyboard:S01').id, tasks.find(task => task.target === 'film:S01').id)
  const shots = (await e.read()).shots.items
  assert.ok(shots.every(shot => shot.video.content?.status === 'ready'))
})

test('failed tail step preserves video and a tail-only retry does not submit again', async t => {
  const e = await setup(t)
  await assert.rejects(runOperation(e.op('film', { track: 'S01', parts: 'video' }), { home: e.home, operationId: 'tail-fails', waitForBackground: true, ...filmDeps,
    saveLastFrame: async () => { throw new Error('FFmpeg failed') } }), /FFmpeg failed/)
  const task = await latestTask(e.history, 'film:S01')
  assert.equal(task.status, 'failed')
  assert.deepEqual(task.nodes.map(s => [s.kind, s.status]), [['video_submit', 'completed'], ['video_generate', 'completed'], ['tail_frame', 'failed']])
  const before = (await e.read()).shots.items[0]
  assert.equal(before.video.content.status, 'ready')
  assert.equal(before.tailFrame.error, 'FFmpeg failed')
  await runOperation(e.op('film', { ...{ track: 'S01' }, parts: 'tail' }), { home: e.home, operationId: 'tail-retry', ...filmDeps,
    submitH3: () => assert.fail('must not resubmit') })
  const after = (await e.read()).shots.items[0]
  assert.equal(after.video.content.file, before.video.content.file)
  assert.equal(after.tailFrame.status, 'passed')
  await access(after.tailFrame.content.localPath)
  assert.equal((await latestTask(e.history, 'film:S01')).status, 'completed')
})

test('one-click videos fill missing tails without regenerating existing videos', async t => {
  const e = await setup(t)
  await runOperation(e.op('film', { ...{}, parts: 'video' }), { home: e.home, ...filmDeps })
  await e.store.save(e.id, p => { p.episodes[0].shots.items[0].tailFrame = { ...p.episodes[0].shots.items[0].tailFrame, status: 'failed', check: { passed: false, failures: ['missing tail'] }, content: null }; return p })
  let extracted = 0
  await runOperation(e.op('film'), { home: e.home, operationId: 'fill-tail', ...filmDeps,
    submitH3: () => assert.fail('must not resubmit'),
    saveLastFrame: async (...args) => { extracted++; return filmDeps.saveLastFrame(...args) } })
  assert.equal(extracted, 1)
  const task = await latestTask(e.history, 'film:S01')
  assert.equal(task.status, 'completed')
  assert.deepEqual(task.nodes.filter(s => s.status === 'completed').map(s => [s.kind, s.target]), [['tail_frame', 'film:S01']])
})

test('produce-all stops when video is ready but its tail extraction failed', async t => {
  const e = await setup(t)
  let submittedShots = 0
  await assert.rejects(runOperation(e.op('film', {}), { home: e.home, operationId: 'stop-tail', waitForBackground: true, ...filmDeps,
    submitH3: async args => { submittedShots++; return filmDeps.submitH3(args) },
    saveLastFrame: async () => { throw new Error('tail failed') } }), /tail failed/)
  assert.equal(submittedShots, 1)
  // S01 视频任务失败；之后的 S02 分镜与视频按停止规则取消；排在前面的 S01 分镜（已完成或跳过）不受影响。
  const status = Object.fromEntries((await e.history.list()).map(task => [task.targets[0], task.status]))
  assert.equal(status['film:S01'], 'failed')
  assert.equal(status['storyboard:S02'], 'cancelled'); assert.equal(status['film:S02'], 'cancelled')
  assert.equal(status['storyboard:S01'], 'completed')
})

test('human-only operations are rejected for the agent and never queued for it', async t => {
  for (const action of ['missing', 'constructor', 'toString', '__proto__']) assert.throws(() => validateOperation({ action, origin: 'panel' }), { status: 400 }, action)
  const humanOnly = Object.entries(definitions).filter(([, value]) => value.agent === false).map(([action]) => action)
  assert.ok(humanOnly.includes('review-override') && humanOnly.includes('confirm-image'))
  for (const action of humanOnly) assert.throws(() => validateOperation({ action, origin: 'session', mode: 'regenerate' }), { status: 403 }, action)
  const tasks = createOperationManager({ home: '/tmp/unused', execute: () => assert.fail('must not execute') })
  assert.throws(() => tasks.start({ action: 'review-override', origin: 'session', mode: 'regenerate', projectId: 'p', episodeId: 'e', key: 'summary' }), { status: 403 })
  const e = await setup(t)
  await assert.rejects(runOperation(e.op('review-override', { origin: 'session', mode: 'regenerate', key: 'summary' }), { home: e.home }), { status: 403 })
  assert.deepEqual(await e.history.list(), [])
})

test('produce stops at a failed storyboard review: the task is review_failed and later nodes are skipped', async t => {
  const e = await setup(t)
  await e.store.save(e.id, project => { project.episodes[0].shots.items[0].storyboard.status = 'not-generated'; project.episodes[0].shots.items[0].seconds.content.beats[0].action='【错误|C99】'; return project })
  await assert.rejects(runOperation(e.op('film', {}), { home: e.home, operationId: 'stop', waitForBackground: true, ...filmDeps,
    generateShotStoryboard: options => generateShotStoryboard({ ...options, request: reply(prompt, reviewFail('动作冲突')) }) }), /未通过自审|自审未通过/)
  const task = await latestTask(e.history, 'storyboard:S01')
  assert.equal(task.status, 'review_failed')
  assert.ok(task.nodes.filter(item => item.kind.startsWith('video_')).every(item => item.status === 'skipped'))
  assert.ok(!task.nodes.some(item => item.status === 'failed'))
})

test('review override: a new human task passes the current version, keeps the AI reasons and leaves the original task alone', async t => {
  const e = await setup(t)
  await runOperation(e.op('shot-table', {}), { home: e.home, operationId: 'generated', generateShots: options => generateShots({ ...options, request: reply(table, reviewFail('节奏太快')) }) })
  let project = await e.read()
  assert.equal(project.shots.check.passed, false)
  assert.equal(shotsReady(project), false)
  await runOperation(e.op('review-override', { key: 'shots', origin: 'panel' }), { home: e.home, operationId: 'override' })
  project = await e.read()
  assert.equal(project.shots.check.passed, true)
  assert.equal(project.shots.status, 'passed')
  assert.ok(project.shots.check.override.at)
  assert.ok(project.shots.check.override.reasons.some(reason => reason.includes('节奏太快')))
  assert.equal(shotsReady(project), true)
  const override = await latestTask(e.history, 'shots')
  assert.equal(override.actor, 'human')
  assert.deepEqual(override.nodes.map(item => `${item.kind}:${item.target}:${item.status}:${item.verdict}:${item.actor}`), ['override:shots:completed:pass:human'])
  assert.equal(override.status, 'completed')
  assert.equal((await e.history.list()).find(task => task.actor === 'model').status, 'review_failed')
  // 已通过的内容没有可忽略的结论。
  await assert.rejects(runOperation(e.op('review-override', { key: 'shots' }), { home: e.home }), { status: 409 })
  // 重新生成写入新的结论，放行失效。
  await runOperation(e.op('shot-table', {}), { home: e.home, generateShots: options => generateShots({ ...options, request: reply(table, reviewFail('仍然太快')) }) })
  project = await e.read()
  assert.equal(project.shots.check.passed, false)
  assert.equal(project.shots.check.override, undefined)
  // 格式错误（解析失败、没有镜头）不可忽略；非文本内容不可忽略。
  await e.store.save(e.id, current => { const shots = current.episodes[0].shots; shots.items = []; shots.failedOutput = '不是镜头表'; return current })
  await assert.rejects(runOperation(e.op('review-override', { key: 'shots' }), { home: e.home }), /格式错误/)
  assert.equal(overrideBlocker(await e.read(), 'film:S01'), '只有自审未通过的文本内容可以忽略')
})

test('不同项目独立占用，任务按视频队列排队', async t => {
  const e = await setup(t), gate = Promise.withResolvers()
  const { episodeFixture } = await import('./fixtures/model.js')
  const second = episodeFixture(), other = await e.store.create({ mode: 'free', premise: '人的创作方向', title: '另一项目' }); await e.store.save(other.id, { episodes: [second] })
  const manager = createOperationManager({ home:e.home, limitOf: () => 1, execute: async () => { await gate.promise; return [] } })
  const a=manager.start(e.op('film', { track:'S01', parts:'video' }))
  const b=manager.start(e.op('film', { projectId:other.id, episodeId:second.id, track:'S01', parts:'video' }))
  try {
    for(let i=0;i<200 && manager.current(other.id,second.id)[0]?.queuePosition!==1;i++) await new Promise(resolve=>setTimeout(resolve,5))
    const running=manager.current(e.id,e.episodeId)[0], queued=manager.current(other.id,second.id)[0]
    assert.equal(running.id,a.id); assert.equal(running.status,'running')
    assert.equal(queued.id,b.id); assert.equal(queued.status,'queued'); assert.equal(queued.queuePosition,1)
    assert.equal(running.tasks.length,1); assert.ok(queued.tasks[0].nodes.every(node=>node.status==='pending'))
  } finally { gate.resolve(); await Promise.all([a.done,b.done]) }
  assert.deepEqual(manager.current(e.id),[])
})

test('operation entry rejects another project before recording or generating and allows the selected project', async t => {
  const e = await setup(t), sessionId = `session-${randomUUID()}`
  const other = await e.store.create({ mode: 'free', premise: '人的创作方向', title: '另一部剧', summary: '另一段故事' })
  const links = linkStore(e.home)
  await links.selectProject(sessionId, other.id, e.store)
  let calls = 0
  const deps = { home: e.home, operationId: 'authorized-shots', generateShots: options => {
    calls++
    return generateShots({ ...options, request: reply(table) })
  } }
  const operation = e.op('shot-table', { sessionId, origin: 'session', mode: 'regenerate' })
  const before = await e.store.read(e.id)
  await assert.rejects(runOperation(operation, deps), { status: 409 })
  assert.equal(calls, 0)
  assert.deepEqual(await e.history.list(), [])
  assert.deepEqual(await e.store.read(e.id), before)
  await links.selectProject(sessionId, e.id, e.store)
  await runOperation(operation, deps)
  assert.equal(calls, 1)
  assert.equal((await latestTask(e.history, 'shots')).status, 'completed')
})

async function planSteps(home, operation) { return (await planTasks(home, operation)).flatMap(task => task.plan) }
