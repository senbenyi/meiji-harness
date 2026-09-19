// 职责：验证新制作阶段、版本失效、快照重读、单段提交和严格串行队列。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig } from '../src/config.js'
import { createProjectStore } from '../src/server/projects/service.js'
import { mediaFields } from '../src/database/schemas/production.js'
import { createProductionWorkflow } from '../src/server/projects/production.js'

test('Scene/Segment stages persist atomic versions and queue waits for each result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'production-'))
  try { await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const store = createProjectStore(), jobs = new Map(), starts = [], plans = []
    const dependencies = { resolveBackend: async () => ({ provider: 'test', service: 'comfyui' }), validatePlan: async (_, plan) => { plans.push(plan) },
      start: async args => { starts.push(args.segment_id); jobs.set(args.generation_id, { status: 'running' }); return { job_id: args.generation_id } },
      job: async id => jobs.get(id), resume: async id => { jobs.get(id).status = 'running' } }
    const flow = createProductionWorkflow(store, dependencies)
    let p = await store.change('create', { title: '测试', brief: '成年恋人书店重逢', duration_min: 1 })
    const act = async (name, body = {}) => p = await flow.action(name, { id: p.id, revision: p.production.revision, ...body })
    const generate = async (stage, data) => {
      await act('request', { stage, session_id: 'session' })
      const context = await flow.context(p.id, p.production.request.id, 'session')
      assert.deepEqual(JSON.parse(JSON.stringify(context)), context)
      p = await flow.complete({ id: p.id, request_id: p.production.request.id, ...data }, 'session')
    }
    await act('description', { requirements: '重逢', style: '暖色写实', aspect_ratio: '16:9', target_seconds: 10 })
    assert.equal(p.production.original_request, '成年恋人书店重逢')
    await generate('story', { text: '书店重逢。', scenes: [{ id: 'scene-a', title: '书店', description: '相遇', duration: 10 }] })
    await generate('segments', { segments: [1, 2].map(i => ({ id: `segment-${i}`, scene_id: 'scene-a', title: `片段${i}`, duration: 5, description: '看向彼此', character_count: 2, use_previous_tail: false, tail_reason: i === 1 ? '第一段没有上一段' : '切到另一人物特写，独立起镜', materials: Object.fromEntries(mediaFields.map(k=>[k,{description:'参考描述',intent:'auto',asset_ids:[]}])) })) })
    await generate('shots', { segments: p.production.segments.map(s => ({ id: s.id, shots: [{ action: '微笑', duration: 2 }, { action: '走近', duration: 3 }] })) })
    await generate('inputs', { segments: p.production.segments.map(s => ({ id: s.id, mode: 't2va', prompt: '暖色书店，成年恋人微笑着走近。' })) })
    assert.deepEqual((await createProjectStore().read(p.id)).production, p.production)
    const metadata = JSON.parse(await readFile(join(root, 'projects', p.id, 'project.json')))
    assert.ok(metadata.production_snapshot); assert.equal(metadata.production, undefined)
    await act('submit', { segment_id: 'segment-2' })
    p = await flow.refresh(p.id); assert.deepEqual(starts, ['segment-2'])
    p = await flow.refresh(p.id); assert.equal(starts.length, 1)
    const firstJob = p.production.queue.items[0].job_id
    jobs.set(firstJob, { status: 'succeeded', result: { comfyui_view_url: 'https://video.example/2.mp4', duration_sec: 5.1 } })
    p = await flow.refresh(p.id); assert.equal(p.production.queue.status, 'complete')
    await act('submit'); p = await flow.refresh(p.id)
    assert.deepEqual(starts, ['segment-2', 'segment-1']); assert.equal(p.production.queue.items.length, 1)
    const nextJob = p.production.queue.items[0].job_id
    jobs.set(nextJob, { status: 'failed', error: '连接中断' }); p = await flow.refresh(p.id)
    assert.equal(p.production.queue.status, 'paused')
    await act('resume'); assert.equal(starts.length, 2)
    jobs.set(nextJob, { status: 'succeeded', result: { comfyui_view_url: 'https://video.example/1.mp4', duration_sec: 5.1 } }); p = await flow.refresh(p.id)
    await act('submit'); assert.equal(p.production.queue.items.length, 0)
    await act('segment', { segment_id: 'segment-1', patch: { description: '新的动作' } })
    assert.equal(p.production.segments[0].shots_revision, null)
    assert.equal(p.production.segments[0].generations.length, 1)
    await assert.rejects(act('submit'), /尚未完成/)
    await act('request', { stage: 'shots', segment_id: 'segment-1', session_id: 'session' })
    await assert.rejects(flow.complete({ id: p.id, request_id: p.production.request.id, segments: [{ id: 'segment-1', shots: [{ duration: 9, action: '太长' }] }] }, 'session'), /总时长/)
    assert.equal((await store.read(p.id)).production.segments[0].shots[0].action, '微笑')
  }) } finally { await rm(root, { recursive: true, force: true }) }
})

test('batch starts the second segment only after the first succeeds, including restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'production-order-'))
  try { await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const store = createProjectStore(); let p = await store.change('create', { title: '顺序' })
    await store.transact(p.id, v => { v.production.segments = [1, 2].map(n => ({ id: `segment-${n}`, title: `${n}`, revision: 1, shots_revision: 1, shots: [{ action: 'a' }], inputs: [{ id: `input-00000000-0000-0000-0000-00000000000${n}`, source_revision: 1, plan: { prompt: 'a' } }], generations: [] })); return [] })
    const starts = [], jobs = new Map(), deps = { resolveBackend: async () => ({}), validatePlan: async () => {}, start: async args => { starts.push(args.segment_id); jobs.set(args.generation_id, { status: 'running' }); return {} }, job: async id => jobs.get(id) }
    let flow = createProductionWorkflow(store, deps)
    await flow.action('submit', { id: p.id, revision: 0 }); await flow.refresh(p.id); await flow.refresh(p.id)
    assert.deepEqual(starts, ['segment-1'])
    flow = createProductionWorkflow(createProjectStore(), deps)
    await flow.refresh(p.id); assert.equal(starts.length, 1)
    p = await store.read(p.id); jobs.set(p.production.queue.items[0].job_id, { status: 'succeeded', result: { comfyui_view_url: 'https://a/1.mp4' } })
    await flow.refresh(p.id); await flow.refresh(p.id)
    assert.deepEqual(starts, ['segment-1', 'segment-2'])
  }) } finally { await rm(root, { recursive: true, force: true }) }
})

test('automatic episodes preserve every full segment in order and compose sequentially', async () => {
  const root = await mkdtemp(join(tmpdir(), 'production-compose-'))
  try { await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const store = createProjectStore(); let p = await store.change('create', { title: '100 segments' })
    p = await store.transact(p.id, v => {
      v.production.segments = Array.from({ length: 100 }, (_, i) => ({ id: `segment-${i}`, title: `${i}`, revision: 1, shots_revision: 1, shots: [], inputs: [{ id: `input-${i}`, source_revision: 1 }], generations: [{ id: `video-${i}`, input_id: `input-${i}`, status: 'succeeded', url: `https://video.example/${i}.mp4`, duration: 5 }] })); return []
    })
    const calls = [], deps = { resolveBackend: async () => ({ provider: 'test' }), compose: async (_, input) => { calls.push(structuredClone(input)); return { status: 'succeeded', url: 'https://video.example/final.mp4', duration: 50 } } }
    let flow = createProductionWorkflow(store, deps)
    for (const count of [0, 101, 1.5]) await assert.rejects(flow.action('compose', { id: p.id, revision: 0, episode_count: count }), /总集数/)
    await store.transact(p.id, v => { v.production.segments[0].generations[0].input_id = 'old'; return [] })
    await assert.rejects(flow.action('compose', { id: p.id, revision: 0, episode_count: 10 }), /尚未完成/)
    await store.transact(p.id, v => { v.production.segments[0].generations[0].input_id = 'input-0'; return [] })
    p = await flow.action('compose', { id: p.id, revision: 0, episode_count: 10 })
    assert.equal(p.production.export_episode_count, 10)
    assert.equal(p.production.exports.length, 10)
    assert.deepEqual(p.production.exports.map(e => e.episode_number), Array.from({ length: 10 }, (_, i) => i + 1))
    const clips = p.production.exports.flatMap(e => e.timeline.clips)
    assert.deepEqual(clips.map(c => c.segment_id), Array.from({ length: 100 }, (_, i) => `segment-${i}`))
    assert.ok(clips.every(c => c.start === 0 && c.end === 5 && c.volume === 1 && c.transition === 'cut'))
    assert.ok(p.production.exports.every(e => e.planned_duration === 50))
    await assert.rejects(flow.action('compose', { id: p.id, revision: 1, episode_count: 1 }), /正在执行/)
    flow = createProductionWorkflow(createProjectStore(), deps)
    p = await flow.refresh(p.id)
    assert.equal(calls.length, 1); assert.equal(p.production.exports[1].status, 'pending')
    for (let i = 1; i < 10; i++) p = await flow.refresh(p.id)
    assert.equal(calls.length, 10); assert.ok(p.production.exports.every(e => e.status === 'succeeded'))
    p = await flow.action('compose', { id: p.id, revision: 1, episode_count: 1 })
    assert.equal(p.production.exports.length, 11)
    assert.equal(p.production.exports[10].timeline.clips.length, 100)
  }) } finally { await rm(root, { recursive: true, force: true }) }
})

test('30-second target rejects short AI story and segments without consuming the request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'production-duration-'))
  try { await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const store = createProjectStore(), flow = createProductionWorkflow(store)
    let p = await store.change('create', { title: '时长校验' })
    const act = async (name, body) => p = await flow.action(name, { id: p.id, revision: p.production.revision, ...body })
    await act('description', { requirements: '书店重逢', style: '写实', aspect_ratio: '16:9', target_seconds: 30 })
    await act('request', { stage: 'story', session_id: 'session' })
    const requestId = p.production.request.id
    const context = await flow.context(p.id, requestId, 'session')
    assert.equal(context.target_seconds, 30); assert.equal(context.story, null)
    assert.match(context.instructions, /target_seconds=30/)
    const result = { id: p.id, request_id: requestId, text: '重逢', scenes: [{ id: 'scene-a', description: '重逢', duration: 10 }] }
    await assert.rejects(flow.complete(result, 'session'), /剧情总时长为 10 秒.*30 秒/)
    p = await store.read(p.id)
    assert.equal(p.production.request.id, requestId); assert.equal(p.production.story.revision, 0)
    result.scenes[0].duration = 30
    p = await flow.complete(result, 'session')
    assert.equal(p.production.story.scenes[0].duration, 30)
    await act('request', { stage: 'segments', session_id: 'session' })
    const s = { scene_id: 'scene-a', title: '重逢', description: '微笑', duration: 15, character_count: 2, use_previous_tail: false, tail_reason: '独立机位起镜', materials: Object.fromEntries(mediaFields.map(k => [k, { description: '具体描述', intent: 'auto', asset_ids: [] }])) }
    const segments = { id: p.id, request_id: p.production.request.id, segments: [s] }
    await assert.rejects(flow.complete(segments, 'session'), /Segment总时长为 15 秒.*30 秒/)
    assert.equal((await store.read(p.id)).production.segments.length, 0)
    segments.segments.push({ ...s, title: '交谈' })
    p = await flow.complete(segments, 'session')
    assert.equal(p.production.segments.reduce((n, s) => n + s.duration, 0), 30)
    assert.equal(p.production.request, null)
  }) } finally { await rm(root, { recursive: true, force: true }) }
})

test('segment planning preserves each story scene duration instead of redistributing time', async () => {
  const root = await mkdtemp(join(tmpdir(), 'production-scene-duration-'))
  try { await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const store = createProjectStore(), flow = createProductionWorkflow(store)
    let p = await store.change('create', { title: '咖啡馆与次日公园' })
    const act = async (name, body) => p = await flow.action(name, { id: p.id, revision: p.production.revision, ...body })
    await act('description', { requirements: '先交谈，再次日送礼', aspect_ratio: '9:16', target_seconds: 30 })
    await act('story', { text: '交谈与送礼', scenes: [{ id: 'scene-a', title: '咖啡馆', description: '午后交谈', duration: 18 }, { id: 'scene-b', title: '公园', description: '次日送礼', duration: 12 }] })
    await act('request', { stage: 'segments', session_id: 'session' })
    const make = (scene_id, duration) => ({ scene_id, duration, description: '剧情动作', character_count: 2, use_previous_tail: false, tail_reason: '独立起镜', materials: Object.fromEntries(mediaFields.map(k => [k, { description: '具体描述', intent: 'auto', asset_ids: [] }])) })
    const payload = { id: p.id, request_id: p.production.request.id, segments: [make('scene-a', 15), make('scene-b', 15)] }
    await assert.rejects(flow.complete(payload, 'session'), /咖啡馆.*15 秒.*18 秒/)
    const unchanged = await store.read(p.id)
    assert.equal(unchanged.production.request.id, payload.request_id); assert.equal(unchanged.production.segments.length, 0)
    payload.segments = [make('scene-a', 9), make('scene-a', 9), make('scene-b', 12)]
    await flow.complete(payload, 'session')
    p = await store.read(p.id)
    assert.deepEqual(p.production.segments.map(s => [s.scene_id, s.duration]), [['scene-a', 9], ['scene-a', 9], ['scene-b', 12]])
    assert.equal(p.production.request, null)
  }) } finally { await rm(root, { recursive: true, force: true }) }
})
