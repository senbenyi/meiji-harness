// 职责：推进需求、Scene、Segment、分镜和 H3 输入阶段，隔离 AI 回写与人工提交。
import { createComposition } from './composition.js'
import { createSegmentAssets } from './segment-assets.js'
import { randomUUID } from 'node:crypto'
import { initialProduction, sceneValues, segmentValues, shotValues, mediaFields, currentInput, invalidateTailDependents, fail, text, identity, stageRun, replaceProductionRun } from '../../database/schemas/production.js'
import { createSegmentQueue } from './segment-queue.js'
import { loadProductionInstructions } from './production-rules.js'
import { batchRequest, batchState, batchHash, checkBatch, retainBatch, batchInstructions } from './production-batches.js'
import { listAssets } from '../media/catalog.js'
import { resolveGenerationBackend, describeVideoBackend } from '../../models/managers/runtime/index.js'
export function createProductionWorkflow(store, dependencies = {}) {
  const queue = createSegmentQueue(store, dependencies), assets = createSegmentAssets(store), composition = createComposition(store, dependencies)
  let operations = Promise.resolve()
  const serial = fn => { const task = operations.then(fn); operations = task.catch(() => {}); return task }
  // Harness 启动仅标记中断，等待用户点击继续或重新执行，不自动恢复提交。
  const interruptPending = () => serial(async () => {
    for (const project of await store.list()) {
      const p = (await store.read(project.id)).production
      if (!p || !p.request && !['running', 'stopping'].includes(p.queue?.status) && !p.exports.some(e => ['pending', 'running'].includes(e.status))) continue
      await store.transact(project.id, value => {
        const p = value.production
        if (p.request) { p.request.interrupted = true; stageRun(p, p.request.stage, 'interrupted') }
        if (['running', 'stopping'].includes(p.queue?.status)) { p.queue.status = 'interrupted'; p.queue.error = '服务重启，等待重新执行' }
        for (const output of p.exports) if (['pending', 'running'].includes(output.status)) output.status = 'interrupted'
        return []
      })
    }
  })
  const update = (id, revision, fn) => store.transact(id, project => {
    const p = project.production
    if (!p) fail('请先将旧项目重新规划为 Scene / Segment')
    if (revision !== p.revision) fail('制作资料已更新，请刷新后重试')
    fn(p, project); p.revision++; return []
  })
  const durationSlack = 30
  const checkDuration = (items, p, label) => {
    const total = items.reduce((n, item) => n + item.duration, 0)
    if (Math.abs(total - p.target_seconds) > durationSlack) fail(`${label}总时长为 ${total} 秒，须在项目目标 ${p.target_seconds} 秒上下 ${durationSlack} 秒以内；请调整各段时长后重试`)
  }
  const segment = (p, id) => { const s = p.segments.find(s => s.id === id); if (!s) fail('Segment 不存在'); return s }
  const editable = p => { if (p.request) fail('AI 正在生成，请先等待或取消'); if (p.queue && ['running', 'paused', 'stopping'].includes(p.queue.status)) fail('请先完成或结束视频队列再修改制作资料') }
  const plannedSegments = (items, p) => {
    if (!Array.isArray(items) || items.some(s => !Number.isInteger(s.character_count) || mediaFields.some(k => !s.materials?.[k] || s.materials[k].intent !== 'none' && !text(s.materials[k].description)))) fail('每个 Segment 需要 character_count；materials 的 characters/clothing/props/scene/music/ambience/dialogue 均须为 {description,intent,asset_ids}，description 不能为空，明确不需要则 intent=none。请补齐重试。')
    if (items.some(s => typeof s.use_previous_tail !== 'boolean' || !text(s.tail_reason))) fail('每个 Segment 必须由 AI 判断 use_previous_tail（布尔值）并填写 tail_reason（衔接原因）；第一段必须 false。请补齐重试。')
    return segmentValues(items, p)
  }
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
    if (name === 'submit') return queue.submit(body.id, body.segment_id, Boolean(body.regenerate), body.revision, Boolean(body.restart))
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
      if (name === 'cancel-request') { if (p.request) stageRun(p, p.request.stage, 'cancelled'); p.request = null; return }
      if (name === 'resume-request') {
        if (!p.request || p.request.id !== body.request_id || p.request.session_id !== body.session_id) fail('AI 请求已过期或不属于当前会话')
        p.request.interrupted = false; p.request.revision = p.revision + 1; stageRun(p, p.request.stage, 'running'); return
      }
      if (name === 'request-error') {
        if (p.request?.id !== body.request_id) fail('AI 请求已过期')
        stageRun(p, p.request.stage, 'failed', text(body.error)); p.request.revision = p.revision + 1; return
      }
      if (!(body.restart && ['request', 'description'].includes(name))) editable(p)
      if (name === 'description') {
        if (!['9:16', '16:9', '1:1', '4:3', '3:4', '21:9'].includes(body.aspect_ratio)) fail('画幅无效')
        if (!Number.isFinite(body.target_seconds) || body.target_seconds < 4 || body.target_seconds > 1500) fail('总时长须为 4～1500 秒')
        if (!text(body.requirements)) fail('创作要求不能为空')
        if (body.restart) replaceProductionRun(p)
        Object.assign(p, { original_request: body.original_request === undefined ? p.original_request : text(body.original_request), requirements: text(body.requirements), style: text(body.style), aspect_ratio: body.aspect_ratio, target_seconds: body.target_seconds })
        p.story.stale = !!p.story.scenes.length; p.segments.forEach(s => { s.revision++; s.shots_revision = null }); return
      }
      if (name === 'story') { p.story = { text: text(body.text), scenes: sceneValues(body.scenes), revision: p.story.revision + 1 }; p.segments.forEach(s => { s.story_stale = true; s.revision++; s.shots_revision = null }); stageRun(p, 'story', 'succeeded'); p.stage = 'story'; return }
      if (name === 'segment') {
        const s = segment(p, body.segment_id), replacement = segmentValues([{ ...s, ...body.patch }], p, p.segments.indexOf(s))[0]
        Object.assign(s, replacement, { revision: s.revision + 1, shots: s.shots, inputs: s.inputs, generations: s.generations, selected_generation: s.selected_generation, story_stale: false }); return
      }
      if (name === 'shots') { const s = segment(p, body.segment_id); s.shots = shotValues(body.shots, s); s.revision++; s.shots_revision = s.revision; stageRun(p, 'shots', 'succeeded'); return }
      if (name === 'input') { const s = segment(p, body.segment_id); s.inputs.push(inputValue(body, s, p, target)); stageRun(p, 'inputs', 'succeeded'); return }
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
      if (body.restart) replaceProductionRun(p)
      stageRun(p, stage, 'running')
      p.request = { id: randomUUID(), stage, ...(stage === 'story' && body.plan_segments ? { plan_segments: true } : {}), session_id: body.session_id, revision: p.revision + 1, segment_ids: ['shots', 'inputs'].includes(stage) ? targets.map(s => s.id) : [], ...(target ? { target } : {}) }
    })
  }
  async function context(id, requestId, sessionId) {
    const project = await store.read(id), p = project.production, r = p?.request
    if (!r || r.id !== requestId || r.session_id !== sessionId || r.revision !== p.revision) fail('AI 请求已过期或不属于当前会话')
    if (r.interrupted) fail('生成已中断，请在项目中点击继续未完成批次或重新执行')
    const request = batchRequest(r), saved = batchState(r).items
    return { project_id: id, request, original_request: p.original_request, requirements: p.requirements, style: p.style, aspect_ratio: p.aspect_ratio, target_seconds: p.target_seconds,
      ...(r.stage === 'segments' ? { saved_segment_ids: saved.map(s => s.id), remaining_scenes: p.story.scenes.map(scene => ({ id: scene.id, remaining_seconds: Math.max(0, scene.duration - saved.filter(s => s.scene_id === scene.id).reduce((n, s) => n + s.duration, 0)) })).filter(s => s.remaining_seconds > .05), previous_segment: saved.at(-1) || null } : {}),
      story: r.stage === 'story' ? null : p.story, assets: p.assets, segments: request.segment_ids.length ? request.segment_ids.map(id => segment(p, id)).map(({ generations, inputs, ...s }) => {
        const previous = s.use_previous_tail && p.segments[p.segments.findIndex(v => v.id === s.id) - 1]
        return { ...s, ...(previous ? { previous_segment: { id: previous.id, title: previous.title, description: previous.description, end_state: previous.end_state } } : {}) }
      }) : [],
      instructions: await loadProductionInstructions(r.plan_segments ? 'story-segments' : r.stage, p.target_seconds) + (r.stage === 'story' ? '' : batchInstructions) }
  }
  async function complete(body, sessionId) {
    const project = await store.read(body.id), r = project.production?.request
    const receipt = project.production?.completed_request
    if (!r && receipt?.id === body.request_id && receipt.session_id === sessionId && receipt.revision === project.production.revision && Number.isInteger(body.batch_index) && Array.isArray(body.segments) && receipt.hashes[body.batch_index] === batchHash(body)) return project
    if (!r || r.id !== body.request_id || r.session_id !== sessionId) fail('AI 请求已过期或不属于当前会话')
    if (r.interrupted) fail('生成已中断，请在项目中点击继续未完成批次或重新执行')
    if (r.revision !== project.production.revision) fail('制作资料已更新，请刷新后重试')
    if (r.stage !== 'story' && (body.batch_index !== undefined || r.batch)) {
      const batch = checkBatch(r, body)
      if (batch.duplicate) return project
      return update(body.id, r.revision, p => {
        let items, done
        if (r.stage === 'segments') {
          if (body.segments.some(s => s.id && batch.items.some(saved => saved.id === s.id))) fail('本批重复了已保存的 Segment ID；请省略新条目的 id，由系统生成，不能重复返回先前批次')
          items = plannedSegments([...batch.items, ...body.segments], p)
          const positions = items.map(s => p.story.scenes.findIndex(scene => scene.id === s.scene_id))
          if (positions.some((pos, i) => i && pos < positions[i - 1])) fail('Segment 必须按 Scene 的剧情顺序返回')
          let minimumRemaining = 0
          for (const [index, scene] of p.story.scenes.entries()) {
            const seconds = items.filter(s => s.scene_id === scene.id).reduce((n, s) => n + s.duration, 0)
            if (seconds > scene.duration + .05 || positions.at(-1) > index && Math.abs(seconds - scene.duration) > .05) fail(`Scene「${scene.title}」已返回 ${seconds} 秒，须按顺序完成该场景的 ${scene.duration} 秒，不能超时或跳过剩余剧情`)
            const remaining = scene.duration - seconds
            if (remaining > .05 && remaining < 4) fail(`Scene「${scene.title}」剩余 ${remaining} 秒不足一个 Segment；请调整本批时长，完整覆盖场景或至少留出 4 秒`)
            if (remaining > .05) minimumRemaining += Math.ceil(remaining / 15)
          }
          if (items.length + minimumRemaining > 100) fail('按当前分段将超过 100 个 Segment，请增大本批各段时长，为剩余剧情预留片段数量')
          done = p.story.scenes.every(scene => Math.abs(items.filter(s => s.scene_id === scene.id).reduce((n, s) => n + s.duration, 0) - scene.duration) <= .05)
          if (done) { checkDuration(items, p, 'Segment'); p.segments = items }
        } else {
          const ids = batchRequest(r).segment_ids
          if (body.segments.length !== ids.length || body.segments.some((s, i) => s.id !== ids[i])) fail('必须按请求顺序返回本批全部目标 Segment')
          items = [...batch.items, ...body.segments.map(v => {
            const s = segment(p, v.id)
            return { id: s.id, ...(r.stage === 'shots' ? { shots: shotValues(v.shots, s) } : { input: inputValue(v, s, p, r.target) }) }
          })]
          done = items.length === r.segment_ids.length
          if (done) items.forEach(v => {
            const s = segment(p, v.id)
            if (r.stage === 'shots') { s.shots = v.shots; s.revision++; s.shots_revision = s.revision } else s.inputs.push(v.input)
          })
        }
        retainBatch(p, r, batch, items, done)
      })
    }
    return update(body.id, r.revision, p => {
      if (r.stage === 'story') {
        const scenes = sceneValues(body.scenes)
        checkDuration(scenes, p, '剧情')
        const story = { text: text(body.text), scenes, revision: p.story.revision + 1 }
        if (r.plan_segments) {
          if (!story.text) fail('剧情正文不能为空')
          if (body.scenes.some(scene => !Array.isArray(scene.segments) || !scene.segments.length)) fail('每个 Scene 必须同时返回该场景的 segments')
          const segments = plannedSegments(body.scenes.flatMap((scene, i) => scene.segments.map(s => ({ ...s, id: undefined, scene_id: scenes[i].id }))), { ...p, story })
          for (const scene of scenes) {
            const seconds = segments.filter(s => s.scene_id === scene.id).reduce((n, s) => n + s.duration, 0)
            if (Math.abs(seconds - scene.duration) > .05) fail(`Scene「${scene.title}」的 Segment 合计 ${seconds} 秒，必须等于该场景的 ${scene.duration} 秒`)
          }
          p.segments = segments; stageRun(p, 'segments', 'succeeded')
        } else p.segments.forEach(s => { s.story_stale = true; s.revision++; s.shots_revision = null })
        p.story = story
      }
      else if (r.stage === 'segments') {
        const segments = plannedSegments(body.segments, p)
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
      stageRun(p, r.stage, 'succeeded'); p.stage = r.stage; p.request = null
    })
  }
  return { interruptPending, action: (name, body) => serial(() => action(name, body)), context: (...args) => serial(() => context(...args)), complete: (body, sessionId) => serial(() => complete(body, sessionId)), refresh: id => serial(async () => { await assets.refresh(id); await composition.refresh(id); return queue.tick(id) }) }
}
