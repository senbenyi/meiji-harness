import { tableResponse } from './fixtures/shot-response.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'
// 业务单步在任务里的落定：尾帧失败与补提、只做未完成部分、分镜失败不提交视频、人工专属入口与人工放行。
import test from 'node:test'
import assert from 'node:assert/strict'
import { access, writeFile } from 'node:fs/promises'
import { overrideBlocker } from '../shared/review-feedback.js'
import { shotsReady } from '../shared/generation-gates.js'
import { runStore } from '../server/data/run-store.js'
import { historyStore } from '../server/data/history-store.js'
import { modelStore } from '../server/data/model-settings.js'
import { runOperation, latestRun } from './fixtures/operation.js'
import { operations as definitions, validateOperation } from '../server/flow/operations/operation-registry.js'
import { setupModel } from './fixtures/model.js'

const table = '## S01 / 5s\n第一镜\n## S02 / 5s\n第二镜'
const shotsRequest = verdict => async ({ skill }) => skill === 'review' ? verdict : tableResponse(table)
let submitted = 0
const filmDeps = { submitH3: async ({ items }) => ({ baseUrl: 'http://video.test', shots: items.map(item => ({ ...item, promptId: `remote-${++submitted}` })) }),
  retrieveGatewayVideo: async () => Buffer.from('video'), saveLastFrame: async (_video, frame) => { await writeFile(frame, Buffer.from('frame')); return Buffer.from('frame') } }
const stepStates = run => run.steps.map(step => [step.kind, step.status])

async function setup(t) {
  const e = await setupModel(t), models = modelStore(e.home)
  await models.write({ ...await models.read(), apiKey: 'test-only' })
  return e
}

test('failed tail step preserves video and a tail-only retry does not submit again', async t => {
  const e = await setup(t)
  const failure = await runOperation(e.op('film', { track: 'S01', parts: 'video' }), { home: e.home, ...filmDeps,
    saveLastFrame: async () => { throw new Error('FFmpeg failed') } }).then(() => null, error => error)
  assert.match(failure.message, /FFmpeg failed/)
  // 视频步骤完成，尾帧步骤暂停待重试。
  assert.deepEqual(failure.run.steps.map(step => [step.kind, step.status]), [['video', 'done'], ['tail', 'paused']])
  assert.deepEqual(failure.run.pause.reasons.map(reason => [reason.code, reason.target, reason.actions]), [['step_failed', 'film:S01', ['retry', 'cancel-branch']]])
  const before = (await e.read()).shots.items[0]
  assert.equal(before.video.content.status, 'ready')
  assert.equal(before.tailFrame.error, 'FFmpeg failed')
  await runOperation(e.op('film', { track: 'S01', parts: 'tail' }), { home: e.home, ...filmDeps, submitH3: () => assert.fail('must not resubmit') })
  const after = (await e.read()).shots.items[0]
  assert.equal(after.video.content.file, before.video.content.file)
  assert.equal(after.tailFrame.status, 'passed')
  await access(after.tailFrame.content.localPath)
  const retry = await latestRun(e.home, e.id, 'film:S01')
  assert.equal(retry.status, 'completed'); assert.deepEqual(stepStates(retry), [['tail', 'done']])
})

test('a goal that only fills what is missing extracts absent tails without regenerating existing videos', async t => {
  const e = await setup(t)
  await runOperation(e.op('film', { parts: 'video' }), { home: e.home, ...filmDeps })
  await e.store.save(e.id, p => { p.episodes[0].shots.items[0].tailFrame = { ...p.episodes[0].shots.items[0].tailFrame, status: 'failed', check: { passed: false, failures: ['missing tail'] }, content: null }; return p })
  let extracted = 0
  await runOperation(e.op('film', { mode: 'generate' }), { home: e.home, ...filmDeps,
    submitH3: () => assert.fail('must not resubmit'),
    saveLastFrame: async (...args) => { extracted++; return filmDeps.saveLastFrame(...args) } })
  assert.equal(extracted, 1)
  const run = await latestRun(e.home, e.id)
  assert.equal(run.status, 'completed')
  assert.deepEqual(run.steps.filter(step => step.status === 'done').map(step => [step.kind, step.target]), [['tail', 'film:S01']])
  assert.ok(run.steps.filter(step => step.status !== 'done').every(step => step.status === 'skipped'))
  assert.ok((await e.read()).shots.items.every(shot => shot.video.content.status === 'ready'))
})

test('a failed storyboard step never submits that shot video', async t => {
  const e = await setup(t)
  await e.store.save(e.id, project => { project.episodes[0].shots.items[0].storyboard.status = 'not-generated'; project.episodes[0].shots.items[0].seconds.content.beats[0].action = '【错误|C99】'; return project })
  const tracks = []
  const failure = await runOperation(e.op('film', { track: 'S01' }), { home: e.home, ...filmDeps,
    submitH3: async args => { tracks.push(args.items[0].track); return filmDeps.submitH3(args) } }).then(() => null, error => error)
  assert.match(failure.message, /未知实体/)
  assert.deepEqual(tracks, [])
  const steps = failure.run.steps
  assert.deepEqual(steps.map(step => [step.kind, step.status]), [['storyboard', 'paused'], ['video', 'pending'], ['tail', 'pending']])
  assert.ok(steps.slice(1).every(step => !step.startedAt))
})

test('human-only edits are rejected for the session and never recorded', async t => {
  for (const action of ['missing', 'constructor', 'toString', '__proto__']) assert.throws(() => validateOperation({ action, origin: 'panel' }), { status: 400 }, action)
  const humanOnly = Object.entries(definitions).filter(([, value]) => value.agent === false).map(([action]) => action)
  assert.ok(humanOnly.includes('review-override') && humanOnly.includes('confirm-image'))
  for (const action of humanOnly) assert.throws(() => validateOperation({ action, origin: 'session' }), { status: 403 }, action)
  // 制作目标不走即时保存入口。
  for (const action of ['summary', 'story', 'shot-table', 'seconds', 'film', 'images']) assert.throws(() => validateOperation({ action, origin: 'panel' }), { code: 'RUN_GOAL_REQUIRED' }, action)
  const e = await setup(t)
  await assert.rejects(runOperation(e.op('review-override', { origin: 'session', key: 'summary' }), { home: e.home }), { status: 403 })
  assert.deepEqual(await runStore(e.home, e.id).list(), [])
  assert.deepEqual(await historyStore(e.home, e.id).list('events'), [])
})

test('review override passes the current version, keeps the AI reasons and is voided by regeneration', async t => {
  const e = await setup(t)
  await assert.rejects(runOperation(e.op('shot-table', {}), { home: e.home, request: shotsRequest(reviewFail('节奏太快')) }), /自审未通过/)
  let project = await e.read()
  assert.equal(project.shots.check.passed, false)
  assert.equal(shotsReady(project), false)
  await runOperation(e.op('review-override', { key: 'shots', origin: 'panel' }), { home: e.home })
  project = await e.read()
  assert.equal(project.shots.check.passed, true)
  assert.equal(project.shots.status, 'passed')
  assert.ok(project.shots.check.override.at)
  assert.ok(project.shots.check.override.reasons.some(reason => reason.includes('节奏太快')))
  assert.equal(shotsReady(project), true)
  // 人工放行是即时保存：只留项目事件，原任务记录不变。
  assert.deepEqual((await historyStore(e.home, e.id).list('events')).map(event => [event.type, event.actor]), [['review-override', 'human']])
  assert.equal((await runStore(e.home, e.id).list()).length, 1)
  // 已通过的内容没有可忽略的结论。
  await assert.rejects(runOperation(e.op('review-override', { key: 'shots' }), { home: e.home }), { status: 409 })
  // 重新生成写入新的结论，放行失效。
  await assert.rejects(runOperation(e.op('shot-table', {}), { home: e.home, request: shotsRequest(reviewFail('仍然太快')) }), /自审未通过/)
  project = await e.read()
  assert.equal(project.shots.check.passed, false)
  assert.equal(project.shots.check.override, undefined)
  // 格式错误（解析失败、没有镜头）不可忽略；非文本内容不可忽略。
  await e.store.save(e.id, current => { const shots = current.episodes[0].shots; shots.items = []; shots.failedOutput = '不是镜头表'; return current })
  await assert.rejects(runOperation(e.op('review-override', { key: 'shots' }), { home: e.home }), /格式错误/)
  assert.equal(overrideBlocker(await e.read(), 'film:S01'), '只有自审未通过的文本内容可以忽略')
})
