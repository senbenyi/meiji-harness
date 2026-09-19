// 职责：验证剧情与 Segment 同步规划的原子保存、时长约束和下游入口。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig } from '../src/config.js'
import { createProjectStore } from '../src/server/projects/service.js'
import { createProductionWorkflow } from '../src/server/projects/production.js'
import { mediaFields } from '../src/database/schemas/production.js'

test('combined story validates and saves scenes and segments atomically, then enters shots directly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'story-segments-'))
  try { await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const store = createProjectStore(), flow = createProductionWorkflow(store)
    let project = await store.change('create', { title: '重逢', brief: '咖啡馆交谈，次日公园送礼', duration_min: 1 })
    const act = async (name, data) => project = await flow.action(name, { id: project.id, revision: project.production.revision, ...data })
    await act('description', { requirements: '咖啡馆交谈，次日公园送礼', aspect_ratio: '16:9', target_seconds: 30 })
    await act('request', { stage: 'story', plan_segments: true, session_id: 'session', restart: true })
    const context = await flow.context(project.id, project.production.request.id, 'session')
    assert.equal(context.request.plan_segments, true)
    assert.match(context.instructions, /剧情与视频片段同步规划/)
    assert.doesNotMatch(context.instructions, /本阶段不生成 Segment|本阶段分批生成/)
    const segment = (duration, continuation = false) => ({ duration, title: '交谈', description: '接续对话动作', character_count: 2, start_state: '坐在桌旁', end_state: '递出礼物', use_previous_tail: continuation, tail_reason: continuation ? '连续构图与动作' : '新场景起镜', materials: Object.fromEntries(mediaFields.map(k => [k, { description: '场景素材', intent: 'auto', asset_ids: [] }])) })
    const data = { text: '咖啡馆交谈，次日公园送礼。', scenes: [
      { title: '咖啡馆', description: '交谈', duration: 18, segments: [segment(9), segment(9, true)] },
      { title: '公园', description: '送礼', duration: 12, segments: [segment(12)] },
    ] }
    const before = structuredClone(project.production)
    const complete = body => flow.complete({ id: project.id, request_id: project.production.request.id, ...body }, 'session')
    for (const duration of [3, 16, 8]) {
      const invalid = structuredClone(data); invalid.scenes[0].segments[0].duration = duration
      await assert.rejects(complete(invalid), /4～15|必须等于/)
      assert.deepEqual((await store.read(project.id)).production, before)
    }
    const missing = structuredClone(data); delete missing.scenes[1].segments
    await assert.rejects(complete(missing), /同时返回/)
    project = await complete(data)
    assert.equal(project.production.request, null)
    assert.equal(project.production.segments.length, 3)
    assert.equal(project.production.stage_runs.story.status, 'succeeded')
    assert.equal(project.production.stage_runs.segments.status, 'succeeded')
    for (const scene of project.production.story.scenes) assert.equal(project.production.segments.filter(s => s.scene_id === scene.id).reduce((sum, s) => sum + s.duration, 0), scene.duration)
    assert.equal(project.production.segments[1].use_previous_tail, true)
    assert.equal(project.production.segments[2].use_previous_tail, false)
    assert.deepEqual((await createProjectStore().read(project.id)).production, project.production)
    await act('request', { stage: 'shots', session_id: 'session' })
    assert.equal(project.production.request.segment_ids.length, 3)
    await act('request', { stage: 'story', plan_segments: true, session_id: 'session', restart: true })
    const oldIds = project.production.segments.map(s => s.id)
    project = await complete(data)
    assert.ok(project.production.segments.every(s => !oldIds.includes(s.id)))
  }) } finally { await rm(root, { recursive: true, force: true }) }
})
