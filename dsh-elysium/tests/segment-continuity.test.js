// 职责：验证尾帧依赖、真实提交计划冻结和失败恢复，不启动模型。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig } from '../src/config.js'
import { createProjectStore } from '../src/server/projects/service.js'
import { createProductionWorkflow } from '../src/server/projects/production.js'
import { mediaFields, segmentValues } from '../src/database/schemas/production.js'
import { extractTailFrameRemote } from '../src/models/protocols/ssh-media/tail-frame.js'

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'segment-tail-'))
  try { await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const store = createProjectStore(), starts = [], frames = [], jobs = new Map(), backend = { provider: 'test', service: 'comfyui' }
    const deps = { resolveBackend: async () => backend, validatePlan: async (_, plan) => { if (plan.mode === 'i2va') assert.match(plan.first_frame, /^https:/) },
      start: async args => { const { project_id, segment_id, generation_id, ...plan } = args; const saved = await store.read(project_id); assert.deepEqual(saved.production.queue.items.find(i => i.job_id === generation_id).plan, plan); starts.push(args); jobs.set(generation_id, { status: 'running' }) }, job: async id => jobs.get(id),
      tailFrame: async (backend, source) => { frames.push({ backend, source }); return { url: `https://media.test/${source.job_id}.png` } } }
    let flow = createProductionWorkflow(store, deps), p = await store.change('create', { title: '连续动作', duration_min: 1 })
    const act = async (name, body = {}) => p = await flow.action(name, { id: p.id, revision: p.production.revision, ...body })
    const generate = async (stage, data) => {
      await act('request', { stage, session_id: 'session' })
      const context = await flow.context(p.id, p.production.request.id, 'session')
      p = await flow.complete({ id: p.id, request_id: p.production.request.id, ...data }, 'session')
      return context
    }
    await act('description', { requirements: '书店连续相遇', style: '写实', aspect_ratio: '9:16', target_seconds: 10 })
    await generate('story', { text: '相遇', scenes: [{ id: 'scene-a', description: '书店', duration: 10 }] })
    await generate('segments', { segments: [1, 2].map(n => ({ id: `segment-${n}`, scene_id: 'scene-a', title: `片段${n}`, description: '走近', duration: 5, character_count: 2, use_previous_tail: n > 1, tail_reason: n === 1 ? '第一段无上一段' : '同一时空，继续走近，构图与位置连续', end_state: '相对而立', materials: Object.fromEntries(mediaFields.map(k => [k, { description: '参考', intent: 'auto', asset_ids: [] }])) })) })
    const context = await generate('shots', { segments: p.production.segments.map(s => ({ id: s.id, shots: [{ duration: 5, action: '继续走近' }] })) })
    // 即使后续 AI 返回了 t2va，已规划的尾帧衔接也必须落到 i2va。
    await generate('inputs', { segments: p.production.segments.map(s => ({ id: s.id, prompt: '连续走近', mode: 't2va' })) })
    const refresh = async () => p = await flow.refresh(p.id)
    const succeed = index => { const item = p.production.queue.items[index]; jobs.set(item.job_id, { status: 'succeeded', result: { comfyui_view_url: `https://media.test/${item.job_id}.mp4`, duration_sec: 5 } }) }
    await run({ store, starts, frames, jobs, deps, context, act, generate, refresh, succeed, get: () => p, restart: () => { flow = createProductionWorkflow(createProjectStore(), deps) } })
  }) } finally { await rm(root, { recursive: true, force: true }) }
}

test('AI continuity decision persists, rejects first segment and enters AI context and H3 input', () => fixture(async f => {
  const p = f.get(), [first, second] = p.production.segments
  assert.equal(first.use_previous_tail, false); assert.equal(second.use_previous_tail, true)
  assert.equal(f.context.segments[1].previous_segment.end_state, '相对而立')
  assert.equal(f.context.segments[0].previous_segment, undefined)
  assert.equal(second.inputs[0].plan.mode, 'i2va'); assert.equal(second.inputs[0].plan.first_frame, undefined)
  assert.deepEqual(second.inputs[0].first_frame_source, { type: 'previous_tail', segment_id: first.id })
  assert.equal((await f.store.read(p.id)).production.segments[1].use_previous_tail, true)
  assert.equal((await f.store.read(p.id)).production.segments[1].tail_reason, second.tail_reason)
  assert.equal(f.context.segments[1].tail_reason, second.tail_reason)
  await f.act('segment', { segment_id: second.id, patch: { title: '连续走近' } })
  assert.equal(f.get().production.segments[1].tail_reason, second.tail_reason)
  await assert.rejects(f.act('segment', { segment_id: first.id, patch: { use_previous_tail: true } }), /第一个/)
  assert.throws(() => segmentValues([{ ...first, use_previous_tail: 'false' }], p.production), /布尔/)
  await f.act('segment', { segment_id: second.id, patch: { use_previous_tail: false, tail_reason: '改为切到另一机位' } })
  assert.equal(f.get().production.segments[1].use_previous_tail, false)
  assert.equal(f.get().production.segments[1].shots_revision, null)
}))

test('AI segment planning requires an explicit continuity decision and reason before saving', async () => {
  const root = await mkdtemp(join(tmpdir(), 'segment-tail-contract-'))
  try { await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const store = createProjectStore(), flow = createProductionWorkflow(store)
    let p = await store.change('create', { title: '自动判断衔接' })
    const act = async (name, body) => p = await flow.action(name, { id: p.id, revision: p.production.revision, ...body })
    await act('description', { requirements: '书店走近，然后切到室外', aspect_ratio: '9:16', target_seconds: 15 })
    await act('story', { text: '走近后切到室外', scenes: [{ id: 'scene-a', description: '书店', duration: 10 }, { id: 'scene-b', description: '次日室外', duration: 5 }] })
    await act('request', { stage: 'segments', session_id: 'session' })
    const context = await flow.context(p.id, p.production.request.id, 'session')
    assert.match(context.instructions, /use_previous_tail\/tail_reason/)
    assert.match(context.instructions, /不要仅按 Scene ID 是否相同判断/)
    const segments = [1, 2, 3].map(n => ({ id: `segment-${n}`, scene_id: n < 3 ? 'scene-a' : 'scene-b', duration: 5, description: n < 3 ? '连续走近' : '次日室外', character_count: 2,
      use_previous_tail: n === 2, tail_reason: ['首段没有上一段', '同一时空，动作与构图连续', '次日室外独立起镜'][n - 1], materials: Object.fromEntries(mediaFields.map(k => [k, { description: '具体描述', intent: 'auto', asset_ids: [] }])) }))
    for (const patch of [{ use_previous_tail: undefined }, { use_previous_tail: 'true' }, { tail_reason: undefined }, { tail_reason: '  ' }]) {
      const incomplete = structuredClone(segments); Object.assign(incomplete[1], patch)
      await assert.rejects(flow.complete({ id: p.id, request_id: p.production.request.id, segments: incomplete }, 'session'), /use_previous_tail.*tail_reason/)
      const unchanged = await store.read(p.id)
      assert.equal(unchanged.production.request.id, p.production.request.id); assert.equal(unchanged.production.segments.length, 0)
    }
    const invalidFirst = structuredClone(segments); invalidFirst[0].use_previous_tail = true
    await assert.rejects(flow.complete({ id: p.id, request_id: p.production.request.id, segments: invalidFirst }, 'session'), /第一个 Segment/)
    await flow.complete({ id: p.id, request_id: p.production.request.id, segments }, 'session')
    p = await store.read(p.id)
    assert.deepEqual(p.production.segments.map(s => s.use_previous_tail), [false, true, false])
    assert.deepEqual(p.production.segments.map(s => s.tail_reason), segments.map(s => s.tail_reason))
    assert.equal(p.production.request, null)
  }) } finally { await rm(root, { recursive: true, force: true }) }
})

test('batch binds actual predecessor tail before launch and survives extraction failure and restart', () => fixture(async f => {
  let failFrame = true, original = f.deps.tailFrame
  f.deps.tailFrame = async (...args) => { if (failFrame) throw new Error('抽帧中断'); return original(...args) }; f.restart()
  await f.act('submit'); await f.refresh(); await f.refresh()
  assert.equal(f.starts.length, 1); assert.equal(f.frames.length, 0)
  f.succeed(0); await f.refresh(); await f.refresh()
  assert.equal(f.get().production.queue.status, 'paused'); assert.match(f.get().production.queue.error, /抽帧中断/)
  assert.equal(f.starts.length, 1)
  const nextJob = f.get().production.queue.items[1].job_id
  failFrame = false; f.restart(); await f.act('resume'); await f.refresh()
  assert.equal(f.starts.length, 2); assert.equal(f.starts[1].generation_id, nextJob)
  assert.equal(f.starts[1].mode, 'i2va'); assert.equal(f.starts[1].first_frame, f.get().production.queue.items[1].plan.first_frame)
  const source = f.get().production.segments[1].generations[0].first_frame
  assert.equal(source.generation_id, f.starts[0].generation_id)
  assert.equal(f.frames[0].source.job_id, source.generation_id)
  assert.deepEqual(f.frames[0].backend, f.get().production.segments[0].inputs[0].backend)
  f.restart(); await f.refresh(); assert.equal(f.frames.length, 1); assert.equal(f.starts.length, 2)
  f.succeed(1); await f.refresh(); assert.equal(f.get().production.queue.status, 'complete')
  assert.equal(f.get().production.segments[1].tail_stale, false)
}))

test('single submit requires an approved predecessor and uses its selected version', () => fixture(async f => {
  await assert.rejects(f.act('submit', { segment_id: 'segment-2' }), /上一段.*当前审核视频/)
  await f.act('submit', { segment_id: 'segment-1' }); await f.refresh(); f.succeed(0); await f.refresh()
  await f.act('submit', { segment_id: 'segment-2' }); await f.refresh()
  assert.equal(f.get().production.queue.items.length, 1)
  assert.equal(f.get().production.queue.items[0].first_frame_source.generation_id, f.starts[0].generation_id)
  assert.equal(f.starts[1].mode, 'i2va')
}))

test('launch retry reuses the frozen tail and reserved generation id', () => fixture(async f => {
  let failLaunch = true; const start = f.deps.start
  f.deps.start = async args => { if (args.segment_id === 'segment-2' && failLaunch) throw new Error('启动中断'); return start(args) }; f.restart()
  await f.act('submit'); await f.refresh(); f.succeed(0); await f.refresh(); await f.refresh()
  assert.equal(f.get().production.queue.status, 'paused'); assert.equal(f.frames.length, 1)
  const pending = structuredClone(f.get().production.queue.items[1])
  failLaunch = false; f.restart(); await f.act('resume'); await f.refresh()
  assert.equal(f.frames.length, 1); assert.equal(f.starts[1].generation_id, pending.job_id)
  assert.equal(f.starts[1].first_frame, pending.plan.first_frame)
}))

test('new predecessor version invalidates dependent output and batch regenerates it', () => fixture(async f => {
  await f.act('submit'); await f.refresh(); f.succeed(0); await f.refresh(); await f.refresh(); f.succeed(1); await f.refresh()
  await f.act('submit', { segment_id: 'segment-1', regenerate: true }); await f.refresh(); f.succeed(0); await f.refresh()
  assert.equal(f.get().production.segments[1].tail_stale, true)
  await assert.rejects(f.act('compose', { episode_count: 1 }), /尚未完成/)
  await f.act('submit'); assert.equal(f.get().production.queue.items.length, 1)
  assert.equal(f.get().production.queue.items[0].segment_id, 'segment-2')
  await f.refresh(); assert.equal(f.frames.at(-1).source.job_id, f.starts[2].generation_id)
  f.succeed(0); await f.refresh()
  await f.act('select-video', { segment_id: 'segment-1', generation_id: f.starts[0].generation_id })
  assert.equal(f.get().production.segments[1].tail_stale, true)
}))

test('tail extraction refuses foreign hosts and traversal before any SSH execution', async () => {
  const backend = { base_url: 'http://localhost:16016/', connection: { ssh_alias: 'test' } }, job_id = '1'.repeat(32)
  await assert.rejects(extractTailFrameRemote(backend, { job_id, url: 'https://foreign.test/view?filename=a.mp4&type=output' }, '/output'), /原任务/)
  await assert.rejects(extractTailFrameRemote(backend, { job_id, url: 'http://localhost:16016/view?filename=a.mp4&type=output&subfolder=../secret' }, '/output'), /路径无效/)
})
