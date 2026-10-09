import { bindNamedText } from './film-characters.js'
import { libraryTarget } from './library-rules.js'
import { referencedEntities, entityCatalog, collapseMentions, entityMention } from './entity-references.js'
export const secondsVersion = 2
export const narratorId = 'NARRATOR'
const fail = message => { throw new Error(message) }
const nonempty = value => typeof value === 'string' && value.trim()
const array = (value, name) => { if (!Array.isArray(value)) fail(`${name}必须为数组`); return value }
// 本集称谓和可选服装目录；不展开未关联的项目角色或重复固定外貌。
export function secondsCharacterRoster(project, shotId) {
  return (project?.plot?.characters?.items || []).map(card => {
    const target = card.ref && libraryTarget(project, 'characters', card.ref)
    const name = card.sourceName || card.name
    const costumes = target?.variant.fields.costumes || card.costumes || []
    const aliases = [...new Set([card.name, card.sourceName, ...(target?.entry.aliases || [])].filter(value => value && value !== name))]
    const defaultCostumeId = target?.variant.fields.defaultCostumeId ?? card.defaultCostumeId ?? ''
    const rows = project.shots?.items || [], index = rows.findIndex(shot => shot.id === shotId)
    const prior = rows.slice(0, Math.max(0, index)).reverse().filter(shot => shot.seconds?.check.passed === true)
      .flatMap(shot => shot.seconds.content?.participants || []).find(person => person.presence === 'visible' && (person.name === name || aliases.includes(person.name)))
    return { name, aliases, ...(costumes.length ? { costumes, defaultCostumeId,
      ...(shotId ? { currentCostumeId: prior?.costumeId || defaultCostumeId, ...(prior ? { confirmedOutfit: prior.outfit } : {}) } : {}) } : {}) }
  })
}
// participants是角色卡参与子集；只清理卡外条目，不修改剧情及对白。
export function normalizeSecondsParticipants(content, project) {
  if (content?.version !== 2 || !Array.isArray(content.participants)) return content
  const roster = secondsCharacterRoster(project)
  const participants = content.participants.filter(person => !nonempty(person?.name) || person.name !== person.name.trim()
    || roster.some(card => card.name === person.name || card.aliases.includes(person.name)))
  return participants.length === content.participants.length ? content : { ...content, participants }
}
export function validateSeconds(content, shot, project) {
  if (![1, secondsVersion].includes(content?.version) || content.shotId !== shot.id) fail(`${shot.id} 每秒指令结构或镜头ID错误`)
  if (!nonempty(content.summary)) fail(`${shot.id} 缺少本镜事件概要`)
  const beats = array(content.beats, 'beats')
  if (!beats.length) fail(`${shot.id} 没有动作节拍`)
  const ids = new Set(), dialogueUses = new Map()
  let total = 0
  for (const b of beats) {
    if (!nonempty(b.id) || ids.has(b.id)) fail(`${shot.id} 节拍ID缺失或重复`)
    ids.add(b.id)
    if (!Number.isSafeInteger(b.durationMs) || b.durationMs <= 0) fail(`${shot.id}/${b.id} durationMs必须为正整数毫秒`)
    total += b.durationMs
    if (!['continue', 'cut'].includes(b.transition)) fail(`${shot.id}/${b.id} transition必须为continue或cut`)
    for (const k of ['action', 'camera', 'space', 'sound', 'endState']) if (!nonempty(b[k])) fail(`${shot.id}/${b.id} 缺少${k}`)
    for (const id of array(b.dialogueIds, 'dialogueIds')) dialogueUses.set(id, (dialogueUses.get(id) || 0) + 1)
  }
  if (total !== shot.duration * 1000) fail(`${shot.id} 节拍总时长${total}ms，应为${shot.duration * 1000}ms`)
  const speakers = new Set(entityCatalog(project).filter(e => e.kind === 'character').map(e => e.id))
  const dialogues = array(content.dialogues, 'dialogues'), seen = new Set()
  for (const d of dialogues) {
    if (!nonempty(d.id) || seen.has(d.id)) fail(`${shot.id} 对白ID缺失或重复`)
    seen.add(d.id)
    const validSpeaker = content.version === 2
      ? nonempty(d.speakerName) && (d.speakerName !== narratorId || d.delivery === 'off') && !/[【】]/.test(d.speakerName)
      : d.speakerId === narratorId ? d.delivery === 'off' : speakers.has(d.speakerId)
    if (!validSpeaker || !nonempty(d.text) || !nonempty(d.language) || !['on', 'off', 'inner'].includes(d.delivery) || !nonempty(d.performance)) fail(`${shot.id}/${d.id} 对白身份、原文、语言或表演信息不完整`)
    if (!Number.isSafeInteger(d.startMs) || !Number.isSafeInteger(d.endMs) || d.startMs < 0 || d.endMs <= d.startMs || d.endMs > total) fail(`${shot.id}/${d.id} 对白时间越界`)
    if (/[【】]/.test(d.text)) fail(`${shot.id}/${d.id} 台词原文不得包含实体标记`)
    if (dialogueUses.get(d.id) !== 1) fail(`${shot.id}/${d.id} 对白事件必须且只能引用一次`)
    let start = 0
    for (const b of beats) {
      if (b.dialogueIds.includes(d.id) && (d.startMs < start || d.startMs >= start + b.durationMs)) fail(`${shot.id}/${d.id} 对白须从引用它的节拍开始，跨段持续可写endMs`)
      start += b.durationMs
    }
  }
  for (const id of dialogueUses.keys()) if (!seen.has(id)) fail(`${shot.id} 引用了不存在的对白${id}`)
  for (const [kind, events] of [['ambient', content.ambient], ['music', content.music]]) for (const e of array(events, kind)) {
    if (!nonempty(e.text) || !Number.isSafeInteger(e.startMs) || !Number.isSafeInteger(e.endMs) || e.startMs < 0 || e.endMs <= e.startMs || e.endMs > total) fail(`${shot.id} ${kind}声音内容或时间错误`)
  }
  const participants = content.participants
  if (participants !== undefined) {
    const roster = secondsCharacterRoster(project)
    const names = new Set()
    for (const person of array(participants, 'participants')) {
      if (!nonempty(person?.name) || person.name !== person.name.trim() || person.name === narratorId || /[【】]/.test(person.name) || !['visible', 'voice'].includes(person.presence) || names.has(person.name)) fail(`${shot.id} participants人物称谓、出镜类型错误或重复`)
      if (person.outfit !== undefined && (typeof person.outfit !== 'string' || person.presence === 'visible' && (!person.outfit.trim() || /[【】]/.test(person.outfit)) || person.presence === 'voice' && person.outfit !== '')) fail(`${shot.id} participants人物「${person.name}」着装outfit错误：出镜人物填写一段非空文字，仅声音人物留空`)
      if (person.costumeId !== undefined) {
        const costumes = roster.find(card => card.name === person.name || card.aliases.includes(person.name))?.costumes || []
        if (typeof person.costumeId !== 'string' || person.costumeId && (person.presence !== 'visible' || !costumes.some(costume => costume.id === person.costumeId))) fail(`${shot.id} 人物「${person.name}」服装 ID 无效`)
      }
      names.add(person.name)
    }
    for (const dialogue of dialogues) {
      const name = dialogue.speakerName
      if (content.version !== 2 || name === narratorId) continue
      const matches = roster.filter(card => card.name === name || card.aliases.includes(name))
      if (matches.length > 1) fail(`${shot.id}/${dialogue.id} 说话人「${name}」对应多张本集角色卡，请先明确称谓`)
      const person = participants.find(person => person.name === name || matches.length === 1 && (matches[0].name === person.name || matches[0].aliases.includes(person.name)))
      // 卡外剧情人物仍保留动作和台词，不强制建卡，也不伪装成独立旁白。
      if (!person && !matches.length) continue
      if (!person) fail(`${shot.id}/${dialogue.id} 说话人「${name}」属于本集角色卡，必须列入participants参与人物清单`)
      if (dialogue.delivery === 'on' && person.presence !== 'visible') fail(`${shot.id}/${dialogue.id} 说话人与participants出镜类型不一致：人物「${name}」的画内对白delivery=on，参与类型须为visible，当前为${person.presence}`)
    }
  }
  const visual = beats.map(b => [b.action, b.camera, b.space, b.endState].join('\n')).join('\n')
  const catalogForBinding = entityCatalog(project).filter(entity => !participants || entity.kind !== 'character' || participants.some(person => person.presence === 'visible' && (person.name === entity.name || person.name === entity.card.sourceName)))
  const entities = referencedEntities(content.version === 2 ? bindNamedText(visual, project, catalogForBinding) : visual, project)
  if (content.version === 2 && participants) {
    for (const entity of catalogForBinding.filter(entity => entity.kind === 'character')) if (!entities.some(item => item.id === entity.id)) entities.push(entity)
  }
  referencedEntities([content.summary, ...beats.map(b => b.sound), ...content.ambient.map(e => e.text), ...content.music.map(e => e.text)].join('\n'), project)
  // 已登记人物/场景在正文出现时不能绕过标记；对白原文不参加名称扫描。
  if (content.version === 2) {
    for (const dialogue of dialogues.filter(dialogue => dialogue.delivery === 'on')) {
      const entity = entityCatalog(project).find(entity => entity.kind === 'character' && (entity.name === dialogue.speakerName || entity.card.sourceName === dialogue.speakerName))
      if (entity && !entities.some(item => item.id === entity.id)) entities.push(entity)
    }
    return entities
  }
  const missing = [], catalog = entityCatalog(project)
  for (const beat of beats) for (const field of ['action', 'camera', 'space', 'endState']) {
    for (const { entity, snippet } of bareMentions(beat[field], project, catalog)) missing.push(`${shot.id}/${beat.id}.${field} 片段「${snippet}」中的${entity.name}须写为${entityMention(entity)}（只改这一处，已标记的不动）`)
  }
  if (missing.length) fail(missing.join('；'))
  return entities
}
// 找出正文中没有标记的实体名，返回带上下文的片段；已标记部分按名字显示，长名字优先，避免「武松宅邸卧房」里再报「武松」。
function bareMentions(text, project, catalog) {
  const parts = collapseMentions(text, project).split(/(【[^【】]+】)/)
  const shown = parts.map((part, i) => i % 2 ? (part.match(/^【([^【】|]+)\|/)?.[1] ?? part) : part)
  const full = shown.join(''), names = catalog.filter(e => e.name).sort((a, b) => b.name.length - a.name.length)
  const hits = [], covered = []
  let offset = 0
  parts.forEach((part, i) => {
    if (!(i % 2)) for (const entity of names) {
      for (let at = part.indexOf(entity.name); at >= 0; at = part.indexOf(entity.name, at + entity.name.length)) {
        const start = offset + at, end = start + entity.name.length
        if (covered.some(([s, e]) => start < e && end > s)) continue
        covered.push([start, end])
        hits.push({ entity, start, end })
      }
    }
    offset += shown[i].length
  })
  return hits.sort((a, b) => a.start - b.start).map(({ entity, start, end }) => ({
    entity,
    snippet: `${start > 12 ? '…' : ''}${full.slice(Math.max(0, start - 12), end + 12)}${end + 12 < full.length ? '…' : ''}`,
  }))
}
// 新响应必须返回角色清单；历史已保存指令仍可由 validateSeconds 兼容。
function requireParticipants(content, shot, project) {
  if (content?.version !== 2) return
  if (!Array.isArray(content.participants)) fail(`${shot.id} 新每秒指令必须返回participants参与人物数组`)
  const roster = secondsCharacterRoster(project, shot.id), used = new Set()
  for (const person of content.participants) {
    if (person?.presence === 'visible' && !nonempty(person.outfit) || person?.presence === 'voice' && person.outfit !== '') fail(`${shot.id} participants人物「${person?.name || '未命名'}」必须返回outfit：出镜人物为非空着装段落，仅声音人物为空字符串`)
    const matches = roster.filter(card => card.name === person?.name || card.aliases.includes(person?.name))
    if (!matches.length) fail(`${shot.id} participants人物称谓无效：${person?.name || '未命名'}`)
    if (matches.length > 1) fail(`${shot.id} participants人物「${person.name}」对应多张本集角色卡，请先明确称谓`)
    if (person.presence === 'visible' && matches[0].costumes?.length && !matches[0].costumes.some(costume => costume.id === person.costumeId)) fail(`${shot.id} 人物「${person.name}」须从服装目录选择 costumeId`)
    if (person.presence === 'visible' && matches[0].costumes?.length) {
      const expected = matches[0].currentCostumeId
      if (!expected) fail(`${shot.id} 人物「${person.name}」缺少默认服装，请在人物资料设置默认服装`)
      const evidence = person.costumeEvidence
      if (evidence !== undefined && typeof evidence !== 'string') fail(`${shot.id} costumeEvidence须为本镜服装依据原文或空字符串`)
      if (evidence && !shot.content.includes(evidence.trim())) fail(`${shot.id} 服装依据必须逐字引用本镜镜头表，不能引用其他镜头或自行编造`)
      if (person.costumeId !== expected && !evidence?.trim()) fail(`${shot.id} 人物「${person.name}」无明确服装依据，须沿用当前/默认服装 ${expected}；剧情明确指定另一套时填写costumeEvidence`)
    }
    if (used.has(matches[0])) fail(`${shot.id} participants人物「${person.name}」与已列人物对应同一本集角色卡，不得重复列出`)
    used.add(matches[0])
  }
}
export function parseSecondsResponse(text, shots, project) {
  let result
  try { result = JSON.parse(text) } catch { fail('每秒指令必须返回完整JSON，不能截断或包裹代码围栏') }
  const rows = array(result.shots, 'shots')
  const ids = rows.map(s => s.shotId)
  if (new Set(ids).size !== ids.length || rows.length !== shots.length || shots.some(s => !ids.includes(s.id))) fail(`每秒指令镜头清单不符：应为${shots.map(s => s.id).join('、')}，实际${ids.join('、')}；不得漏镜、重复或新增镜头`)
  return shots.map(shot => {
    const content = normalizeSecondsParticipants(rows.find(s => s.shotId === shot.id), project)
    requireParticipants(content, shot, project)
    validateSeconds(content, shot, project)
    return content
  })
}
// 保存与验收分开：保持剧情正文，只规范化参与清单，逐镜校验错误单独记录。
export function parseSecondsPartial(text, shots, project) {
  let result
  try { result = JSON.parse(text) } catch { fail('每秒指令必须返回完整JSON，不能截断或包裹代码围栏') }
  const rows = array(result.shots, 'shots')
  const ids = rows.map(s => s?.shotId)
  if (new Set(ids).size !== ids.length || rows.length !== shots.length || shots.some(s => !ids.includes(s.id))) fail(`每秒指令镜头清单不符：应为${shots.map(s => s.id).join('、')}，实际${ids.join('、')}；不得漏镜、重复或新增镜头`)
  const failures = {}
  const sections = shots.map(shot => {
    const content = normalizeSecondsParticipants(rows.find(s => s.shotId === shot.id), project)
    try { requireParticipants(content, shot, project); validateSeconds(content, shot, project); return content }
    catch (error) { failures[shot.id] = error.message.includes(shot.id) ? error.message : `${shot.id}：${error.message}`; return content }
  })
  return { sections, failures }
}
export const secondsRange = (start, end) => `${start / 1000}–${end / 1000}s`
export function secondsText(content) {
  if (!content) return ''
  try {
    if (![1, secondsVersion].includes(content.version) || !Array.isArray(content.beats)) return JSON.stringify(content, null, 2)
    let start = 0
    const lines = [`事件：${content.summary}`]
    lines.push(`参与人物：${Array.isArray(content.participants) ? content.participants.map(person => `${person.name}（${person.presence === 'visible' ? '出镜' : '仅声音'}）`).join('、') || '无' : '未记录'}`)
    for (const person of content.participants || []) if (person.presence === 'visible') lines.push(`${person.name}着装：${person.outfit || '未记录'}`)
    for (const b of content.beats) {
      lines.push(`### ${secondsRange(start, start + b.durationMs)}`, `动作：${b.action}`, `镜头：${b.transition === 'cut' ? '切镜；' : ''}${b.camera}`, `空间：${b.space}`, `声音：${b.sound}`)
      for (const id of b.dialogueIds) {
        const d = content.dialogues.find(d => d.id === id)
        lines.push(`${(d.speakerName || d.speakerId) === narratorId ? '旁白' : '对白'} ${d.id}（${secondsRange(d.startMs, d.endMs)}，${d.speakerName || d.speakerId}，${d.delivery}，${d.performance}）：${d.text}`)
      }
      lines.push(`交接：${b.endState}`); start += b.durationMs
    }
    for (const [label, events] of [['环境声', content.ambient], ['配乐', content.music]]) for (const e of events) lines.push(`${label} ${secondsRange(e.startMs, e.endMs)}：${e.text}`)
    return lines.join('\n')
  } catch { return JSON.stringify(content, null, 2) }
}
