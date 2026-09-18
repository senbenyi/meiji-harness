// 职责：校验并规范化持久化的项目、素材、锚点、分镜与交付物字段。
import { validEpisodeId } from './episodes.js'
import { statusError } from '../../utils/errors.js'

const invalidRequest = message => statusError(400, message)

export const validProjectId = id => typeof id === 'string' && /^[a-f0-9]{8}$/.test(id)
export const validShotId = id => typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id)
export const validJobId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
export const serverUrl = value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}
const textValue = value => typeof value === 'string' && value.length <= 20000

export function titleValue(title) {
  if (typeof title !== 'string' || !title.trim() || title.length > 500) throw invalidRequest('请输入项目标题（最多 500 字）')
  return title.trim()
}

export function profileValue(value) {
  if (!['preview', 'regular', 'high-quality', 'hd'].includes(value)) throw invalidRequest('档次无效')
  return value
}

export function directorValue(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80) throw invalidRequest('请选择有效导演')
  return value.trim()
}

export function materialsValue(values) {
  if (!Array.isArray(values) || values.length > 1000 || values.some(value => !validJobId(value))) throw invalidRequest('素材列表无效')
  return [...new Set(values)]
}

export function anchorValue(anchor, existingRoles = new Set()) {
  if (!anchor || !['role', 'label', 'description'].every(key => textValue(anchor[key])) || !anchor.role.trim() || existingRoles.has(anchor.role) ||
    !(anchor.image_url === '' || serverUrl(anchor.image_url)) ||
    !(anchor.source === null || anchor.source && ['job', 'material'].includes(anchor.source.type) && validJobId(anchor.source.job_id))) throw invalidRequest('锚点字段无效或角色重复')
  return { role: anchor.role, label: anchor.label, description: anchor.description, source: anchor.source, image_url: anchor.image_url }
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
  if (!shot || !['role', 'action', 'subtitle', 'mode', 'notes'].every(key => textValue(shot[key])) ||
    (shot.id !== undefined && !validShotId(shot.id)) ||
    !(shot.job_id === null || validJobId(shot.job_id)) || !['pending', 'queued', 'running', 'succeeded', 'failed'].includes(shot.status)) throw invalidRequest('镜字段无效')
  const extra = {}
  for (const key of ['framing', 'camera', 'lighting', 'sound', 'prompt', 'reference_id', 'scene']) {
    if (shot[key] !== undefined) { if (!textValue(shot[key])) throw invalidRequest('分镜描述无效'); extra[key] = shot[key] }
  }
  for (const key of ['characters', 'props']) if (shot[key] !== undefined) extra[key] = materialsValue(shot[key])
  if (shot.duration !== undefined) { if (!Number.isInteger(shot.duration) || shot.duration < 1 || shot.duration > 15) throw invalidRequest('每镜时长为 1～15 秒'); extra.duration = shot.duration }
  return { ...extra, ...(shot.id === undefined ? {} : { id: shot.id }), role: shot.role, action: shot.action, subtitle: shot.subtitle, mode: shot.mode, job_id: shot.job_id, status: shot.status, notes: shot.notes }
}

// 项目类型仅作分类，当前共用创作流程。
export function modeValue(value = 'director') {
  if (!['director', 'free', 'teaching'].includes(value)) throw invalidRequest('项目模式无效')
  return value
}
export function briefValue(value) {
  if (!textValue(value)) throw invalidRequest('创作需求最多 2 万字符')
  return value.trim()
}
export function configurationValue(input = {}) {
  const result = {}
  for (const key of ['male', 'female', 'scene']) {
    const value = input[key] ?? null
    if (value !== null && !validJobId(value)) throw invalidRequest(`${key} 素材 ID 无效`)
    result[key] = value
  }
  const theme = input.theme == null || input.theme === '' ? [] : Array.isArray(input.theme) ? input.theme : [input.theme]
  result.theme = materialsValue(theme)
  for (const key of ['supporting', 'props']) result[key] = materialsValue(input[key] ?? [])
  result.director = input.director ? directorValue(input.director) : null
  result.reference_text = input.reference_text ?? ''
  if (typeof result.reference_text !== 'string' || result.reference_text.length > 100000) throw invalidRequest('参考文本最多 10 万字符，请导入需要改编的章节')
  return result
}
export function plotValue(value) {
  if (typeof value !== 'string' || !value.trim() || [...value.replace(/\s/g, '')].length > 200) throw invalidRequest('剧情需为 1～200 字（含标点，不含空白）')
  return value.trim()
}

export function actsValue(acts) {
  if (!Array.isArray(acts) || acts.length > 1000) throw invalidRequest('幕列表无效')
  let index = 0
  const ids = new Set()
  return acts.map(act => {
    if (!act || (act.episode_id !== undefined && !validEpisodeId(act.episode_id)) || !textValue(act.title) || !Array.isArray(act.shots)) throw invalidRequest('幕字段无效')
    return { ...(act.episode_id ? { episode_id: act.episode_id } : {}), title: act.title, shots: act.shots.map(shot => {
      const value = shotValue(shot)
      if (++index > 1000 || value.id !== undefined && ids.has(value.id)) throw invalidRequest('镜 ID 重复或超过 1000 镜')
      if (value.id !== undefined) ids.add(value.id)
      return { index, ...value }
    }) }
  })
}

export function deliverablesValue(items) {
  if (!Array.isArray(items) || items.length > 1000) throw invalidRequest('交付列表无效')
  return items.map(item => {
    if (!item || (item.episode_id !== undefined && !validEpisodeId(item.episode_id)) || !['type', 'label'].every(key => textValue(item[key])) ||
      !(validJobId(item.job_id) || serverUrl(item.url)) || (item.url !== undefined && !serverUrl(item.url)) ||
      (item.job_id !== undefined && !validJobId(item.job_id)) ||
      ['duration_sec', 'frame_count', 'size_bytes', 'created_at'].some(key => item[key] !== undefined && (!Number.isFinite(item[key]) || item[key] < 0))) throw invalidRequest('交付物需提供任务 ID 或服务器 URL，规格必须为非负数')
    return Object.fromEntries(['episode_id', 'type', 'label', 'job_id', 'url', 'duration_sec', 'frame_count', 'size_bytes', 'created_at'].filter(key => item[key] !== undefined).map(key => [key, item[key]]))
  })
}
