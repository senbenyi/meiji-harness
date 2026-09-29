// 任务与步骤：状态推导、结束落定、计划与执行的对应、逐镜成片单一任务、人工专属操作。
import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { migrateTaskSteps } from '../scripts/migrate-task-steps.js'
import { overrideBlocker } from '../shared/feedback.js'
import { shotsReady } from '../shared/gates.js'
import { StepStatus, currentStep, deriveTaskStatus, groupByTarget, reviewFailures, reviewPassed } from '../shared/steps.js'
import { expandStage, finalizeSteps, recordStore } from '../server/data/task-store.js'
import { recordSteps } from './fixtures/steps.js'
import { modelStore } from '../server/data/model-settings.js'
import { runOperation } from '../server/flow/operations/run.js'
import { definitions, planSteps, validateOperation } from '../server/flow/operations/registry.js'
import { createTasks } from '../server/flow/tasks/runner.js'
import { generateAllSeconds, generateShotStoryboard, generateShots, generateStoryboard } from '../server/generate/shot-text.js'
import { setupModel, tempHome } from './fixtures/model.js'

const step = (status, extra = {}) => ({ kind: 'generate', target: 'summary', status, verdict: null, reasons: [], ...extra })
const reply = (text, verdict = 'PASS') => async ({ skill }) => skill === 'skill-gongyong-content-review' ? verdict : text
const prompt = 'summary: 旅人朝北进入庭院\ndetailed_description: 摄影机位于旅人身后\noverall_soundscape: 风声\nnon_diegetic_music: N/A'
const table = '## S01 / 5s\n第一镜\n## S02 / 5s\n第二镜'
let submitted = 0
const filmDeps = { submitH3: async ({ items }) => ({ baseUrl: 'http://video.test', shots: items.map(item => ({ ...item, promptId: `remote-${++submitted}` })) }),
  retrieveFilm: async () => Buffer.from('video'), saveLastFrame: async () => Buffer.from('frame') }

async function setup(t) {
  const e = await setupModel(t), models = modelStore(e.home)
  await models.write({ ...await models.read(), apiKey: 'test-only' })
  return { ...e, history: recordStore(e.home, e.id) }
}

test('task status is derived from steps in the documented priority order', () => {
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

test('review summary, grouping and current step read from steps', () => {
  const steps = [
    step('completed', { kind: 'review', target: 'storyboard:S01', verdict: 'pass' }),
    step('completed', { kind: 'review', target: 'storyboard:S02', verdict: 'fail', reasons: ['FAIL 动作冲突'] }),
    step('running', { kind: 'video_submit', target: 'film:S01' }),
  ]
  assert.equal(reviewPassed(steps), false)
  assert.deepEqual(reviewFailures(steps), ['FAIL 动作冲突'])
  assert.equal(reviewPassed(steps.slice(0, 1)), true)
  assert.equal(reviewPassed([step('completed')]), null)
  assert.deepEqual(groupByTarget(steps).map(group => [group.target, group.status]), [['storyboard:S01', 'completed'], ['storyboard:S02', 'review_failed'], ['film:S01', 'running']])
  assert.equal(currentStep(steps).kind, 'video_submit')
  assert.equal(currentStep(steps.slice(0, 2)), null)
})

test('ending a task settles open steps by how it ended', () => {
  const plan = () => [step('completed'), step('running', { kind: 'review' }), step('pending', { kind: 'revise' })]
  assert.deepEqual(finalizeSteps(plan(), new Error('网络'), null).map(item => item.status), ['completed', 'failed', 'pending'])
  assert.deepEqual(finalizeSteps(plan(), new Error('任务已停止'), { aborted: true }).map(item => item.status), ['completed', 'cancelled', 'pending'])
  const done = finalizeSteps([step('completed'), step('pending', { kind: 'revise' })], null, null)
  assert.deepEqual(done.map(item => item.status), ['completed', 'skipped'])
  const checked = finalizeSteps([step('completed'), step('pending', { kind: 'review' })], Object.assign(new Error('时长不符'), { code: 'CONTENT_CHECK_FAILED' }), null)
  assert.deepEqual(checked.map(item => `${item.kind}:${item.status}:${item.verdict}`), ['generate:completed:null', 'review:skipped:null', 'check:completed:fail'])
  assert.equal(deriveTaskStatus(checked), 'review_failed')
  // 出队后尚未真正开始的「准备中」步骤：正常结束时恢复为未执行再记为已跳过；出错时记为失败。
  assert.deepEqual(finalizeSteps([step('running', { preparing: true }), step('pending')], null, null).map(item => item.status), ['skipped', 'skipped'])
  const failed = finalizeSteps([step('running', { preparing: true }), step('pending')], new Error('请先写好镜头表'), null)
  assert.deepEqual(failed.map(item => item.status), ['failed', 'pending'])
  assert.equal(failed[0].preparing, undefined)
})

test('text operations execute exactly their planned steps', async t => {
  const e = await setup(t)
  const cases = [
    ['shots', { generateShots: options => generateShots({ ...options, request: reply(table) }) }],
    ['seconds', { generateAllSeconds: options => generateAllSeconds({ ...options, request: reply(table + '\n[seconds-complete]') }) }],
    ['shot-storyboard', { generateShotStoryboard: options => generateShotStoryboard({ ...options, request: reply(prompt) }) }, { track: 'S01' }],
    ['storyboard', { generateStoryboard: options => generateStoryboard({ ...options, request: reply(prompt) }) }],
  ]
  for (const [action, deps, fields = {}] of cases) {
    const operation = e.op(action, fields), plan = await planSteps(e.home, operation)
    await runOperation(operation, { home: e.home, operationId: `task-${action}`, ...deps })
    const task = await e.history.read('tasks', `task-${action}`)
    assert.deepEqual(task.steps.map(item => `${item.kind}:${item.target}`), plan.map(item => `${item.kind}:${item.target}`), action)
    assert.ok(task.steps.every(item => ['completed', 'skipped'].includes(item.status) && !item.unplanned), action)
    assert.equal(task.status, 'completed', action)
    assert.ok(task.endedAt)
  }
})

test('produce-all is one task: each shot runs only the steps it needs, in order', async t => {
  const e = await setup(t)
  await e.store.save(e.id, project => { project.episodes[0].shots.items[0].storyboard.status = 'not-generated'; return project })
  await runOperation(e.op('produce-all'), { home: e.home, operationId: 'one-click', waitForBackground: true, ...filmDeps,
    generateShotStoryboard: options => generateShotStoryboard({ ...options, request: reply(prompt) }) })
  const tasks = await e.history.list()
  assert.deepEqual(tasks.map(task => task.id), ['one-click'])
  const [task] = tasks
  assert.equal(task.status, 'completed')
  assert.ok(task.steps.every(item => !item.unplanned))
  assert.deepEqual(task.steps.filter(item => item.status === 'completed').map(item => `${item.kind}:${item.target}`),
    ['generate:storyboard:S01', 'review:storyboard:S01', 'video_submit:film:S01', 'video_generate:film:S01', 'video_submit:film:S02', 'video_generate:film:S02'])
  const remote = task.steps.filter(item => item.kind === 'video_generate').map(item => item.remoteId)
  assert.equal(new Set(remote).size, 2); assert.ok(remote.every(id => /^remote-\d+$/.test(id)))
  // 子操作的步骤各有作用域，互不混淆。
  assert.notEqual(task.steps.find(item => item.target === 'storyboard:S01' && item.kind === 'generate').scope, task.steps.find(item => item.target === 'film:S01' && item.kind === 'video_submit').scope)
  const shots = (await e.read()).shots.items
  assert.ok(shots.every(shot => shot.video.content?.status === 'ready'))
})

test('human-only operations are rejected for the agent and never queued for it', async t => {
  const humanOnly = Object.entries(definitions).filter(([, value]) => value.agent === false).map(([action]) => action)
  assert.ok(humanOnly.includes('review-override') && humanOnly.includes('confirm-image'))
  for (const action of humanOnly) assert.throws(() => validateOperation({ action, origin: 'session' }), { status: 403 }, action)
  const tasks = createTasks({ home: '/tmp/unused', execute: () => assert.fail('must not execute') })
  assert.throws(() => tasks.start({ action: 'review-override', origin: 'session', projectId: 'p', episodeId: 'e', key: 'summary' }), { status: 403 })
  const e = await setup(t)
  await assert.rejects(runOperation(e.op('review-override', { origin: 'session', key: 'summary' }), { home: e.home }), { status: 403 })
  assert.deepEqual(await e.history.list(), [])
})

test('produce stops at a failed storyboard review: the task is review_failed and later steps are skipped', async t => {
  const e = await setup(t)
  await e.store.save(e.id, project => { project.episodes[0].shots.items[0].storyboard.status = 'not-generated'; return project })
  await assert.rejects(runOperation(e.op('produce-all'), { home: e.home, operationId: 'stop', waitForBackground: true, ...filmDeps,
    generateShotStoryboard: options => generateShotStoryboard({ ...options, request: reply(prompt, 'FAIL 动作冲突') }) }), /未通过自审|自检未通过/)
  const task = await e.history.read('tasks', 'stop')
  assert.equal(task.status, 'review_failed')
  assert.ok(task.steps.filter(item => item.kind.startsWith('video_')).every(item => item.status === 'skipped'))
  assert.ok(!task.steps.some(item => item.status === 'failed'))
})

test('review override: a new human task passes the current version, keeps the AI reasons and leaves the original task alone', async t => {
  const e = await setup(t)
  await runOperation(e.op('shots'), { home: e.home, operationId: 'generated', generateShots: options => generateShots({ ...options, request: reply(table, 'FAIL 节奏太快') }) })
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
  const override = await e.history.read('tasks', 'override')
  assert.equal(override.actor, 'human')
  assert.deepEqual(override.steps.map(item => `${item.kind}:${item.target}:${item.status}:${item.verdict}:${item.actor}`), ['override:shots:completed:pass:human'])
  assert.equal(override.status, 'completed')
  assert.equal((await e.history.read('tasks', 'generated')).status, 'review_failed')
  // 已通过的内容没有可忽略的结论。
  await assert.rejects(runOperation(e.op('review-override', { key: 'shots' }), { home: e.home }), { status: 409 })
  // 重新生成写入新的结论，放行失效。
  await runOperation(e.op('shots'), { home: e.home, generateShots: options => generateShots({ ...options, request: reply(table, 'FAIL 仍然太快') }) })
  project = await e.read()
  assert.equal(project.shots.check.passed, false)
  assert.equal(project.shots.check.override, undefined)
  // 格式错误（解析失败、没有镜头）不可忽略；非文本内容不可忽略。
  await e.store.save(e.id, current => { const shots = current.episodes[0].shots; shots.items = []; shots.failedOutput = '不是镜头表'; return current })
  await assert.rejects(runOperation(e.op('review-override', { key: 'shots' }), { home: e.home }), /格式错误/)
  assert.equal(overrideBlocker(await e.read(), 'film:S01'), '只有自审未通过的文本内容可以忽略')
})

test('current tasks show running and queued tasks of the episode with steps and queue position', async t => {
  const home = await tempHome(t), gate = Promise.withResolvers()
  const tasks = createTasks({ home, limitOf: () => 1, execute: async () => { await gate.promise; return [] } })
  const a = tasks.start({ action: 'films', projectId: 'p', episodeId: 'e1', sessionId: 's' })
  const b = tasks.start({ action: 'films', projectId: 'p', episodeId: 'e2', sessionId: 's' })
  for (let i = 0; i < 200 && tasks.current('p').find(task => task.id === b.id)?.queuePosition !== 1; i++) await new Promise(resolve => setTimeout(resolve, 10))
  const [running] = tasks.current('p', 'e1')
  assert.equal(running.id, a.id); assert.equal(running.status, 'running'); assert.equal(running.label, '一键成片')
  assert.equal(running.steps[0].status, 'running')
  const queued = tasks.current('p', 'e2')[0]
  assert.equal(queued.status, 'queued'); assert.equal(queued.queuePosition, 1)
  assert.ok(queued.steps.every(item => item.status === 'pending'))
  gate.resolve()
  await Promise.all([a.done, b.done])
  assert.deepEqual(tasks.current('p'), [])
})

test('old task records must be migrated; migration converts nodes to steps and is repeatable', async t => {
  const e = await setupModel(t), root = join(e.home, 'storages', 'meiji', 'projects', e.id, 'history')
  await mkdir(join(root, 'tasks'), { recursive: true }); await mkdir(join(root, 'artifacts'), { recursive: true })
  const at = '2026-01-01T00:00:00.000Z', node = (id, kind, extra = {}) => ({ id, kind, status: 'succeeded', startedAt: at, endedAt: at, inputs: [], outputs: [], ...extra })
  const write = (kind, value) => writeFile(join(root, kind, value.id + '.json'), JSON.stringify(value))
  await write('tasks', { schemaVersion: 1, id: 'reviewed', projectId: e.id, episodeId: e.episodeId, action: 'shots', actor: 'model', status: 'completed', startedAt: at, endedAt: at, error: null,
    nodes: [node('n0', 'execute'), node('n1', 'generation', { outputs: ['a1'] }), node('n2', 'review', { reviewResult: 'fail', reasons: ['FAIL 节奏'] }), node('n3', 'revision'), node('n4', 're_review', { reviewResult: 'pass' })],
    artifacts: [{ artifactId: 'a1', taskId: 'reviewed', nodeId: 'n1', version: 2, target: 'shots' }], latestOutputs: [] })
  await write('tasks', { schemaVersion: 1, id: 'checked', projectId: e.id, episodeId: e.episodeId, action: 'shots', actor: 'model', status: 'review_failed', startedAt: at, endedAt: at, error: '自检未通过：时长不符', nodes: [node('n0', 'execute')], artifacts: [] })
  await write('tasks', { schemaVersion: 1, id: 'stopped', projectId: e.id, episodeId: e.episodeId, action: 'film', actor: 'model', status: 'interrupted', startedAt: at, endedAt: at, error: '服务重启', nodes: [node('n0', 'execute', { status: 'interrupted' })], artifacts: [] })
  await write('artifacts', { schemaVersion: 1, id: 'a1', artifactId: 'a1', taskId: 'reviewed', nodeId: 'n1', version: 2, target: 'shots', content: [] })
  const history = recordStore(e.home, e.id)
  await assert.rejects(history.read('tasks', 'reviewed'), { code: 'OLD_TASK_RECORDS' })
  const result = await migrateTaskSteps(e.home)
  assert.equal(result.migrated, 1)
  assert.deepEqual(result.projects, [{ id: e.id, tasks: 3, artifacts: 1 }])
  await access(join(result.backup, e.id, 'tasks', 'reviewed.json'))
  const reviewed = await history.read('tasks', 'reviewed')
  assert.deepEqual(reviewed.steps.map(item => `${item.kind}:${item.status}:${item.verdict}`), ['execute:completed:null', 'generate:completed:null', 'review:completed:fail', 'revise:completed:null', 're_review:completed:pass'])
  assert.equal(reviewed.nodes, undefined)
  assert.equal(reviewed.artifacts[0].stepId, 'n1'); assert.equal('nodeId' in reviewed.artifacts[0], false)
  // 旧版本只在任务上记录的内容校验不通过，补为 check 步骤；中断记为已取消。
  const checked = await history.read('tasks', 'checked')
  assert.equal(checked.status, 'review_failed'); assert.deepEqual(checked.steps.at(-1).reasons, ['自检未通过：时长不符'])
  assert.equal((await history.read('tasks', 'stopped')).status, 'cancelled')
  assert.equal((await history.read('artifacts', 'a1')).stepId, 'n1')
  assert.deepEqual(result.statusChanged, [])
  assert.deepEqual(await migrateTaskSteps(e.home), { migrated: 0 })
})

test('a stage placeholder expands into concrete steps once its predecessors pass (reserved for whole-episode runs)', async () => {
  const plan = [{ id: 'a', kind: 'generate', target: 'shots', status: 'completed' }, { id: 'b', kind: 'stage', target: 'shots:each', status: 'pending' }, { id: 'c', kind: 'assemble', target: 'assembly', status: 'pending' }]
  const { steps } = await recordSteps(() => expandStage('shots:each', [{ kind: 'generate', target: 'storyboard:S01' }, { kind: 'generate', target: 'storyboard:S02' }]), plan)
  assert.deepEqual(steps.map(item => `${item.kind}:${item.target}:${item.status}`), ['generate:shots:completed', 'generate:storyboard:S01:pending', 'generate:storyboard:S02:pending', 'assemble:assembly:pending'])
})
