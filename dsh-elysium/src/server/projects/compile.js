// 职责：从总览与一镜剧本编译首帧、视频和字幕输入；台词只在这里拼进视频提示词。
import { statusError } from '../../utils/errors.js'

export function compileShot(series, shot, anchors = {}) {
  const characters = series.characters || [], scene = series.scenes.find(item => item.name === shot.scene)
  if (!scene) throw statusError(400, `镜头 ${shot.id} 的场景不存在`)
  const dialogue = shot.lines.flatMap(item => {
    const match = /^(.+?)（(.+?)）：(.+)$/.exec(item.text.trim())
    return match ? [{ role: match[1], tone: match[2], text: match[3] }] : []
  })
  const roles = shot.roles?.length ? shot.roles : characters.filter(character =>
    shot.lines.some(line => line.text.includes(character.name))).map(character => character.name)
  const cast = roles.map(name => characters.find(item => item.name === name)).filter(Boolean)
  const lead = cast[0], anchor = lead && anchors[lead.name]
  if (lead && !anchor?.source_job_id) throw statusError(409, `角色「${lead.name}」缺少定妆图`)
  const keyframe = [shot.keyframe, scene.description, ...cast.map(item => `${item.name}: ${item.appearance}`)].filter(Boolean).join('\n')
  const spoken = dialogue.map(line => {
    const voice = characters.find(item => item.name === line.role)?.voice || ''
    return `${line.role}（${line.tone}；${voice}）：${line.text}`
  })
  const video = [shot.video, ...(spoken.length ? [`台词：\n${spoken.join('\n')}`] : [])].filter(Boolean).join('\n\n')
  return { keyframe_prompt: keyframe, prompt: video, reference_job_id: anchor?.source_job_id || null,
    dialogue, roles, duration: shot.duration }
}
