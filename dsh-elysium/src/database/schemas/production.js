// 职责：定义 Scene、Segment、分镜与素材意图的稳定身份和校验。
import { randomUUID } from 'node:crypto'
import { statusError } from '../../utils/errors.js'
export const fail = message => { throw statusError(409, message) }
export const identity = prefix => `${prefix}-${randomUUID()}`
export const text = value => typeof value === 'string' ? value.trim() : ''
export const mediaFields = ['characters', 'clothing', 'props', 'scene', 'music', 'ambience', 'dialogue']
export const initialProduction = project => ({ revision: 0, stage: 'description', original_request: project.brief || project.title,
  requirements: [project.brief || project.title, project.configuration?.reference_text].filter(Boolean).join('\n\n参考剧情：\n'), aspect_ratio: project.aspect_ratio || '9:16', style: project.director || '', target_seconds: (project.duration_min || 1) * 60,
  story: { revision: 0, text: '', scenes: [] }, assets: [], segments: [], request: null, queue: null, timeline: { revision: 0, clips: [], music_url: '', music_volume: 0.2 }, export_episode_count: 1, exports: [] })
export function sceneValues(items) {
  if (!Array.isArray(items) || !items.length || items.length > 100) fail('需要 1～100 个 Scene')
  const ids = new Set()
  return items.map((s, i) => {
    const id = s.id || identity('scene')
    if (!/^scene-[a-zA-Z0-9-]+$/.test(id) || ids.has(id)) fail('Scene ID 无效或重复')
    ids.add(id)
    if (!text(s.description) || !Number.isFinite(s.duration) || s.duration <= 0) fail('场景需要剧情描述和预计时长')
    return { id, title: text(s.title) || `Scene ${i + 1}`, description: text(s.description), location: text(s.location), time: text(s.time), duration: s.duration }
  })
}
export function materialValues(value = {}) {
  return Object.fromEntries(mediaFields.map(key => {
    const v = value[key] || {}, intent = v.intent || 'auto'
    if (typeof v !== 'object' || Array.isArray(v)) fail(`素材 ${key} 必须包含 description、intent、asset_ids`)
    if (!['auto', 'specified', 'none'].includes(intent)) fail('素材意图无效')
    const ids = Array.isArray(v.asset_ids) ? v.asset_ids : []
    if (intent === 'specified' && !ids.length) fail('指定素材时至少选择一项')
    return [key, { description: text(v.description), intent, asset_ids: intent === 'none' ? [] : ids }]
  }))
}
export function segmentValues(items, production, offset = 0) {
  if (!Array.isArray(items) || !items.length || items.length > 100) fail('需要 1～100 个 Segment')
  const ids = new Set()
  return items.map((s, i) => {
    const id = s.id || identity('segment')
    if (!/^segment-[a-zA-Z0-9-]+$/.test(id) || ids.has(id)) fail('Segment ID 无效或重复')
    ids.add(id)
    if (!production.story.scenes.some(scene => scene.id === s.scene_id)) fail('Segment 必须归属有效 Scene')
    if (!Number.isFinite(s.duration) || s.duration < 4 || s.duration > 15) fail('Segment 时长须为 4～15 秒')
    if (!text(s.description)) fail('Segment 需要动作剧情描述')
    if (s.use_previous_tail !== undefined && typeof s.use_previous_tail !== 'boolean') fail('沿用上一段尾帧必须为布尔值')
    if (s.use_previous_tail && i + offset === 0) fail('第一个 Segment 没有上一段尾帧')
    const materials = materialValues(s.materials)
    for (const field of Object.values(materials)) for (const assetId of field.asset_ids) if (!production.assets.some(a => a.id === assetId)) fail('片段引用了不存在的项目素材')
    const characterCount = s.character_count ?? materials.characters.asset_ids.length
    if (!Number.isInteger(characterCount) || characterCount < materials.characters.asset_ids.length || characterCount > 100) fail('人物数量必须为不小于指定人物数的 0～100 整数')
    return { id, scene_id: s.scene_id, title: text(s.title) || `Segment ${i + 1}`, duration: s.duration, character_count: characterCount, description: text(s.description),
      start_state: text(s.start_state), end_state: text(s.end_state), use_previous_tail: s.use_previous_tail ?? false, tail_reason: text(s.tail_reason), materials, revision: 0, shots_revision: null, shots: [], inputs: [], generations: [], selected_generation: null }
  })
}
export function shotValues(items, segment) {
  if (!Array.isArray(items) || !items.length || items.length > 20) fail('需要 1～20 个分镜')
  let start = 0
  const ids = new Set()
  const shots = items.map(s => {
    if (!Number.isFinite(s.duration) || s.duration <= 0 || !text(s.action)) fail('分镜需要有效时长和动作描述')
    const id = s.id || identity('shot')
    if (!/^shot-[a-zA-Z0-9-]+$/.test(id) || ids.has(id)) fail('分镜 ID 无效或重复')
    ids.add(id)
    const shot = { id, start, duration: s.duration, action: text(s.action), framing: text(s.framing), camera: text(s.camera), lighting: text(s.lighting), dialogue: text(s.dialogue), sound: text(s.sound) }
    start += s.duration; return shot
  })
  if (Math.abs(start - segment.duration) > 0.05) fail(`分镜总时长必须等于片段的 ${segment.duration} 秒`)
  return shots
}
export const currentInput = s => s.inputs.findLast(i => i.source_revision === s.revision && s.shots_revision === s.revision)
export const currentGeneration = s => s.generations.findLast(g => g.input_id === currentInput(s)?.id && g.status === 'succeeded')
// 上游换版后，连续沿用尾帧的后段需要重新生成；独立片段截断依赖。
export function invalidateTailDependents(production, segmentId) {
  for (let i = production.segments.findIndex(s => s.id === segmentId) + 1; i < production.segments.length && production.segments[i].use_previous_tail; i++) production.segments[i].tail_stale = true
}
