// 职责：将项目信息转换为经验证的可生产分镜。
import { actsValue, serverUrl, validJobId } from '../../database/schemas/projects.js'
import { statusError } from '../../utils/errors.js'

const invalidOutput = message => statusError(502, `分镜生成结果无效：${message}`)

function storyboardSchema(roles) {
  const shot = { type: 'object', additionalProperties: false, properties: {
    role: { type: 'string', enum: ['', ...roles] }, action: { type: 'string' }, subtitle: { type: 'string' }, notes: { type: 'string' },
  }, required: ['role', 'action', 'subtitle', 'notes'] }
  return { type: 'object', additionalProperties: false, properties: { acts: { type: 'array', items: {
    type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, shots: { type: 'array', items: shot } }, required: ['title', 'shots'],
  } } }, required: ['acts'] }
}

export async function generateStoryboard(project, complete) {
  if (!project.anchors.length) throw statusError(400, '请先添加至少一个锚点')
  const roles = project.anchors.map(anchor => anchor.role)
  const result = await complete({ name: 'project_storyboard', schema: storyboardSchema(roles),
    system: '你是短剧分镜师。仅返回符合 JSON Schema 的分镜，镜头必须能独立用于视频生成，动作描述要包含主体、场景、动作、镜头和光线。',
    user: `为以下项目生成 1–3 幕、每幕 2–6 镜的精简完整分镜。\n项目：${project.title}\n导演风格：${project.director}\n锚点：${JSON.stringify(project.anchors.map(({ role, label, description }) => ({ role, label, description })))}` })
  if (!result || !Array.isArray(result.acts)) throw invalidOutput('缺少幕列表')
  const roleSet = new Set(roles)
  let total = 0
  const acts = result.acts.map(act => ({ title: typeof act?.title === 'string' ? act.title.trim() : '', shots: Array.isArray(act?.shots) ? act.shots.map(shot => {
    total++
    const role = typeof shot?.role === 'string' ? shot.role : ''
    if (!roleSet.has(role) && role !== '') throw invalidOutput('引用了未知锚点')
    const action = typeof shot?.action === 'string' ? shot.action.trim() : ''
    if (!action) throw invalidOutput('镜头缺少动作描述')
    const anchor = project.anchors.find(item => item.role === role)
    const referenced = validJobId(anchor?.source?.job_id) || serverUrl(anchor?.image_url)
    return { role, action, subtitle: typeof shot.subtitle === 'string' ? shot.subtitle.trim() : '', mode: referenced ? 'i2va' : 't2va', job_id: null, status: 'pending', notes: typeof shot.notes === 'string' ? shot.notes.trim() : '' }
  }) : [] }))
  if (!acts.length || acts.length > 3 || acts.some(act => !act.title || act.title.length > 200 || !act.shots.length || act.shots.length > 6
    || act.shots.some(shot => shot.action.length > 2000 || shot.subtitle.length > 1000 || shot.notes.length > 1000)) || total > 18) {
    throw invalidOutput('幕或镜头数量无效')
  }
  return actsValue(acts)
}
