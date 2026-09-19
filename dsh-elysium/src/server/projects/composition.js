// 职责：按总集数顺序分配完整片段，冻结每集输入并依次合片，保留历史版本。
import { randomUUID } from 'node:crypto'
import { composeBackend, resolveGenerationBackend } from '../../models/managers/runtime/index.js'
import { currentInput, currentGeneration, fail } from '../../database/schemas/production.js'
export function createComposition(store, dependencies = {}) {
  const compose = dependencies.compose || composeBackend
  async function submit(body) {
    const project = await store.read(body.id), p = project.production
    if (p.revision !== body.revision) fail('项目已变化，请刷新后重新提交')
    if (p.request || p.story.stale || p.queue && ['running', 'paused', 'stopping'].includes(p.queue.status)) fail('请先完成当前制作任务')
    if (p.exports.some(e => ['pending', 'running'].includes(e.status))) fail('已有合片任务正在执行')
    const count = body.episode_count ?? p.export_episode_count ?? 1
    if (!Number.isInteger(count) || count < 1 || count > p.segments.length) fail('总集数须为 1 到有效片段数量之间的整数')
    const clips = p.segments.map(s => {
      const input = currentInput(s)
      const video = s.generations.find(g => g.id === s.selected_generation) || currentGeneration(s)
      if (s.story_stale || s.tail_stale || !input || !video || video.status !== 'succeeded' || !video.url || video.input_id !== input.id && s.selected_for_input !== input.id) fail(`${s.title} 的当前审核视频尚未完成，请先完成全部片段`)
      if (!Number.isFinite(video.duration) || video.duration <= 0) fail(`${s.title} 缺少有效视频时长`)
      return { segment_id: s.id, generation_id: video.id, url: video.url, start: 0, end: video.duration, subtitle: '', transition: 'cut', volume: 1 }
    })
    const backend = await (dependencies.resolveBackend || (() => resolveGenerationBackend('video')))()
    const [w, h] = p.aspect_ratio.split(':').map(Number), scale = 768 / Math.min(w, h)
    const batchId = randomUUID(), createdAt = Date.now(), records = []
    let cursor = 0, remaining = clips.reduce((n, c) => n + c.end, 0)
    for (let episode = 1; episode <= count; episode++) {
      const target = remaining / (count - episode + 1), start = cursor
      let duration = clips[cursor++].end
      while (cursor < clips.length - (count - episode) && (episode === count || Math.abs(duration + clips[cursor].end - target) <= Math.abs(duration - target))) duration += clips[cursor++].end
      remaining -= duration
      records.push({ id: randomUUID(), batch_id: batchId, episode_number: episode, episode_count: count, title: `第 ${episode} 集`, status: 'pending', source_revision: p.revision,
        timeline: { clips: clips.slice(start, cursor), music_url: '', music_volume: 0 }, planned_duration: duration, backend,
        size: [Math.round(w * scale / 2) * 2, Math.round(h * scale / 2) * 2], created_at: createdAt })
    }
    return store.transact(body.id, value => {
      if (value.production.revision !== body.revision) fail('项目已变化，请重新审核')
      value.production.export_episode_count = count; value.production.exports.push(...records); value.production.revision++
      return []
    })
  }
  async function refresh(id) {
    const p = await store.read(id)
    const e = p.production?.exports.find(e => ['pending', 'running'].includes(e.status))
    if (e) {
      let result
      try { result = await compose(e.backend, { id: e.id, timeline: e.timeline, size: e.size }) }
      catch (error) { result = { status: 'failed', error: error.message } }
      if (JSON.stringify(result) !== JSON.stringify(e.progress)) await store.transact(id, p => { Object.assign(p.production.exports.find(v => v.id === e.id), result, { progress: result }); return [] })
    }
    return store.read(id)
  }
  return { submit, refresh }
}
