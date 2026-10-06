import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunEngine } from '../server/flow/runs/run-engine.js'
import { runStore } from '../server/data/run-store.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const tick = () => new Promise(resolve => setImmediate(resolve))
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)) }
  assert.fail('等待执行条件超时')
}
const step = (id, after = [], extra = {}) => ({ id, key: `generate@${id}`, target: id, kind: 'generate', scope: 'episode', queue: 'text', actor: 'model', after, ...extra })
async function setup(t, execute, options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'meiji-run-engine-'))
  const engine = createRunEngine({ home, execute, limitOf: () => 4, ...options })
  t.after(async () => { await engine.dispose(); await rm(home, { recursive: true, force: true }) })
  const create = (steps, episodeId = 'episode', extra = {}) => engine.create({ projectId: 'project', episodeId, goal: { to: 'film' }, steps, ...extra })
  const start = async (steps, episodeId, extra) => { const run = await create(steps, episodeId, extra); await engine.confirm(run.projectId, run.id); return run }
  return { engine, home, create, start, get: run => engine.get(run.projectId, run.id) }
}

test('expand 展开新步骤后依赖改接到全部末端，标识与历史互不覆盖', async t => {
  const seen = [], e = await setup(t, async (_, current) => {
    seen.push(current.target)
    if (current.kind === 'expand') return { steps: [step('first'), step('second', ['first'])] }
    return {}
  })
  const run = await e.start([step('first', [], { kind: 'expand', key: 'expand@seconds', target: 'expand' }), step('last', ['first'])])
  await e.engine.drain()
  assert.deepEqual(seen, ['expand', 'first', 'second', 'last'])
  const saved = await e.get(run)
  assert.equal(saved.status, 'completed'); assert.equal(new Set(saved.steps.map(item => item.id)).size, 4)
  assert.ok(saved.events.some(item => item.type === 'expanded'))
})

test('前置只暂停依赖分支，确认事件唤醒等待步骤，执行失败仍需人工 retry', async t => {
  let ready = false; const seen = []
  const e = await setup(t, async (_, current) => { seen.push(current.id); return {} }, { beforeStep: async (_, current) => current.target === 'blocked' && !ready ? { pause: { code: 'prereq_required', message: '需确认', actions: ['authorize', 'cancel-branch'] } } : null })
  const run = await e.start([step('blocked'), step('free')]); await e.engine.drain()
  assert.deepEqual(seen, ['free']); assert.equal((await e.get(run)).status, 'paused')
  ready = true; e.engine.wake(); await e.engine.drain()
  assert.deepEqual(seen, ['free', 'blocked']); assert.equal((await e.get(run)).status, 'completed')
})

test('追加意见作废原对象并保留失败历史，新步骤完成后依赖继续同一任务', async t => {
  let failure = true
  const e = await setup(t, async (_, current) => { if (current.target === 'old' && failure) throw new Error('初次失败'); return {} })
  const run = await e.start([step('old'), step('downstream', ['old'])]); await e.engine.drain()
  failure = false
  await e.engine.insert('project', run.id, { targets: ['old'], steps: [step('replacement', [], { target: 'old', key: 'revise@old', kind: 'revise' })] })
  await e.engine.drain(); const saved = await e.get(run)
  assert.equal(saved.id, run.id); assert.equal(saved.status, 'completed')
  assert.equal(saved.steps.find(item => item.id === 'old').status, 'superseded')
  assert.equal(saved.steps.find(item => item.id === 'old').error, '初次失败')
  assert.ok(saved.steps.some(item => item.origin === 'user-feedback'))
})

test('S2 失败只暂停该分支，S1/S3 完成，retry 同 Run 完成并保留两次响应', async t => {
  let failed = false
  const seen = [], e = await setup(t, async (run, current, { record }) => {
    seen.push(current.id)
    await record('responses', { text: current.id })
    if (current.id === 'S2' && !failed) { failed = true; throw new Error('视频下载失败') }
    return { text: current.id }
  })
  const run = await e.start([step('S1'), step('S2'), step('tail2', ['S2']), step('S3')])
  await e.engine.drain()
  let current = await e.get(run)
  assert.equal(current.status, 'paused'); assert.equal(current.endedAt, null)
  assert.deepEqual(current.steps.map(item => item.status), ['done', 'paused', 'pending', 'done'])
  assert.deepEqual(seen, ['S1', 'S2', 'S3'])
  await e.engine.resume('project', run.id, { action: 'retry', stepId: 'S2' })
  await e.engine.drain(); current = await e.get(run)
  assert.equal(current.status, 'completed'); assert.ok(current.endedAt)
  assert.equal(current.events.filter(item => item.type === 'completed').length, 1)
  assert.equal((await runStore(e.home, 'project').records(run.id, 'S2', 'responses')).length, 2)
})

test('自动审核最多修订两轮且下游改接到最后复审，override 留痕后继续', async t => {
  const kinds = [], e = await setup(t, async (run, current) => {
    kinds.push(current.kind)
    return ['review', 're_review'].includes(current.kind) ? { passed: false, issues: [{ reason: '未满足要求' }] } : { text: '正文' }
  })
  const run = await e.start([step('generate'), step('review', ['generate'], { kind: 'review' }), step('video', ['review'], { kind: 'video' })])
  await e.engine.drain()
  let current = await e.get(run)
  assert.deepEqual(kinds, ['generate', 'review', 'revise', 're_review', 'revise', 're_review'])
  assert.equal(current.status, 'paused')
  assert.equal(current.pause.reasons[0].code, 'review_exhausted')
  const last = current.steps.at(-1)
  assert.equal(last.round, 2)
  assert.deepEqual(current.steps.find(item => item.id === 'video').after, [last.id])
  await assert.rejects(e.engine.resume('project', run.id, { action: 'retry', stepId: last.id }), { code: 'RUN_ACTION_INVALID' })
  await e.engine.resume('project', run.id, { action: 'override', stepId: last.id })
  await e.engine.drain(); current = await e.get(run)
  assert.equal(current.status, 'completed')
  assert.equal(current.steps.filter(item => item.kind === 'override').length, 1)
  assert.equal(current.steps.find(item => item.id === last.id).output.passed, false)
  assert.equal(kinds.at(-1), 'video')
})

test('复审通过后继续；协议错误是执行暂停，不触发内容修订', async t => {
  const e = await setup(t, async (run, current) => current.kind === 'review' ? { passed: false } : current.kind === 're_review' ? { passed: true } : {})
  const run = await e.start([step('review', [], { kind: 'review' }), step('next', ['review'])])
  await e.engine.drain()
  assert.equal((await e.get(run)).status, 'completed')
  assert.equal((await e.get(run)).steps.filter(item => item.kind === 'revise').length, 1)
  const other = createRunEngine({ home: e.home, execute: async () => ({}), limitOf: () => 4 })
  const bad = await other.create({ projectId: 'project', episodeId: 'other', steps: [step('bad', [], { kind: 'review' })] })
  await other.confirm('project', bad.id); await other.drain()
  assert.equal((await other.get('project', bad.id)).pause.reasons[0].code, 'step_failed')
  assert.equal((await other.get('project', bad.id)).steps.length, 1)
  await other.dispose()
})

test('不同集并行，同一对象步骤互斥，项目级步骤冲突排队等待', async t => {
  const gates = new Map(), seen = []
  const e = await setup(t, async (run, current) => {
    seen.push(current.id); const gate = deferred(); gates.set(current.id, gate); await gate.promise; return {}
  })
  const a = await e.start([step('a'), step('a2', [], { target: 'a' })], 'ep1')
  await until(() => gates.has('a'))
  const b = await e.start([step('b')], 'ep2')
  await until(() => gates.has('b'))
  const project = await e.start([step('global', [], { scope: 'project' })], null)
  await until(async () => (await e.get(project)).steps[0].status === 'ready')
  assert.deepEqual(seen, ['a', 'b'])
  assert.equal((await e.get(a)).steps[1].status, 'ready')
  gates.get('a').resolve(); await until(() => gates.has('a2'))
  assert.ok(!gates.has('global'))
  gates.get('a2').resolve(); gates.get('b').resolve()
  await until(() => gates.has('global')); gates.get('global').resolve()
  await e.engine.drain()
  for (const run of [a, b, project]) assert.equal((await e.get(run)).status, 'completed')
})

test('全局队列限流，锁冲突不会额外占模型槽位', async t => {
  const gate = deferred(), started = [], e = await setup(t, async (run, current) => { started.push(current.id); await gate.promise; return {} }, { limitOf: () => 1 })
  const a = await e.start([step('a'), step('a2')], 'one')
  const b = await e.start([step('b')], 'two')
  await until(() => started.length === 1)
  await until(async () => (await e.get(b)).steps[0].status === 'ready')
  assert.deepEqual(started, ['a'])
  gate.resolve(); await e.engine.drain()
  assert.equal(started.length, 3)
  assert.equal((await e.get(a)).status, 'completed'); assert.equal((await e.get(b)).status, 'completed')
})

test('用户暂停允许当前执行收尾，后续不启动；resume 再执行', async t => {
  const gate = deferred(), seen = [], e = await setup(t, async (run, current) => { seen.push(current.id); if (current.id === 'a') await gate.promise; return {} })
  const run = await e.start([step('a'), step('b', ['a'])])
  await until(() => seen.length === 1)
  await e.engine.pause('project', run.id)
  gate.resolve(); await e.engine.drain()
  assert.deepEqual(seen, ['a']); assert.equal((await e.get(run)).status, 'paused')
  await e.engine.resume('project', run.id, { action: 'resume' }); await e.engine.drain()
  assert.deepEqual(seen, ['a', 'b']); assert.equal((await e.get(run)).status, 'completed')
})

test('取消不会提前释放仍运行步骤的锁，晚到结果不会恢复已取消任务', async t => {
  const gate = deferred(), seen = [], e = await setup(t, async (run, current) => { seen.push(current.id); if (current.id === 'old') await gate.promise; return { text: '晚到结果' } })
  const old = await e.start([step('old')])
  await until(() => seen.length === 1)
  await e.engine.cancel('project', old.id)
  const next = await e.start([step('next', [], { target: 'old' })])
  await until(async () => (await e.get(next)).steps[0].status === 'ready')
  assert.deepEqual(seen, ['old'])
  gate.resolve(); await e.engine.drain()
  assert.deepEqual(seen, ['old', 'next'])
  assert.equal((await e.get(old)).status, 'cancelled')
  assert.equal((await e.get(old)).steps[0].output, undefined)
  assert.equal((await e.get(next)).status, 'completed')
})

test('取消分支连带取消下游，独立分支完成；不能把取消视为跳过', async t => {
  const seen = [], e = await setup(t, async (run, current) => { seen.push(current.id); if (current.id === 'bad') throw new Error('失败'); return {} })
  const run = await e.start([step('bad'), step('after', ['bad']), step('good')])
  await e.engine.drain()
  await e.engine.cancel('project', run.id, 'bad'); await e.engine.drain()
  const current = await e.get(run)
  assert.deepEqual(seen, ['bad', 'good'])
  assert.deepEqual(current.steps.map(item => item.status), ['cancelled', 'cancelled', 'done'])
  assert.equal(current.status, 'cancelled')
})

test('amend 语义去重并改接到已有 stepId，原草稿不自动执行', async t => {
  const seen = [], e = await setup(t, async (run, current) => { seen.push(current.id); if (current.id === 'a') throw new Error('需暂停'); return {} })
  const run = await e.create([step('a')])
  await e.engine.amend('project', run.id, { steps: [step('alias', [], { key: 'generate@a' }), step('b', ['alias'])] })
  await e.engine.drain(); assert.deepEqual(seen, [])
  let current = await e.get(run)
  assert.equal(current.steps.length, 2); assert.deepEqual(current.steps[1].after, ['a'])
  await e.engine.confirm('project', run.id); await e.engine.drain()
  await e.engine.amend('project', run.id, { steps: [step('duplicate', [], { key: 'generate@a' }), step('b', ['duplicate']), step('c')] })
  await e.engine.drain(); current = await e.get(run)
  assert.equal(current.steps.length, 3)
  assert.deepEqual(seen, ['a', 'c'])
  await e.engine.cancel('project', run.id)
})

test('恢复中断后独立分支仍可执行，中断步骤只在用户 retry 后续跑', async t => {
  const seen = [], e = await setup(t, async (run, current) => { seen.push(current.id); return {} })
  const run = await e.create([step('interrupted'), step('after', ['interrupted']), step('other')])
  await runStore(e.home, 'project').update(run.id, current => { current.events.push({ type: 'confirmed' }); current.steps[0].status = 'running'; return current })
  await e.engine.recover('project'); await e.engine.drain()
  assert.deepEqual(seen, ['other'])
  assert.equal((await e.get(run)).pause.reasons[0].code, 'interrupted')
  await e.engine.resume('project', run.id, { action: 'retry', stepId: 'interrupted' }); await e.engine.drain()
  assert.deepEqual(seen, ['other', 'interrupted', 'after'])
  assert.equal((await e.get(run)).status, 'completed')
})

test('观察者抛错不改变已经提交的结果；无法继续操作终态任务', async t => {
  const e = await setup(t, async () => ({}), { onChange: () => { throw new Error('断开的观察者') } })
  const run = await e.start([step('a')]); await e.engine.drain()
  assert.equal((await e.get(run)).status, 'completed')
  await assert.rejects(e.engine.amend('project', run.id, { steps: [step('b')] }), { code: 'RUN_ACTION_INVALID' })
})

test('系统前置由步骤检查插入：本步骤等待前置完成后再执行，并发检查复用同一前置', async t => {
  const order = []; let fresh = false
  const prerequisite = [{ id: 'p1', key: 'generate@project-summary', kind: 'generate', target: 'project-summary', scope: 'project', queue: 'text', actor: 'model', after: [] },
    { id: 'p2', key: 'review@project-summary', kind: 'review', target: 'project-summary', scope: 'project', queue: 'text', actor: 'model', after: ['p1'] }]
  const home = await (await import('./fixtures/model.js')).tempHome(t)
  const engine = createRunEngine({ home, beforeStep: async (_run, step) => !fresh && ['characters', 'scenes'].includes(step.target) ? { insert: prerequisite } : null,
    execute: async (_run, step) => { order.push(`${step.kind}@${step.target}`); if (step.key === 'review@project-summary') fresh = true; return { passed: true } } })
  t.after(() => engine.dispose())
  const step = target => ({ id: target, key: `generate@${target}`, kind: 'generate', target, scope: 'project', queue: 'text', actor: 'model', after: [] })
  const run = await engine.create({ projectId: 'project', episodeId: 'episode', steps: [step('characters'), step('scenes')] })
  await engine.confirm('project', run.id); await engine.drain()
  const done = await engine.get('project', run.id)
  assert.equal(done.status, 'completed')
  assert.deepEqual(order.slice(0, 2), ['generate@project-summary', 'review@project-summary'])
  assert.deepEqual(order.slice(2).sort(), ['generate@characters', 'generate@scenes'])
  assert.equal(done.steps.filter(item => item.target === 'project-summary').length, 2)
  assert.ok(done.steps.filter(item => item.target === 'project-summary').every(item => item.origin === 'prereq'))
})
