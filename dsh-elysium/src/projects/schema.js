// 职责：校验并规范化项目标题、档位、锚点、分镜与交付物字段。
import { invalidRequest } from '../http/shared.js'

export const validProjectId = id => typeof id === 'string' && /^[a-f0-9]{8}$/.test(id)
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

export function anchorsValue(anchors) {
  if (!Array.isArray(anchors) || anchors.length > 1000) throw invalidRequest('锚点列表无效')
  const roles = new Set()
  return anchors.map(anchor => {
    if (!anchor || !['role', 'label', 'description'].every(key => textValue(anchor[key])) || !anchor.role.trim() || roles.has(anchor.role) ||
      !(anchor.image_url === '' || serverUrl(anchor.image_url)) ||
      !(anchor.source === null || anchor.source && ['job', 'material'].includes(anchor.source.type) && validJobId(anchor.source.job_id))) throw invalidRequest('锚点字段无效或角色重复')
    roles.add(anchor.role)
    return { role: anchor.role, label: anchor.label, description: anchor.description, source: anchor.source, image_url: anchor.image_url }
  })
}

export function actsValue(acts) {
  if (!Array.isArray(acts) || acts.length > 1000) throw invalidRequest('幕列表无效')
  let index = 0
  return acts.map(act => {
    if (!act || !textValue(act.title) || !Array.isArray(act.shots)) throw invalidRequest('幕字段无效')
    return { title: act.title, shots: act.shots.map(shot => {
      if (++index > 1000 || !shot || !['role', 'action', 'subtitle', 'mode', 'notes'].every(key => textValue(shot[key])) ||
        !(shot.job_id === null || validJobId(shot.job_id)) || !['pending', 'queued', 'running', 'succeeded', 'failed'].includes(shot.status)) throw invalidRequest('镜字段无效或超过 1000 镜')
      return { index, role: shot.role, action: shot.action, subtitle: shot.subtitle, mode: shot.mode, job_id: shot.job_id, status: shot.status, notes: shot.notes }
    }) }
  })
}

export function deliverablesValue(items) {
  if (!Array.isArray(items) || items.length > 1000) throw invalidRequest('交付列表无效')
  return items.map(item => {
    if (!item || !['type', 'label'].every(key => textValue(item[key])) ||
      !(validJobId(item.job_id) || serverUrl(item.url)) || (item.url !== undefined && !serverUrl(item.url)) ||
      (item.job_id !== undefined && !validJobId(item.job_id)) ||
      ['duration_sec', 'frame_count', 'size_bytes', 'created_at'].some(key => item[key] !== undefined && (!Number.isFinite(item[key]) || item[key] < 0))) throw invalidRequest('交付物需提供任务 ID 或服务器 URL，规格必须为非负数')
    return Object.fromEntries(['type', 'label', 'job_id', 'url', 'duration_sec', 'frame_count', 'size_bytes', 'created_at'].filter(key => item[key] !== undefined).map(key => [key, item[key]]))
  })
}
