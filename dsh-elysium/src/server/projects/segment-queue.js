// 职责：持久化审核输入并逐段执行，复用任务身份，失败暂停，重启继续。
import { randomBytes, randomUUID } from 'node:crypto'
import { currentInput, currentGeneration, invalidateTailDependents, fail, replaceProductionRun } from '../../database/schemas/production.js'
import { startVideoJob, resumeVideoJob } from '../workflows/videos/service.js'
import { getJob } from '../jobs/query.js'
import { resolveGenerationBackend, validateBackendPlan, extractBackendTailFrame } from '../../models/managers/runtime/index.js'
export function createSegmentQueue(store, dependencies = {}) {
  const start = dependencies.start || startVideoJob, resume = dependencies.resume || resumeVideoJob, job = dependencies.job || getJob
  const resolveBackend = dependencies.resolveBackend || (() => resolveGenerationBackend('video')), validate = dependencies.validatePlan || validateBackendPlan
  const tailFrame = dependencies.tailFrame || extractBackendTailFrame
  async function submit(id, segmentId, force = false, expectedRevision, restart = false) {
    const project = await store.read(id), p = project.production
    if (expectedRevision !== p.revision) fail('H3 输入已更新，请刷新后重新审核')
    if (!restart && p.request) fail('请等待 AI 完成当前输入后再审核提交')
    if (!restart && p.queue && ['running', 'paused', 'stopping'].includes(p.queue.status)) fail('已有队列，请先继续或结束该队列')
    if (p.story.stale) fail('请先完成最新剧情')
    const segments = segmentId ? p.segments.filter(s => s.id === segmentId) : p.segments
    if (!segments.length) fail('没有可提交的 Segment')
    const items = []
    for (const s of segments) {
      const input = currentInput(s)
      if (!input || s.story_stale || s.materials_pending) fail(`${s.title} 的分镜、素材或 H3 输入尚未完成`)
      const previous = input.first_frame_source && p.segments[p.segments.indexOf(s) - 1]
      if (input.first_frame_source && previous?.id !== input.first_frame_source.segment_id) fail(`${s.title} 的上一段已变化，请重新生成 H3 输入`)
      const queuedPrevious = previous && items.find(item => item.segment_id === previous.id)
      if (!force && currentGeneration(s) && !s.tail_stale && !queuedPrevious) continue
      const backend = input.backend || await resolveBackend()
      let source
      if (previous) {
        const video = previous.generations.find(g => g.id === previous.selected_generation) || currentGeneration(previous), previousInput = currentInput(previous)
        if (!queuedPrevious && (previous.tail_stale || previous.story_stale || !previousInput || !video?.url || video.status !== 'succeeded' || video.input_id !== previousInput.id && previous.selected_for_input !== previousInput.id)) fail(`${s.title} 需要上一段「${previous.title}」的当前审核视频；请先生成上一段或提交全部片段`)
        source = { segment_id: previous.id, generation_id: queuedPrevious?.job_id || video.id,
          backend: queuedPrevious?.backend || previous.inputs.find(i => i.id === video.input_id)?.backend || backend }
      } else await validate(backend, input.plan)
      // 动态首帧要等前段成功；此处冻结来源身份，启动前再校验实际 i2va 计划。
      items.push({ segment_id: s.id, input_id: input.id, plan: structuredClone(input.plan), backend, ...(source ? { first_frame_source: source } : {}), token: randomUUID(), job_id: randomBytes(16).toString('hex'), status: 'pending' })
    }
    return store.transact(id, value => {
      if (value.production.revision !== p.revision) fail('项目已变化，请重新审核')
      if (restart) { replaceProductionRun(value.production); value.production.revision++ }
      value.production.queue = { id: randomUUID(), status: items.length ? 'running' : 'complete', cursor: 0, items, error: null, created_at: Date.now() }
      value.production.stage = items.length ? 'videos' : value.production.stage
      for (const item of items) {
        const s = value.production.segments.find(s => s.id === item.segment_id)
        s.generations.push({ id: item.job_id, job_id: item.job_id, input_id: item.input_id, status: 'pending', url: null, duration: null, created_at: Date.now() })
      }
      return []
    })
  }
  async function tick(id) {
    let project = await store.read(id), q = project.production?.queue
    if (!q || !['running', 'stopping'].includes(q.status)) return project
    const item = q.items[q.cursor]
    if (!item) return store.transact(id, p => { p.production.queue.status = 'complete'; return [] })
    try {
      if (item.status === 'pending') {
        if (item.first_frame_source && !item.plan.first_frame) {
          const source = item.first_frame_source, previous = project.production.segments.find(s => s.id === source.segment_id)
          const video = previous.generations.find(g => g.id === source.generation_id)
          if (video?.status !== 'succeeded' || !video.url) fail('上一段尚未生成成功，无法提取尾帧')
          const frame = await tailFrame(source.backend, { job_id: video.job_id, url: video.url })
          if (!/^https?:\/\//.test(frame.url)) fail('尾帧提取未返回有效图片地址')
          item.plan = { ...item.plan, mode: 'i2va', first_frame: frame.url }
          await validate(item.backend, item.plan)
          await store.transact(id, p => {
            p.production.queue.items[q.cursor] = item
            p.production.segments.find(s => s.id === item.segment_id).generations.find(g => g.id === item.job_id).first_frame = { url: frame.url, segment_id: source.segment_id, generation_id: source.generation_id }
            return []
          })
        }
        await start({ project_id: id, segment_id: item.segment_id, generation_id: item.job_id, ...item.plan }, undefined, item.token)
        return store.transact(id, p => { p.production.queue.items[q.cursor].status = 'running'; p.production.segments.find(s => s.id === item.segment_id).generations.find(g => g.id === item.job_id).status = 'running'; return [] })
      }
      const result = await job(item.job_id)
      if (!['succeeded', 'failed'].includes(result.status)) return project
      if (result.status === 'succeeded' && !(result.result?.comfyui_view_url || result.result?.video_url)) fail('视频任务未返回有效产物地址，请核对原任务')
      return store.transact(id, p => {
        const queue = p.production.queue, generation = p.production.segments.find(s => s.id === item.segment_id).generations.find(g => g.id === item.job_id)
        generation.status = result.status; generation.error = result.error || null
        item.status = result.status; queue.items[q.cursor] = item
        if (result.status === 'failed') { queue.status = 'paused'; queue.error = result.error || '视频生成失败' }
        else {
          generation.url = result.result?.comfyui_view_url || result.result?.video_url || null
          generation.duration = result.result?.duration_sec || result.result?.validation?.duration_sec || item.plan.duration_seconds
          generation.duration_measured = !!(result.result?.duration_sec || result.result?.validation?.duration_sec)
          const s = p.production.segments.find(s => s.id === item.segment_id)
          if (currentInput(s)?.id === item.input_id) { invalidateTailDependents(p.production, s.id); s.selected_generation = generation.id; s.selected_for_input = null; s.tail_stale = false }
          queue.cursor++; if (queue.status === 'stopping') queue.status = 'cancelled'; else if (queue.cursor === queue.items.length) queue.status = 'complete'
        }
        return []
      })
    } catch (error) {
      return store.transact(id, p => { p.production.queue.status = 'paused'; p.production.queue.error = error.message; return [] })
    }
  }
  async function control(id, action) {
    const project = await store.read(id), q = project.production.queue
    if (!q) fail('没有队列')
    if (action === 'resume' && q.status === 'paused') {
      const item = q.items[q.cursor]
      if (item?.status === 'failed') await resume(item.job_id)
      return store.transact(id, p => { p.production.queue.status = 'running'; p.production.queue.error = null; if (item?.status === 'failed') p.production.queue.items[q.cursor].status = 'running'; return [] })
    }
    if (action === 'cancel') return store.transact(id, p => { p.production.queue.status = q.items[q.cursor]?.status === 'running' ? 'stopping' : 'cancelled'; return [] })
    fail('队列当前不能执行此操作')
  }
  return { submit, tick, control }
}
