// 职责：验证全剧推进不会漏集、部分回写或重复生成，以及项目会话绑定隔离。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withConfig } from '../src/config.js'
import { createProjectStore } from '../src/server/projects/service.js'
import { createProjectWorkflow } from '../src/server/projects/workflow.js'

test('whole series validates every episode before writes or video launches and resumes only missing work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'series-workflow-'))
  try { await withConfig({ ELYSIUM_STATE_ROOT: root }, async () => {
    const store = createProjectStore(), jobs = new Map(), starts = []; let rejectPlan = false, failSecond = true
    const workflow = createProjectWorkflow(store, {
      resolveBackend: async () => ({ service: 'comfyui' }),
      validatePlan: async (_backend, plan) => { if (rejectPlan && plan.shots[0].id.startsWith('episode-2-')) throw new Error('unsupported') },
      start: async args => {
        starts.push(args.episode_id)
        if (args.episode_id === 'episode-2' && failSecond) throw new Error('暂时无法启动')
        const job = { job_id: args.episode_id.slice(-1).repeat(32), status: 'running' }; jobs.set(job.job_id, job); return job
      }, job: async id => jobs.get(id),
    })
    let p = await store.change('create', { title: '全剧测试' })
    const act = async (name, body = {}) => p = await workflow.action(name, { id: p.id, revision: p.workflow.revision, ...body })
    await act('configure', { configuration: {}, episode_count: 3 })
    await act('bind-session', { session_id: 'project-session' })
    const other = await store.change('create', { title: '另一项目' })
    await assert.rejects(workflow.action('bind-session', { id: other.id, session_id: 'project-session' }), /关联其他项目/)
    await assert.rejects(act('request', { stage: 'plot', session_id: 'wrong-session' }), /关联会话/)
    await assert.rejects(act('request', { stage: 'storyboard', session_id: 'project-session' }), /所有分集剧情/)
    await act('request', { stage: 'plot', session_id: 'project-session' })
    p = await workflow.complete({ id: p.id, request_id: p.workflow.request.id, episodes: p.episodes.map(e => ({ id: e.id, title: e.title, plot: '相遇并相爱。' })) }, 'project-session')
    await act('request', { stage: 'storyboard', session_id: 'project-session' })
    const context = await workflow.context(p.id, p.workflow.request.id, 'project-session')
    assert.deepEqual(JSON.parse(JSON.stringify(context)), context)
    assert.equal(context.episode_id, null); assert.match(context.material_rules, /characters=\[\]/)
    const requestId = p.workflow.request.id
    const episodes = p.episodes.map(e => ({ id: e.id, shots: [{ id: 's1', duration: 3, action: '相视微笑', prompt: '成年情侣相视微笑' }] }))
    await assert.rejects(workflow.complete({ id: p.id, request_id: requestId, episodes: episodes.slice(0, 2) }, 'project-session'), /全部分集/)
    await assert.rejects(workflow.complete({ id: p.id, request_id: requestId, episodes: episodes.map((e, i) => i === 2 ? { ...e, shots: [] } : e) }, 'project-session'), /分镜/)
    assert.equal((await store.read(p.id)).acts.length, 0)
    p = await workflow.complete({ id: p.id, request_id: requestId, episodes }, 'project-session')
    assert.equal(p.acts.length, 3)
    rejectPlan = true
    await assert.rejects(act('submit-series'), /unsupported/)
    assert.equal(starts.length, 0)
    rejectPlan = false
    await act('submit-series')
    assert.deepEqual(starts, ['episode-1', 'episode-2', 'episode-3'])
    assert.match(p.workflow.error, /第 2 集/)
    await assert.rejects(act('finish'), /所有分集成片/)
    failSecond = false
    await act('submit-series')
    assert.deepEqual(starts, ['episode-1', 'episode-2', 'episode-3', 'episode-2'])
    for (const job of jobs.values()) job.status = 'succeeded'
    p = await workflow.refresh(p.id)
    await act('finish')
    assert.ok(p.reviewed_at)
    await act('submit-series')
    assert.equal(starts.length, 4)
    const oldRevision = p.workflow.revision
    p = await workflow.action('edit', { id: p.id, episode_id: 'episode-2', revision: p.episodes[1].workflow.revision, plot: '修改后的剧情。' })
    assert.equal(p.reviewed_at, null)
    assert.ok(p.workflow.revision > oldRevision)
    await assert.rejects(act('submit-series'), /所有分集/)
  }) } finally { await rm(root, { recursive: true, force: true }) }
})
