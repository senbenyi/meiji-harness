import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setupModel } from './fixtures/model.js'
import { outlineFixture } from './fixtures/story-package.js'
import { reviewPass } from './fixtures/review-result.js'
import { createRunEngine } from '../server/flow/runs/run-engine.js'
import { planRun } from '../shared/run-planner.js'
async function planOperationRun(e, goal) { return { episodeId: e.episodeId, ...planRun(await e.read(), { ...goal, mode: 'regenerate' }) } }
import { executeRunStep } from '../server/flow/shared/task-executor.js'
import { runStore } from '../server/data/run-store.js'

test('真实大纲职责单步生成与审核，快照只归 Run/Step，不创建旧任务历史', async t => {
  const e = await setupModel(t), calls = []
  const engine = createRunEngine({ home: e.home, execute: (run, step, deps) => executeRunStep(run, step, { ...deps, home: e.home, request: async message => { calls.push(message.skill); return message.skill === 'review' ? reviewPass : JSON.stringify(outlineFixture('Run 生成大纲')) } }) })
  const plan = await planOperationRun(e, { to: 'story', scope: { only: 'outline' } })
  assert.deepEqual(plan.steps.map(step => step.kind), ['generate', 'review'])
  const run = await engine.create({ projectId: e.id, ...plan })
  await engine.confirm(e.id, run.id); await engine.drain()
  const saved = await engine.get(e.id, run.id)
  assert.equal(saved.status, 'completed', JSON.stringify(saved.pause))
  assert.equal((await e.read()).plot.outline.check.passed, true)
  const records = runStore(e.home, e.id)
  for (const step of saved.steps) {
    assert.ok((await records.records(run.id, step.id, 'prompts')).length)
    const artifacts = await records.records(run.id, step.id, 'artifacts')
    assert.ok(artifacts.every(item => item.runId === run.id && item.stepId === step.id && !Object.hasOwn(item, 'taskId')))
  }
  assert.equal((await e.read()).plot.outline.source.runId, run.id)
  const kinds = await readdir(join(e.home, 'storages/meiji/projects', e.id, 'history'))
  assert.ok(!kinds.includes('tasks')); assert.ok(!kinds.includes('operations'))
  assert.deepEqual(calls, ['outline', 'review'])
  await engine.dispose()
})

test('真实审核失败触发修订，意见进入修订请求并保留业务输入到复审', async t => {
  const e = await setupModel(t), requests = []
  let reviews = 0
  const engine = createRunEngine({ home: e.home, execute: (run, step, deps) => executeRunStep(run, step, { ...deps, home: e.home, request: async message => {
    requests.push(message)
    if (message.skill === 'review') return ++reviews === 1 ? JSON.stringify({ passed: false, issues: [{ location: '转折', reason: '缺少冲突变化', requirement: '补充明确转折' }] }) : reviewPass
    return JSON.stringify(outlineFixture(reviews ? '修订后的冲突' : '原始冲突'))
  } }) })
  const plan = await planOperationRun(e, { to: 'story', scope: { only: 'outline' } })
  const run = await engine.create({ projectId: e.id, ...plan })
  await engine.confirm(e.id, run.id); await engine.drain()
  const saved = await engine.get(e.id, run.id)
  assert.equal(saved.status, 'completed', JSON.stringify(saved.pause))
  assert.deepEqual(saved.steps.map(step => step.kind), ['generate', 'review', 'revise', 're_review'])
  assert.equal(saved.steps[2].input.taskType, 'outline')
  assert.match(JSON.stringify(requests[2]), /缺少冲突变化/)
  assert.equal((await e.read()).plot.outline.check.passed, true)
  await engine.dispose()
})

test('规划器按镜头生成独立成片分支并拆分视频和尾帧，输入锁由服务端推导', async t => {
  const e = await setupModel(t)
  const plan = await planOperationRun(e, { to: 'film' })
  assert.deepEqual(plan.steps.map(step => step.kind), ['storyboard', 'video', 'tail', 'storyboard', 'video', 'tail'])
  assert.deepEqual(plan.steps[3].after, [])
  assert.equal(plan.steps[1].input.operation.runVideoOnly, true)
  assert.equal(plan.steps[2].input.operation.parts, 'tail')
  assert.equal(plan.steps[0].actor, 'program')
  assert.ok(plan.steps.every(step => step.scope === 'episode'))
})

test('真实视频职责完成后才释放 video 步骤，尾帧在独立 tail 步骤执行', async t => {
  const e = await setupModel(t), states = [], tails = []
  const engine = createRunEngine({ home: e.home, onChange: run => { states.push(run.steps.map(step => [step.kind, step.status])) }, execute: (run, step, deps) => executeRunStep(run, step, {
    ...deps, home: e.home,
    submitH3: async ({ items }) => ({ baseUrl: 'http://video.test', shots: items.map(item => ({ ...item, promptId: item.track })) }),
    retrieveGatewayVideo: async () => Buffer.from('video'),
    saveLastFrame: async input => { tails.push(input); return Buffer.from('frame') },
  }) })
  const plan = await planOperationRun(e, { to: 'film', scope: { tracks: ['S01'] }, parts: 'video' })
  const run = await engine.create({ projectId: e.id, ...plan })
  await engine.confirm(e.id, run.id); await engine.drain()
  const saved = await engine.get(e.id, run.id)
  assert.equal(saved.status, 'completed', JSON.stringify(saved.pause))
  assert.equal(tails.length, 1)
  assert.ok(states.some(value => value[0][1] === 'done' && value[1][1] === 'pending'))
  const shot = (await e.read()).shots.items[0]
  assert.equal(shot.video.content.status, 'ready'); assert.equal(shot.tailFrame.status, 'passed')
  assert.equal(shot.video.source.stepId, saved.steps[0].id)
  await engine.dispose()
})

test('真实网关调用保存原始响应并沿用密钥与 Base64 脱敏', async t => {
  const e = await setupModel(t)
  const engine = createRunEngine({ home: e.home, execute: (run, step, deps) => executeRunStep(run, step, {
    ...deps, home: e.home, fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body), reviewing = ['review', 're_review'].includes(step.kind)
      assert.equal(request.response_format.type, 'json_object')
      return new Response(JSON.stringify({ api_key: '不可出现在记录中的密钥', b64_json: 'AAAA', choices: [{ message: { content: reviewing ? reviewPass : JSON.stringify(outlineFixture('HTTP 生成稿')) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  }) })
  const plan = await planOperationRun(e, { to: 'story', scope: { only: 'outline' } })
  const run = await engine.create({ projectId: e.id, ...plan })
  await engine.confirm(e.id, run.id); await engine.drain()
  const saved = await engine.get(e.id, run.id)
  assert.equal(saved.status, 'completed', JSON.stringify(saved.pause))
  const records = runStore(e.home, e.id)
  for (const step of saved.steps) {
    const responses = await records.records(run.id, step.id, 'responses')
    assert.equal(responses.length, 1)
    assert.equal(responses[0].body.api_key, '[已隐藏]')
    assert.match(responses[0].body.b64_json, /base64 图片/)
    assert.ok(!JSON.stringify(responses).includes('不可出现在记录中的密钥'))
  }
  await engine.dispose()
})
