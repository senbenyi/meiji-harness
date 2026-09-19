// 职责：验证长制作任务的分批暂存、原子合并、恢复与错误重放。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig } from '../src/config.js'
import { createProjectStore } from '../src/server/projects/service.js'
import { createProductionWorkflow } from '../src/server/projects/production.js'
import { createProductionTools } from '../src/tools/project/production.js'
import { mediaFields } from '../src/database/schemas/production.js'

async function fixture(seconds, scenes, run) {
  const root = await mkdtemp(join(tmpdir(), 'production-batches-'))
  try { await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const store = createProjectStore(), deps = { resolveBackend: async () => ({ provider: 'test', model: 'test' }), start: async () => { assert.fail('batch saving must not generate video') } }
    let flow = createProductionWorkflow(store, deps), p = await store.change('create', { title: '完整 JSON 批次测试', brief: '书店找书与阅读' })
    const act = async (name, data = {}) => p = await flow.action(name, { id: p.id, revision: p.production.revision, ...data })
    await act('description', { requirements: '书店找书与阅读', style: '自然', aspect_ratio: '16:9', target_seconds: seconds })
    await act('story', { text: '读者在书店找书，坐下阅读。', scenes })
    await run({ get p() { return p }, act,
      read: () => flow.context(p.id, p.production.request.id, 'session'),
      complete: async (data, session = 'session') => p = await flow.complete({ id: p.id, request_id: p.production.request?.id, ...data }, session),
      restart: async () => { flow = createProductionWorkflow(createProjectStore(), deps); p = await store.read(p.id) },
      tool: () => createProductionTools({ production: flow }, {}).find(t => t.name === 'project_production_complete') })
  }) } finally { await rm(root, { recursive: true, force: true }) }
}
const planned = (n, scene = 'scene-a') => ({ id: `segment-${n}`, scene_id: scene, title: `阅读 ${n}`, description: '连续翻书阅读', duration: 15,
  character_count: 1, start_state: `翻至第 ${n} 页`, end_state: `将翻至第 ${n + 1} 页`, use_previous_tail: n > 1, tail_reason: n === 1 ? '无上一段' : '同一空间与机位继续翻书',
  materials: Object.fromEntries(mediaFields.map(k => [k, { description: '统一书店与读者设定', intent: 'auto', asset_ids: [] }])) })

test('20 segments, shots and inputs persist five complete batches per stage and publish atomically', async () => {
  await fixture(300, [{ id: 'scene-a', title: '书店', description: '连续阅读', duration: 300 }], async f => {
    for (const stage of ['segments', 'shots', 'inputs']) {
      await f.act('request', { stage, session_id: 'session' })
      const requestId = f.p.production.request.id
      let last
      for (let i = 0; i < 5; i++) {
        await f.restart()
        const context = await f.read()
        assert.equal(context.request.batch.index, i)
        assert.equal(context.request.batch.saved_items, i * 4)
        assert.equal(context.request.batch.items, undefined)
        const ids = Array.from({ length: 4 }, (_, n) => `segment-${i * 4 + n + 1}`)
        if (stage === 'segments') {
          assert.equal(context.saved_segment_ids.length, i * 4)
          assert.equal(context.remaining_scenes[0].remaining_seconds, 300 - 60 * i)
          assert.equal(context.previous_segment?.id || null, i ? `segment-${i * 4}` : null)
        } else {
          assert.deepEqual(context.request.segment_ids, ids)
          assert.deepEqual(context.segments.map(s => s.id), ids)
        }
        const segments = stage === 'segments' ? ids.map((_, n) => planned(i * 4 + n + 1))
          : ids.map(id => ({ id, ...(stage === 'shots' ? { shots: [{ duration: 15, action: '继续阅读', camera: 'continuous single take' }] } : { prompt: 'Continuous single take, no cuts. A reader turns the next page.', mode: 't2va' }) }))
        if (i === 1 && stage !== 'segments') {
          const wrong = structuredClone(segments)
          if (stage === 'shots') wrong[0].shots[0].duration = 14; else wrong[0].prompt = ''
          const before = structuredClone(f.p.production)
          await assert.rejects(f.complete({ batch_index: i, segments: wrong }), /总时长|Prompt 不能为空/)
          await f.restart(); assert.deepEqual(f.p.production, before)
        }
        last = { request_id: requestId, batch_index: i, segments }
        await f.complete(last)
        const response = JSON.parse(f.tool().output.render({}, f.p)[0].text)
        if (i < 4) {
          assert.equal(f.p.production.request.id, requestId)
          assert.equal(f.p.production.request.revision, f.p.production.revision)
          assert.match(response.notice, /本阶段尚未完成/)
          assert.equal(response.request.batch.items, undefined)
          if (stage === 'segments') assert.equal(f.p.production.segments.length, 0)
          if (stage === 'shots') assert.ok(f.p.production.segments.every(s => s.shots.length === 0))
          if (stage === 'inputs') assert.ok(f.p.production.segments.every(s => s.inputs.length === 0))
        } else {
          assert.equal(response.request, null)
          assert.equal(f.p.production.stage, stage)
        }
      }
      const completed = structuredClone(f.p.production)
      await f.restart(); await f.complete(last)
      assert.deepEqual(f.p.production, completed, 'final response replay must not save twice')
    }
    assert.equal(f.p.production.segments.length, 20)
    assert.ok(f.p.production.segments.every(s => s.shots.length === 1 && s.inputs.length === 1 && s.generations.length === 0))
    assert.equal(f.p.production.segments[1].inputs[0].first_frame_source.segment_id, 'segment-1')
    assert.equal(f.p.production.segments[1].inputs[0].plan.mode, 'i2va')
    await f.act('request', { stage: 'shots', session_id: 'session', segment_id: 'segment-12' })
    assert.deepEqual((await f.read()).request.segment_ids, ['segment-12'])
    await f.complete({ batch_index: 0, segments: [{ id: 'segment-12', shots: [{ duration: 15, action: '放下书' }] }] })
    assert.equal(f.p.production.segments[11].shots[0].action, '放下书')
    assert.equal(f.p.production.segments[10].shots[0].action, '继续阅读')
  })
})

test('batch limits, duplicates, ordering, scene duration and session failures retain the accepted draft', async () => {
  await fixture(90, [{ id: 'scene-a', title: '书架', description: '找书', duration: 45 }, { id: 'scene-b', title: '座位', description: '阅读', duration: 45 }], async f => {
    await f.act('request', { stage: 'segments', session_id: 'session' })
    const requestId = f.p.production.request.id
    await assert.rejects(f.complete({ batch_index: 0, segments: Array.from({ length: 5 }, (_, i) => planned(i + 1)) }), /每批需要/)
    await assert.rejects(f.complete({ batch_index: 1, segments: [planned(1)] }), /顺序错误/)
    await assert.rejects(f.complete({ batch_index: 0, segments: [planned(1)] }, 'another-session'), /不属于当前会话/)
    await assert.rejects(f.complete({ batch_index: 0, segments: [{ ...planned(1), use_previous_tail: true }] }), /第一个 Segment/)
    const first = { batch_index: 0, segments: [planned(1)] }
    await f.complete(first)
    const accepted = structuredClone(f.p.production)
    await f.complete(first); assert.deepEqual(f.p.production, accepted)
    const cases = [
      [{ batch_index: 0, segments: [{ ...planned(1), description: '不同内容' }] }, /冲突/],
      [{ batch_index: 2, segments: [planned(2)] }, /顺序错误/],
      [{ segments: [planned(2)] }, /batch_index/],
      [{ batch_index: 1, segments: [planned(1)] }, /重复/],
      [{ batch_index: 1, segments: [planned(2, 'scene-b')] }, /不能超时或跳过/],
      [{ batch_index: 1, segments: [planned(2), planned(3), planned(4)] }, /不能超时或跳过/],
    ]
    for (const [payload, pattern] of cases) {
      await assert.rejects(f.complete(payload), pattern)
      await f.restart(); assert.deepEqual(f.p.production, accepted)
    }
    await f.complete({ batch_index: 1, segments: [planned(2), planned(3), planned(4, 'scene-b')] })
    const context = await f.read()
    assert.deepEqual(context.remaining_scenes, [{ id: 'scene-b', remaining_seconds: 30 }])
    assert.equal(context.previous_segment.id, 'segment-4')
    await assert.rejects(f.complete({ batch_index: 2, segments: [planned(5, 'scene-b'), planned(6)] }), /剧情顺序/)
    await f.act('cancel-request')
    assert.equal(f.p.production.request, null)
    assert.equal(f.p.production.segments.length, 0)
    await assert.rejects(f.complete({ request_id: requestId, batch_index: 2, segments: [planned(5, 'scene-b')] }), /已过期/)
  })
})

test('batch segment planning finishes when scenes are filled within 30 seconds of the target', async () => {
  await fixture(180, [{ id: 'scene-a', title: '书店', description: '连续阅读', duration: 185 }], async f => {
    await f.act('request', { stage: 'segments', session_id: 'session' })
    for (let i = 0; i < 3; i++) {
      await f.complete({ batch_index: i, segments: Array.from({ length: 4 }, (_, n) => planned(i * 4 + n + 1)) })
      assert.equal(f.p.production.request.batch.index, i + 1)
      assert.equal(f.p.production.segments.length, 0)
    }
    await f.complete({ batch_index: 3, segments: [{ ...planned(13), duration: 5 }] })
    assert.equal(f.p.production.request, null)
    assert.equal(f.p.production.segments.reduce((n, s) => n + s.duration, 0), 185)
  })
})

test('server-assigned segment identities survive replay and are exposed to subsequent batches', async () => {
  await fixture(120, [{ id: 'scene-a', description: '阅读', duration: 120 }], async f => {
    await f.act('request', { stage: 'segments', session_id: 'session' })
    const values = start => Array.from({ length: 4 }, (_, n) => { const { id, ...value } = planned(start + n); return value })
    const first = { batch_index: 0, segments: values(1) }
    await f.complete(first)
    const ids = (await f.read()).saved_segment_ids
    assert.equal(ids.length, 4)
    assert.ok(ids.every(id => /^segment-[a-f0-9-]{36}$/.test(id)))
    await f.restart(); await f.complete(first)
    assert.deepEqual((await f.read()).saved_segment_ids, ids)
    await f.complete({ batch_index: 1, segments: values(5) })
    assert.equal(new Set(f.p.production.segments.map(s => s.id)).size, 8)
    assert.deepEqual(f.p.production.segments.slice(0, 4).map(s => s.id), ids)
  })
})

test('a partial batch cannot leave a scene remainder shorter than the generation minimum', async () => {
  await fixture(63, [{ id: 'scene-a', title: '书店', description: '阅读', duration: 63 }], async f => {
    await f.act('request', { stage: 'segments', session_id: 'session' })
    const segments = [1, 2, 3, 4].map(n => planned(n))
    await assert.rejects(f.complete({ batch_index: 0, segments }), /剩余 3 秒不足/)
    assert.equal(f.p.production.request.batch, undefined)
    segments[3].duration = 14
    await f.complete({ batch_index: 0, segments })
    assert.equal((await f.read()).remaining_scenes[0].remaining_seconds, 4)
    await f.complete({ batch_index: 1, segments: [{ ...planned(5), duration: 4 }] })
    assert.equal(f.p.production.request, null)
    assert.equal(f.p.production.segments.reduce((n, s) => n + s.duration, 0), 63)
  })
})
