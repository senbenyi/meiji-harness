import { DomainValidationError } from './errors.js'
import { ENTITY_COLLECTIONS, entityFor, IMAGE_DETAILS, VIDEO_DETAILS } from '../prompts/specification.js'

// Page editors expose business fields; writes still go through domain commands.
export function productionEditor(project, { kind, id }) {
  const field = (key, label, value, type = 'text') => ({ key, label, value: value ?? '', type })
  const entity = entityFor(project, kind, id)
  const episode = project.episodes[id]
  const shot = project.shots[id]
  if (kind === 'analysis' && project.storyBible) return { title: '编辑故事分析', fields: [field('summary', '故事分析', project.storyBible.summary, 'textarea')] }
  if (ENTITY_COLLECTIONS[kind] && entity) return { title: '编辑设定', fields: [field('name', '名称', entity.name), field('description', '设定描述', entity.description || entity.appearance, 'textarea')] }
  if (['asset-prompt', 'image-prompt', 'video-prompt'].includes(kind)) {
    const target = kind === 'asset-prompt' ? Object.values(ENTITY_COLLECTIONS).map((key) => project[key]?.[id]).find(Boolean) : shot
    if (!target) throw new DomainValidationError('提示词目标不存在')
    const specification = target[kind === 'asset-prompt' ? 'generation' : kind === 'image-prompt' ? 'imageGeneration' : 'videoGeneration']
    const details = kind === 'video-prompt' ? VIDEO_DETAILS : IMAGE_DETAILS
    const labels = { subject: '主体与状态', appearance: '外观与细节', composition: '构图与机位', lighting: '光照与色彩', style: '视觉风格', constraints: '保持项与限制', action: '动作时间线', camera: '镜头运动', timing: '时长分配', continuity: '起止状态与衔接', sound: '对白与声音' }
    return { title: '提示词', fields: [field('prompt', '提示词', specification?.prompt, 'textarea'), field('negativePrompt', '负向提示词（选填）', specification?.negativePrompt, 'textarea'), ...details.map((key) => field(key, labels[key], specification?.details?.[key], 'textarea'))] }
  }
  if (kind === 'outline' && episode) return { title: '编辑分集规划', fields: [field('title', '集名', episode.title), field('outline', '分集规划', episode.outline, 'textarea')] }
  if (kind === 'script' && episode) return {
    title: '编辑剧本与镜头', fields: [field('script', '剧本（请同步镜头）', episode.script, 'textarea')],
    shots: (episode.shotIds || []).map((shotId) => ({ id: shotId, title: project.shots[shotId].title, fields: shotFields(project.shots[shotId], field) })),
  }
  if (['shot', 'video'].includes(kind) && shot) return { title: kind === 'video' ? '编辑视频设置' : '编辑镜头', fields: [...shotFields(shot, field), field('script', '本集剧本（画面或对白变更时须同步）', project.episodes[shot.episodeId]?.script, 'textarea')] }
  if (kind === 'delivery') return { title: '编辑合成设置', fields: [field('title', '项目名称', project.title), field('strategy', '合成方式', project.productionSpec.assemblyStrategy || 'preserve', 'strategy')] }
  if (kind === 'source' && project.sourceDocuments[id]) return { title: '替换原文', fields: [field('title', '素材名称', project.sourceDocuments[id].title), field('text', '新原文（旧版本保留）', '', 'textarea')] }
  throw new DomainValidationError('未找到可编辑内容，请先完成前序阶段')
}

function shotFields(shot, field) {
  return [field('title', '镜头名称', shot.title), field('shotDescription', '画面说明', shot.shotDescription, 'textarea'), field('prompt', '提示词', shot.prompt, 'textarea'), field('duration', '时长（秒，最多 8）', shot.duration, 'number'), field('audioDialogue', '对白', shot.audioDialogue, 'textarea'), field('audioNotes', '声音说明', shot.audioNotes, 'textarea')]
}

export function assertReworkIdle(project) {
  if (['archived', 'cancelled'].includes(project.status)) throw new DomainValidationError('项目已归档或取消，不可编辑')
  const active = Object.values(project.productionTasks || {}).some((task) => ['ready', 'pending', 'leased', 'running'].includes(task.status))
  if (active) throw new DomainValidationError('任务进行中，请完成后再编辑或重新生成')
}

export function editableValues(project, target, values) {
  const editor = productionEditor(project, target)
  const result = {}
  for (const field of editor.fields) {
    if (!(field.key in values)) continue
    const value = field.type === 'number' ? Number(values[field.key]) : String(values[field.key])
    if (field.type === 'number' && !(value > 0 && value <= 8)) throw new DomainValidationError('镜头时长必须大于 0 且不超过 8 秒')
    if (!['audioDialogue', 'audioNotes', 'negativePrompt'].includes(field.key) && !String(value).trim()) throw new DomainValidationError(`${field.label}不能为空`)
    if (field.key === 'strategy' && !['preserve', 'strict'].includes(value)) throw new DomainValidationError('不支持的合成方式')
    result[field.key] = value
  }
  if (editor.shots) {
    if (!Array.isArray(values.shots) || values.shots.length !== editor.shots.length) throw new DomainValidationError('请保留本集完整镜头列表')
    result.shots = editor.shots.map((shot) => {
      const item = values.shots.find((value) => value.id === shot.id)
      if (!item) throw new DomainValidationError('镜头列表不完整')
      return { ...project.shots[shot.id], ...editableValues(project, { kind: 'shot', id: shot.id }, item) }
    })
  }
  return result
}
