// 职责：校验并规范化持久化的项目、锚点、分镜、交付物与自动生产字段。
import { statusError } from '../../utils/errors.js'

const invalidRequest = message => statusError(400, message)

export const validProjectId = id => typeof id === 'string' && /^(?:[a-f0-9]{8}|\d{17})$/.test(id)
export const validShotId = id => typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id)
export const validJobId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
export const validEpisode = value => Number.isInteger(value) && value >= 1 && value <= 100
const textValue = value => typeof value === 'string' && value.length <= 20000
const filled = value => textValue(value) && Boolean(value.trim())
const optionalJob = value => value === null || validJobId(value)

export function titleValue(title) {
  if (typeof title !== 'string' || !title.trim() || title.length > 500) throw invalidRequest('请输入项目标题（最多 500 字）')
  return title.trim()
}

export function directorValue(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80) throw invalidRequest('请选择有效导演')
  return value.trim()
}

export function storyValue(value, label, limit = 20000) {
  if (typeof value !== 'string' || value.length > limit) throw invalidRequest(`${label}无效`)
  return value.trim()
}

// 角色锚点带英文出图提示词、参考图与最近一次出图任务；场景锚点只保留文字。
export function anchorValue(anchor, existingRoles = new Set()) {
  const character = anchor?.kind === 'character'
  if (!anchor || !filled(anchor.role) || existingRoles.has(anchor.role) || !['character', 'scene'].includes(anchor.kind) ||
    !filled(anchor.label) || !textValue(anchor.description) || (character ? !filled(anchor.image_prompt) : anchor.image_prompt !== undefined) ||
    !(anchor.source === null || character && anchor.source && ['job', 'material'].includes(anchor.source.type) && validJobId(anchor.source.job_id)) ||
    (anchor.image_job_id !== undefined && !(character && optionalJob(anchor.image_job_id))) ||
    (anchor.retired !== undefined && typeof anchor.retired !== 'boolean') ||
    (anchor.image_needs_review !== undefined && typeof anchor.image_needs_review !== 'boolean')) throw invalidRequest('锚点字段无效或角色重复')
  return { role: anchor.role, kind: anchor.kind, label: anchor.label, description: anchor.description,
    ...(character ? { image_prompt: anchor.image_prompt, image_job_id: anchor.image_job_id ?? null } : {}), source: anchor.source,
    ...(anchor.retired === undefined ? {} : { retired: anchor.retired }),
    ...(anchor.image_needs_review === undefined ? {} : { image_needs_review: anchor.image_needs_review }) }
}

export function anchorsValue(anchors) {
  if (!Array.isArray(anchors) || anchors.length > 1000) throw invalidRequest('锚点列表无效')
  const roles = new Set()
  return anchors.map(anchor => {
    const value = anchorValue(anchor, roles)
    roles.add(value.role)
    return value
  })
}

export function shotValue(shot) {
  if (!shot || !validShotId(shot.id) || !Array.isArray(shot.roles) || shot.roles.some(role => !filled(role)) ||
    !['scene', 'shot_size', 'camera', 'action', 'subtitle', 'prompt', 'keyframe_prompt'].every(key => textValue(shot[key])) ||
    !Number.isInteger(shot.duration) || shot.duration < 1 || shot.duration > 15 ||
    !Array.isArray(shot.dialogue) || shot.dialogue.some(line => !filled(line?.role) || !filled(line?.text)) ||
    typeof shot.prompt_finalized !== 'boolean' || !Number.isInteger(shot.take) || shot.take < 0 || !optionalJob(shot.job_id) || !optionalJob(shot.keyframe_job_id) ||
    !['pending', 'queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(shot.status)) throw invalidRequest('镜字段无效')
  return Object.fromEntries(['id', 'roles', 'scene', 'shot_size', 'camera', 'action', 'duration', 'dialogue', 'subtitle',
    'prompt', 'keyframe_prompt', 'prompt_finalized', 'take', 'keyframe_job_id', 'job_id', 'status'].map(key => [key, shot[key]]))
}

export function actsValue(acts) {
  if (!Array.isArray(acts) || acts.length > 1000) throw invalidRequest('幕列表无效')
  let index = 0
  const ids = new Set()
  return acts.map(act => {
    if (!act || !textValue(act.title) || !Array.isArray(act.shots)) throw invalidRequest('幕字段无效')
    return { title: act.title, shots: act.shots.map(shot => {
      const value = shotValue(shot)
      if (++index > 1000 || ids.has(value.id)) throw invalidRequest('镜 ID 重复或超过 1000 镜')
      ids.add(value.id)
      return value
    }) }
  })
}

export function deliverablesValue(items) {
  if (!Array.isArray(items) || items.length > 1000) throw invalidRequest('交付列表无效')
  return items.map(item => {
    if (!item || !['film', 'subtitle'].includes(item.type) || !textValue(item.label) || !validJobId(item.job_id) ||
      ['duration_sec', 'size_bytes', 'created_at'].some(key => item[key] !== undefined && (!Number.isFinite(item[key]) || item[key] < 0))) throw invalidRequest('交付物字段无效')
    return Object.fromEntries(['type', 'label', 'job_id', 'duration_sec', 'size_bytes', 'created_at'].filter(key => item[key] !== undefined).map(key => [key, item[key]]))
  })
}

// 自动生产状态：attempts 以「集/镜」为键记录本轮自动重拍次数。
export function autoValue(value) {
  const paused = value.paused ?? null
  const auto = { enabled: value.enabled ?? false, until_episode: value.until_episode ?? null, anchors_confirmed: value.anchors_confirmed ?? false,
    cascade_confirmed: value.cascade_confirmed ?? false, paused, attempts: value.attempts ?? {} }
  if (![auto.enabled, auto.anchors_confirmed, auto.cascade_confirmed].every(item => typeof item === 'boolean') ||
    !(auto.until_episode === null || validEpisode(auto.until_episode)) ||
    !(paused === null || paused && filled(paused.reason) && (paused.episode === undefined || validEpisode(paused.episode)) &&
      (paused.step === undefined || filled(paused.step)) && (paused.shot_id === undefined || validShotId(paused.shot_id))) ||
    !auto.attempts || typeof auto.attempts !== 'object' || Object.values(auto.attempts).some(count => !Number.isInteger(count) || count < 0)) throw invalidRequest('自动生产状态无效')
  return auto
}
