// 职责：验证各阶段重新执行、旧回执隔离和媒体版本保留。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { withConfig } from '../src/config.js'
import { createProjectStore } from '../src/server/projects/service.js'
import { createProductionWorkflow } from '../src/server/projects/production.js'
import { loadProduction } from '../src/database/managers/production.js'
import { mediaFields } from '../src/database/schemas/production.js'

const plans = [1, 2].map(n => ({ id: `segment-${n}`, scene_id: 'scene-a', description: '读者翻书', duration: 15, character_count: 1, use_previous_tail: false, tail_reason: '独立构图', materials: Object.fromEntries(mediaFields.map(k => [k, { intent: 'auto', description: '固定读者和书店', asset_ids: [] }])) }))
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'production-retry-'))
  try { await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const store = createProjectStore(), jobs = new Map(), started = []
    const deps = { resolveBackend: async () => ({ provider: 'test' }), validatePlan: async () => {}, compose: async () => ({ status: 'succeeded', url: 'https://video.example/final.mp4' }),
      start: async args => { started.push(args.generation_id); jobs.set(args.generation_id, { status: 'running' }) }, job: async id => jobs.get(id) }
    let flow = createProductionWorkflow(store, deps), p = await store.change('create', { title: '书店测试', brief: '成年读者在书店阅读' })
    p = await store.transact(p.id, value => { value.chat_session_id = 'session'; return [] })
    const act = async (name, body = {}) => p = await flow.action(name, { id: p.id, revision: p.production.revision, ...body })
    const complete = async data => p = await flow.complete({ id: p.id, request_id: p.production.request?.id, ...data }, 'session')
    await act('description', { requirements: '翻书', target_seconds: 30, aspect_ratio: '16:9', style: '自然' })
    await act('story', { text: '读者翻书。', scenes: [{ id: 'scene-a', duration: 30, description: '翻书' }] })
    for (const stage of ['segments', 'shots', 'inputs']) {
      await act('request', { stage, session_id: 'session' })
      await complete({ batch_index: 0, segments: stage === 'segments' ? plans : plans.map(s => ({ id: s.id, ...(stage === 'shots' ? { shots: [{ action: '翻书', duration: 15 }] } : { prompt: '读者在书店翻书。' }) })) })
    }
    await run({ root, store, jobs, started, act, complete, get p() { return p },
      refresh: async () => p = await flow.refresh(p.id),
      interrupt: async () => { await flow.interruptPending(); p = await store.read(p.id) },
      restart: async () => { flow = createProductionWorkflow(createProjectStore(), deps); p = await store.read(p.id) } })
  }) } finally { await rm(root, { recursive: true, force: true }) }
}

test('running, failed, cancelled and completed AI stages can restart; late batches cannot overwrite', async () => fixture(async f => {
  await f.act('request', { stage: 'shots', session_id: 'session' })
  const old = f.p.production.request.id
  const saved = structuredClone(f.p.production.segments)
  await f.act('request', { stage: 'inputs', session_id: 'session', restart: true })
  assert.notEqual(f.p.production.request.id, old)
  assert.equal(f.p.production.stage_runs.shots.status, 'cancelled')
  await assert.rejects(f.complete({ request_id: old, batch_index: 0, segments: [] }), /已过期/)
  assert.deepEqual(f.p.production.segments, saved)
  const active = f.p.production.request.id
  await assert.rejects(f.act('request', { stage: 'shots', segment_id: 'missing', session_id: 'session', restart: true }), /不存在/)
  await assert.rejects(f.act('request', { stage: 'story', session_id: 'foreign', restart: true }), /关联会话/)
  assert.equal((await f.store.read(f.p.id)).production.request.id, active)
  await f.act('request-error', { request_id: active, error: '连接中断' })
  await f.restart()
  assert.equal(f.p.production.stage_runs.inputs.status, 'failed')
  assert.equal(f.p.production.request.revision, f.p.production.revision)
  await f.act('request', { stage: 'inputs', session_id: 'session', restart: true })
  await f.act('cancel-request')
  assert.equal(f.p.production.stage_runs.inputs.status, 'cancelled')
  await f.act('request', { stage: 'inputs', session_id: 'session', restart: true })
  await f.complete({ batch_index: 0, segments: plans.map(s => ({ id: s.id, prompt: '新版阅读画面。' })) })
  assert.equal(f.p.production.stage_runs.inputs.status, 'succeeded')
  assert.equal(f.p.production.segments[0].inputs.length, 2)
}))

test('running video queues and compositions can restart without replacing previous successful versions', async () => fixture(async f => {
  await f.act('submit'); await f.refresh()
  const oldJob = f.started[0], oldQueue = f.p.production.queue.id
  await f.act('submit', { restart: true, regenerate: true })
  assert.notEqual(f.p.production.queue.id, oldQueue)
  assert.equal(f.p.production.segments[0].generations[0].status, 'superseded')
  f.jobs.set(oldJob, { status: 'succeeded', result: { video_url: 'https://video.example/old.mp4' } })
  for (let i = 0; i < 2; i++) {
    await f.refresh()
    const job = f.p.production.queue.items[i].job_id
    f.jobs.set(job, { status: 'succeeded', result: { video_url: `https://video.example/${i}.mp4`, duration_sec: 15 } })
    await f.refresh()
  }
  assert.equal(f.p.production.queue.status, 'complete')
  assert.ok(f.p.production.segments.every(s => s.generations.find(g => g.id === s.selected_generation)?.status === 'succeeded'))
  await f.act('compose', { episode_count: 1 })
  const replaced = f.p.production.exports[0].id
  await f.act('compose', { episode_count: 2, restart: true })
  assert.equal(f.p.production.exports.find(e => e.id === replaced).status, 'superseded')
  await f.refresh(); await f.refresh()
  assert.equal(f.p.production.exports.filter(e => e.status === 'succeeded').length, 2)
  await f.act('compose', { episode_count: 1, restart: true })
  assert.equal(f.p.production.exports.filter(e => e.status === 'succeeded').length, 2)
  const projectDir = join(f.root, 'projects', f.p.id), metadata = JSON.parse(await readFile(join(projectDir, 'project.json')))
  await f.act('request', { stage: 'segments', session_id: 'session', restart: true })
  await f.complete({ batch_index: 0, segments: plans })
  assert.equal(f.p.production.segments.length, 2)
  assert.equal(f.p.production.segments[0].generations.length, 0)
  assert.equal((await loadProduction(projectDir, metadata.production_snapshot)).segments[0].generations.length, 2)
}))

test('invalid retries preserve the running queue and description changes invalidate old AI requests', async () => fixture(async f => {
  await f.act('submit'); await f.refresh()
  const queue = structuredClone(f.p.production.queue)
  await assert.rejects(f.act('compose', { restart: true, episode_count: 1 }), /尚未完成/)
  assert.deepEqual((await f.store.read(f.p.id)).production.queue, queue)
  await f.act('request', { stage: 'story', restart: true, session_id: 'session' })
  const old = f.p.production.request.id
  assert.equal(f.p.production.queue.status, 'cancelled')
  await f.act('description', { restart: true, requirements: '新的阅读要求', target_seconds: 45, aspect_ratio: '16:9', style: '自然' })
  await assert.rejects(f.complete({ request_id: old, text: '旧剧情', scenes: [] }), /已过期/)
  await assert.rejects(f.act('submit', { restart: true, regenerate: true }), /最新剧情/)
  assert.equal(f.p.production.requirements, '新的阅读要求')
}))

test('Harness startup marks interrupted requests and queues without automatically submitting work', async () => fixture(async f => {
  await f.act('request', { stage: 'inputs', session_id: 'session' })
  const id = f.p.production.request.id
  await f.interrupt(); await f.restart()
  assert.equal(f.p.production.stage_runs.inputs.status, 'interrupted')
  assert.equal(f.p.production.request.interrupted, true)
  await assert.rejects(f.complete({ batch_index: 0, segments: plans.map(s => ({ id: s.id, prompt: '新版' })) }), /生成已中断/)
  await f.act('resume-request', { request_id: id, session_id: 'session' })
  assert.equal(f.p.production.request.id, id)
  await f.complete({ batch_index: 0, segments: plans.map(s => ({ id: s.id, prompt: '新版' })) })
  await f.act('submit')
  await f.interrupt(); await f.refresh(); await f.refresh()
  assert.equal(f.p.production.queue.status, 'interrupted')
  assert.equal(f.started.length, 0, 'opening a project after startup must not submit its pending queue')
  await f.act('submit', { restart: true, regenerate: true }); await f.refresh()
  assert.equal(f.started.length, 1)
}))
