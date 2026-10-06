import { DomainValidationError } from './errors.js'

// Page editors expose business fields; writes still go through domain commands.
export function productionEditor(project, { kind, id }) {
  const field = (key, label, value, type = 'text') => ({ key, label, value: value ?? '', type })
  const entity = project[kind === 'character' ? 'characters' : 'locations']?.[id]
  const episode = project.episodes[id]
  const shot = project.shots[id]
  if (kind === 'analysis' && project.storyBible) return { title: '修改故事分析', fields: [field('summary', '故事分析', project.storyBible.summary, 'textarea')] }
  if (['character', 'location'].includes(kind) && entity) return { title: '修改设定', fields: [field('name', '名称', entity.name), field('description', '设定描述', entity.description || entity.appearance, 'textarea')] }
  if (kind === 'outline' && episode) return { title: '修改分集规划', fields: [field('title', '集名', episode.title), field('outline', '本集规划', episode.outline, 'textarea')] }
  if (kind === 'script' && episode) return {
    title: '修改本集剧本与镜头', fields: [field('script', '正式剧本（请同步下方镜头内容）', episode.script, 'textarea')],
    shots: (episode.shotIds || []).map((shotId) => ({ id: shotId, title: project.shots[shotId].title, fields: shotFields(project.shots[shotId], field) })),
  }
  if (['shot', 'video'].includes(kind) && shot) return { title: kind === 'video' ? '修改镜头生成设置' : '修改镜头', fields: [...shotFields(shot, field), field('script', '本集正式剧本（画面或对白修改时须同步）', project.episodes[shot.episodeId]?.script, 'textarea')] }
  if (kind === 'delivery') return { title: '修改合成设置', fields: [field('title', '项目名称', project.title), field('strategy', '合成方式', project.productionSpec.assemblyStrategy || 'preserve', 'strategy')] }
  if (kind === 'source' && project.sourceDocuments[id]) return { title: '替换原文', fields: [field('title', '素材名称', project.sourceDocuments[id].title), field('text', '新原文（旧版本保留）', '', 'textarea')] }
  throw new DomainValidationError('没有找到可修改的正式内容，请先完成上一步')
}

function shotFields(shot, field) {
  return [field('title', '镜头名称', shot.title), field('shotDescription', '画面说明', shot.shotDescription, 'textarea'), field('prompt', '生成提示词', shot.prompt, 'textarea'), field('duration', '计划时长（秒，最多 8 秒）', shot.duration, 'number'), field('audioDialogue', '对白', shot.audioDialogue, 'textarea'), field('audioNotes', '声音说明', shot.audioNotes, 'textarea')]
}

export function assertReworkIdle(project) {
  if (['archived', 'cancelled'].includes(project.status)) throw new DomainValidationError('项目已归档或取消，不能修改')
  const active = Object.values(project.productionTasks || {}).some((task) => ['ready', 'pending', 'leased', 'running'].includes(task.status))
  if (active) throw new DomainValidationError('项目仍有制作任务，请等待任务结束后再修改或重新生成')
}

export function editableValues(project, target, values) {
  const editor = productionEditor(project, target)
  const result = {}
  for (const field of editor.fields) {
    if (!(field.key in values)) continue
    const value = field.type === 'number' ? Number(values[field.key]) : String(values[field.key])
    if (field.type === 'number' && !(value > 0 && value <= 8)) throw new DomainValidationError('镜头时长必须大于 0 且不超过 8 秒')
    if (!['audioDialogue', 'audioNotes'].includes(field.key) && !String(value).trim()) throw new DomainValidationError(`${field.label}不能为空`)
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
