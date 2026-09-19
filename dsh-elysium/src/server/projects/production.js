// 职责：推进需求、Scene、Segment、分镜和 H3 输入阶段，隔离 AI 回写与人工提交。
import { createComposition } from './composition.js'
import { createSegmentAssets } from './segment-assets.js'
import { randomUUID } from 'node:crypto'
import { initialProduction, sceneValues, segmentValues, shotValues, mediaFields, currentInput, invalidateTailDependents, fail, text, identity } from '../../database/schemas/production.js'
import { createSegmentQueue } from './segment-queue.js'
import { loadProductionInstructions } from './production-rules.js'
import { listAssets } from '../media/catalog.js'
import { resolveGenerationBackend, describeVideoBackend } from '../../models/managers/runtime/index.js'
export function createProductionWorkflow(store, dependencies = {}) {
  const queue = createSegmentQueue(store, dependencies), assets = createSegmentAssets(store), composition = createComposition(store, dependencies)
  let operations = Promise.resolve()
  const serial = fn => { const task = operations.then(fn); operations = task.catch(() => {}); return task }
  const update = (id, revision, fn) => store.transact(id, project => {
    const p = project.production
    if (!p) fail('请先将旧项目重新规划为 Scene / Segment')
    if (revision !== p.revision) fail('制作资料已更新，请刷新后重试')
    fn(p, project); p.revision++; return []
  })
  const checkDuration = (items, p, label) => {
    const total = items.reduce((n, item) => n + item.duration, 0)
    if (Math.abs(total - p.target_seconds) > .05) fail(`${label}总时长为 ${total} 秒，必须等于项目目标 ${p.target_seconds} 秒；请调整各段时长后重试`)
  }
  const segment = (p, id) => { const s = p.segments.find(s => s.id === id); if (!s) fail('Segment 不存在'); return s }
  const editable = p => { if (p.request) fail('AI 正在生成，请先等待或取消'); if (p.queue && ['running', 'paused', 'stopping'].includes(p.queue.status)) fail('请先完成或结束视频队列再修改制作资料') }
  function inputValue(value, s, p, target) {
    if (!text(value.prompt)) fail('H3 Prompt 不能为空')
    if (s.shots_revision !== s.revision) fail('请先完成当前版本分镜')
    const previous = s.use_previous_tail ? p.segments[p.segments.findIndex(v => v.id === s.id) - 1] : null
    if (s.use_previous_tail && !previous) fail('第一个 Segment 没有上一段尾帧')
    const mode = previous ? 'i2va' : value.mode || 't2va'
    if (!['t2va', 'i2va'].includes(mode)) fail('当前已接入工作流支持 t2va / i2va')
    const plan = { profile: 'regular', mode, prompt: text(value.prompt), duration_seconds: s.duration, aspect_ratio: p.aspect_ratio }
    const references = [...new Set(Object.values(s.materials || {}).flatMap(v => v.asset_ids))].map(id => {
      const asset = p.assets.find(a => a.id === id)
      if (asset?.status && asset.status !== 'succeeded') fail('指定素材还未准备完成，请先完成素材生成')
      return { id, title: asset.title, url: asset.url, usage: !previous && mode === 'i2va' && id === value.reference_asset_id ? 'first_frame' : 'prompt_description' }
    })
    if (mode === 'i2va' && !previous) {
      const asset = p.assets.find(a => a.id === value.reference_asset_id)
      if (!asset?.url || !/^https?:\/\//.test(asset.url)) fail('首帧图生视频需要已经准备好的实际参考图')
      plan.first_frame = asset.url
    }
    return { id: identity('input'), source_revision: s.revision, plan, references, ...(previous ? { first_frame_source: { type: 'previous_tail', segment_id: previous.id } } : {}), ...target, created_at: Date.now() }
  }
  async function action(name, body) {
    if (name === 'initialize') return store.transact(body.id, project => {
      if (!project.production) { project.schema_version = 3; project.production = initialProduction(project); project.production.requirements += '\n原项目剧情：\n' + project.episodes.map(e => e.workflow.plot).filter(Boolean).join('\n') }
      return []
    })
    if (name === 'compose') return composition.submit(body)
    if (name === 'asset-generate') return assets.generate(body)
    if (name === 'asset-resume') return assets.resume(body)
    if (name === 'submit') return queue.submit(body.id, body.segment_id, Boolean(body.regenerate), body.revision)
    if (['resume', 'cancel-queue'].includes(name)) return queue.control(body.id, name === 'resume' ? 'resume' : 'cancel')
    if (name === 'asset-import') {
      const { items } = await (dependencies.assets || (() => listAssets(0, Number.MAX_SAFE_INTEGER)))()
      const selected = items.find(a => a.id === body.asset_id)
      if (!selected) fail('素材已不存在')
      return update(body.id, body.revision, p => {
        editable(p)
        if (!p.assets.some(a => a.id === selected.id)) p.assets.push({ id: selected.id, category: selected.category, title: selected.title, description: selected.description || '', url: selected.comfyui_view_url || '', job_id: selected.job_id || null, version: selected.updated_at || 1 })
      })
    }
    let target
    if (name === 'input' || name === 'request' && body.stage === 'inputs') {
      const backend = await (dependencies.resolveBackend || (() => resolveGenerationBackend('video')))()
      const model = dependencies.resolveBackend ? { model: backend.model || 'test' } : await describeVideoBackend(backend)
      target = { backend, model }
    }
    return update(body.id, body.revision, (p, project) => {
      if (name === 'cancel-request') { p.request = null; return }
      editable(p)
      if (name === 'description') {
        if (!['9:16', '16:9', '1:1', '4:3', '3:4', '21:9'].includes(body.aspect_ratio)) fail('画幅无效')
        if (!Number.isFinite(body.target_seconds) || body.target_seconds < 4 || body.target_seconds > 1500) fail('总时长须为 4～1500 秒')
        if (!text(body.requirements)) fail('创作要求不能为空')
        Object.assign(p, { requirements: text(body.requirements), style: text(body.style), aspect_ratio: body.aspect_ratio, target_seconds: body.target_seconds })
        p.story.stale = !!p.story.scenes.length; p.segments.forEach(s => { s.revision++; s.shots_revision = null }); return
      }
      if (name === 'story') { p.story = { text: text(body.text), scenes: sceneValues(body.scenes), revision: p.story.revision + 1 }; p.segments.forEach(s => { s.story_stale = true; s.revision++; s.shots_revision = null }); p.stage = 'story'; return }
      if (name === 'segment') {
        const s = segment(p, body.segment_id), replacement = segmentValues([{ ...s, ...body.patch }], p, p.segments.indexOf(s))[0]
        Object.assign(s, replacement, { revision: s.revision + 1, shots: s.shots, inputs: s.inputs, generations: s.generations, selected_generation: s.selected_generation, story_stale: false }); return
      }
      if (name === 'shots') { const s = segment(p, body.segment_id); s.shots = shotValues(body.shots, s); s.revision++; s.shots_revision = s.revision; return }
      if (name === 'input') { const s = segment(p, body.segment_id); s.inputs.push(inputValue(body, s, p, target)); return }
      if (name === 'select-video') { const s = segment(p, body.segment_id); if (!s.generations.some(g => g.id === body.generation_id && g.status === 'succeeded')) fail('请选择已完成视频'); if (s.selected_generation !== body.generation_id) invalidateTailDependents(p, s.id); s.selected_generation = body.generation_id; s.selected_for_input = currentInput(s)?.id || null; return }
      if (name === 'timeline') {
        if (!Array.isArray(body.clips) || !body.clips.length || body.clips.length > 100) fail('时间线需要 1～100 个片段')
        const clips = body.clips.map(c => {
          const s = segment(p, c.segment_id), g = s.generations.find(g => g.id === c.generation_id && g.status === 'succeeded')
          if (!g || !g.url) fail('时间线片段需要有效视频')
          const start = Number(c.start || 0), end = Number(c.end || g.duration)
          if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > g.duration + .1) fail('裁切时间超出视频范围')
          return { segment_id: s.id, generation_id: g.id, url: g.url, start, end, subtitle: text(c.subtitle), transition: c.transition === 'fade' ? 'fade' : 'cut', volume: c.volume == null ? 1 : Math.max(0, Math.min(2, Number(c.volume))) }
        })
        if (body.music_url && !/^https?:\/\//.test(body.music_url)) fail('音乐必须使用服务器 URL')
        p.timeline = { revision: p.timeline.revision + 1, clips, music_url: text(body.music_url), music_volume: Math.max(0, Math.min(1, Number(body.music_volume ?? .2))) }; return
      }
      if (name !== 'request') fail('制作操作无效')
      if (project.chat_session_id && project.chat_session_id !== body.session_id) fail('请切换到项目关联会话')
      if (!body.session_id) fail('需要项目会话')
      const stage = body.stage
      if (!['story', 'segments', 'shots', 'inputs'].includes(stage)) fail('生成阶段无效')
      if (stage !== 'story' && (!p.story.scenes.length || p.story.stale)) fail('请先完成最新剧情')
      if (stage !== 'story') checkDuration(p.story.scenes, p, '剧情')
      if (['shots', 'inputs'].includes(stage)) checkDuration(p.segments, p, 'Segment')
      const targets = body.segment_id ? [segment(p, body.segment_id)] : p.segments
      if (['shots', 'inputs'].includes(stage) && (!targets.length || targets.some(s => s.story_stale))) fail('请先完成最新 Segment 规划')
      if (stage === 'inputs' && targets.some(s => s.shots_revision !== s.revision || !s.shots.length)) fail('请先完成所有目标片段的分镜')
      p.request = { id: randomUUID(), stage, session_id: body.session_id, revision: p.revision + 1, segment_ids: ['shots', 'inputs'].includes(stage) ? targets.map(s => s.id) : [], ...(target ? { target } : {}) }
    })
  }
  async function context(id, requestId, sessionId) {
    const project = await store.read(id), p = project.production, r = p?.request
    if (!r || r.id !== requestId || r.session_id !== sessionId || r.revision !== p.revision) fail('AI 请求已过期或不属于当前会话')
    return { project_id: id, request: r, original_request: p.original_request, requirements: p.requirements, style: p.style, aspect_ratio: p.aspect_ratio, target_seconds: p.target_seconds,
      story: r.stage === 'story' ? null : p.story, assets: p.assets, segments: r.segment_ids.length ? p.segments.filter(s => r.segment_ids.includes(s.id)).map(({ generations, inputs, ...s }) => {
        const previous = s.use_previous_tail && p.segments[p.segments.findIndex(v => v.id === s.id) - 1]
        return { ...s, ...(previous ? { previous_segment: { id: previous.id, title: previous.title, description: previous.description, end_state: previous.end_state } } : {}) }
      }) : [],
      instructions: await loadProductionInstructions(r.stage, p.target_seconds) }
  }
  async function complete(body, sessionId) {
    const project = await store.read(body.id), r = project.production?.request
    if (!r || r.id !== body.request_id || r.session_id !== sessionId) fail('AI 请求已过期或不属于当前会话')
    return update(body.id, r.revision, p => {
      if (r.stage === 'story') { const scenes = sceneValues(body.scenes); checkDuration(scenes, p, '剧情'); p.story = { text: text(body.text), scenes, revision: p.story.revision + 1 }; p.segments.forEach(s => { s.story_stale = true; s.revision++; s.shots_revision = null }) }
      else if (r.stage === 'segments') {
        if (p.segments.some(s => s.generations.length)) fail('已有视频，请逐段修改；重新规划需要保留原片段身份')
        if (!Array.isArray(body.segments) || body.segments.some(s => !Number.isInteger(s.character_count) || mediaFields.some(k => !s.materials?.[k] || s.materials[k].intent !== 'none' && !text(s.materials[k].description)))) fail('每个 Segment 需要 character_count；materials 的 characters/clothing/props/scene/music/ambience/dialogue 均须为 {description,intent,asset_ids}，description 不能为空，明确不需要则 intent=none。请补齐重试。')
        if (body.segments.some(s => typeof s.use_previous_tail !== 'boolean' || !text(s.tail_reason))) fail('每个 Segment 必须由 AI 判断 use_previous_tail（布尔值）并填写 tail_reason（衔接原因）；第一段必须 false。请补齐重试。')
        const segments = segmentValues(body.segments, p)
        checkDuration(segments, p, 'Segment')
        for (const scene of p.story.scenes) {
          const seconds = segments.filter(s => s.scene_id === scene.id).reduce((sum, s) => sum + s.duration, 0)
          if (Math.abs(seconds - scene.duration) > .05) fail(`Scene「${scene.title}」的 Segment 合计 ${seconds} 秒，必须等于该场景的 ${scene.duration} 秒；请在同一 scene_id 下拆成多个 4～15 秒片段，不得改动各场景时长。`)
        }
        p.segments = segments
      } else {
        if (!Array.isArray(body.segments) || body.segments.length !== r.segment_ids.length || body.segments.some((s, i) => s.id !== r.segment_ids[i])) fail('必须按请求顺序返回全部目标 Segment')
        const results = body.segments.map(v => { const s = segment(p, v.id); return r.stage === 'shots' ? shotValues(v.shots, s) : inputValue(v, s, p, r.target) })
        body.segments.forEach((v, i) => { const s = segment(p, v.id); if (r.stage === 'shots') { s.shots = results[i]; s.revision++; s.shots_revision = s.revision } else s.inputs.push(results[i]) })
      }
      p.stage = r.stage; p.request = null
    })
  }
  return { action: (name, body) => serial(() => action(name, body)), context, complete: (body, sessionId) => serial(() => complete(body, sessionId)), refresh: id => serial(async () => { await assets.refresh(id); await composition.refresh(id); return queue.tick(id) }) }
}
