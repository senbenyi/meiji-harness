// 职责：从总览与一镜剧本编译首帧、视频和字幕输入；台词只在这里拼进视频提示词。
import { statusError } from '../../utils/errors.js'

// 出场角色按画面顺序：对白行只取说话人（台词里提到的名字不算），动作行按名字出现先后；第一位是首帧参考的主体。
export function shotRoles(characters, lines) {
  const names = characters.map(item => item.name), found = []
  const add = name => { if (names.includes(name) && !found.includes(name)) found.push(name) }
  for (const line of lines) {
    const text = line.text.trim(), speaker = /^(.+?)（[^）]+）：/.exec(text)?.[1]
    if (speaker) { add(speaker); continue }
    const body = text.replace(/^(动作|音效)：/, '')
    names.map(name => [body.indexOf(name), name]).filter(([index]) => index >= 0).sort((a, b) => a[0] - b[0]).forEach(([, name]) => add(name))
  }
  return found
}

export function compileShot(series, shot, anchors = {}) {
  const characters = series.characters || [], scene = series.scenes.find(item => item.name === shot.scene)
  if (!scene) throw statusError(400, `镜头 ${shot.id} 的场景不存在`)
  const dialogue = shot.lines.flatMap(item => {
    const match = /^(.+?)（(.+?)）：(.+)$/.exec(item.text.trim())
    return match ? [{ role: match[1], tone: match[2], text: match[3] }] : []
  })
  const named = (shot.roles || []).filter(name => characters.some(item => item.name === name))
  const roles = named.length ? named : shotRoles(characters, shot.lines)
  const cast = roles.map(name => characters.find(item => item.name === name))
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
