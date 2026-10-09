import { shotTableBudget } from '../../shared/shot-table-timing.js'
import { secondsCharacterRoster } from '../../shared/seconds-content.js'
import { checkReasons } from '../runtime/review-checks.js'
import { checkContext } from '../runtime/operation-context.js'
import { shotResults } from '../../shared/drama-model.js'
import { buildTextPrompts } from './text-prompts.js'
import { feedbackOf } from '../../shared/review-feedback.js'
import { splitSecondsIssues } from './seconds-feedback.js'

// 镜头表及单镜镜头表修订的上下文，按 { title, text } 分段交给 prompt-request.js。
// 人物身份与外貌的剧情事实从大纲和镜头叙事读取，不注入人物卡；单镜修订只给衔接所需的历史环境/道具资料、
// 前镜末段与后镜开场的每秒指令，不再附相邻镜头的完整每秒指令。剧集摘要仅作展示，不注入制作请求。
const cardKeys = ['id', 'name', 'type', 'look', 'space', 'landmark', 'light', 'description', 'category', 'ownerId', 'evidence', 'identity']
const cleanCard = card => Object.fromEntries(cardKeys.filter(key => card[key] != null).map(key => [key, Array.isArray(card[key]) ? card[key].map(cleanCard) : card[key]]))
const shotData = shot => ({ shotId: shot.id, durationSeconds: shot.duration, content: body(shot) })

// 本镜及前后镜实际关联的实体：镜头选择的人物、场景，以及正文中的【名字|ID】标记。
function relatedEntities(shots) {
  const ids = new Set()
  for (const shot of shots.filter(Boolean)) {
    for (const value of [...(shot.cast || []), shot.scene].filter(Boolean)) ids.add(value)
    for (const match of String(body(shot)).matchAll(/【[^|｜】]+[|｜]([^】]+)】/g)) ids.add(match[1].split('.')[0])
  }
  return ids
}

// 前镜最后一段与后镜第一段：只交代衔接状态。
function handoff(shot, position) {
  const content = shot?.seconds?.check?.passed === true ? shot.seconds.content : null
  const beats = content?.beats || []
  const beat = position === 'end' ? beats.at(-1) : beats[0]
  if (!beat) return ''
  return { shotId: shot.id, position, action: beat.action, camera: beat.camera, space: beat.space, sound: beat.sound,
    ...(position === 'end' ? { endState: beat.endState } : {}) }
}

export function shotContext(project, shotId) {
  const rows = project.shots?.items || []
  const index = rows.findIndex(shot => shot.id === shotId)
  const single = Boolean(shotId) && index >= 0
  const [previous, current, next] = single ? [rows[index - 1], rows[index], rows[index + 1]] : []
  const related = single ? relatedEntities([previous, current, next]) : null
  const pick = (items = []) => single ? items.filter(card => related.has(card.id) || related.has(card.name) || (card.ownerId && related.has(card.ownerId))) : items
  const cards = group => { const items = pick(project.plot[group]?.items); return items.length ? { [group]: items.map(cleanCard) } : '' }
  const handoffs = [handoff(previous, 'end'), handoff(next, 'start')].filter(Boolean)
  return [
    { title: '【剧情大纲】', text: project.plot.outline.content ? project.plot.outline.content : '' },
    { title: single ? '【上游事实：本镜及前后镜关联道具】' : '【上游事实：道具资料】', text: cards('props') },
    { title: single ? '【上游事实：本镜及前后镜关联场景】' : '【上游事实：场景资料】', text: cards('scenes') },
    { title: '【上游事实：已通过镜头表，同编号是本镜依据】', text: !shotId && rows.length ? { shots: rows.map(shotData) } : '' },
    { title: '【上下文：前镜已发生，本次不重演】', text: previous ? shotData(previous) : '' },
    { title: '【上下文：后镜尚未发生，本次不提前演出】', text: next ? shotData(next) : '' },
    { title: '【上下文：相邻镜头每秒指令的衔接段，不重复执行】', text: handoffs.length ? { handoffs } : '' },
  ].filter(fact => fact.text)
}
function body(shot) { return shot?.content || '' }

export function buildShotPrompts(skill, instructions, options) {
  const ctx = checkContext.getStore()
  const original = ctx?.originalProject || options.project
  const action = { shots: 'shots', 'shot-revise': 'revise-shot', seconds: 'shot-seconds', storyboard: 'shot-storyboard' }[skill]
  const opinion = ctx?.generationMode === 'regenerate' ? '' : [...new Set([options.review, ctx?.review, ...checkReasons(original, { action, track: options.shotId })].filter(Boolean))].join('\n')
  const shot = original.shots?.items?.find(item => item.id === options.shotId)
  const board = shotResults(original, 'storyboard')?.find(item => item.id === options.shotId)
  const previous = skill === 'seconds' ? (shot?.seconds.content ? JSON.stringify({ shots: [shot.seconds.content] }) : '')
    : skill === 'storyboard' ? (board?.prompt?.text || (board?.prompt ? JSON.stringify(board.prompt) : ''))
    : action === 'shots' ? { shots: original.shots?.items.map(shotData) || [] } : shot ? shotData(shot) : ''
  if (skill === 'seconds') {
    const record = feedbackOf(original, `seconds:${options.shotId}`)
    const regenerate = ctx?.generationMode === 'regenerate'
    const human = regenerate ? '' : options.review ?? ctx?.batchReview ?? ctx?.review ?? record.review.text ?? ''
    const issues = splitSecondsIssues(regenerate ? [] : record.check?.passed === false ? record.check.failures : [])
    const modify = Boolean(previous && (ctx?.generationMode === 'modify' || human || issues.programIssues.length || issues.semanticIssues.length))
    return buildTextPrompts({ skill, project: options.project, shotId: options.shotId, instructions, modify,
      baseContent: modify ? previous : '', opinion: human, ...issues })
  }
  return buildTextPrompts({ skill, project: options.project, shotId: options.shotId, opinion, mode: options.mode || '', modify: Boolean(previous && opinion),
    instructions, baseContent: previous && opinion ? previous : '',
    reviewOpinion: ctx?.generationMode === 'regenerate' ? '' : options.review ?? ctx?.batchReview ?? ctx?.review ?? '',
  })
}

// 镜头表资料：大纲为核心输入，随后是时长参数与历史场景/道具资料。
function tableFacts(project, min, max) {
  const context = shotContext({ ...project, shots: { ...project.shots, items: [] } })
  const cards = context.filter(fact => /^【上游事实：(场景|道具)资料】$/.test(fact.title))
  return [
    { title: '【拆镜依据优先级】', text: '最新故事小段是本集拆镜的剧情依据，逐项覆盖其全部明确细节；人工编辑版本允许覆盖原剧本或创作方向，不恢复已删除或改写的内容。摘要只用于展示，不作为拆镜和审核依据。' },
    { title: '【剧情大纲】', text: project.plot.outline.content },
    { title: '【本次参数】', text: { durationSeconds: project.durationSeconds, minDurationSeconds: min, maxDurationSeconds: max, minShotDurationSeconds: 1, maxShotDurationSeconds: 15 } },
    { title: '【逐段固定拆镜预算】', text: shotTableBudget(project.plot.outline.content) },
    ...cards,
  ].filter(fact => fact.text)
}

export function buildTablePrompts(options) {
  const { project } = options
  const { target } = shotTableBudget(project.plot.outline.content), min = target, max = target
  return buildShotPrompts('shots', {
    task: '按大纲各小段既定时长和正文逐段拆镜，每镜1–15秒，段内合计精确等于来源时长；不跨段、不改剧情、不扩写补时，输出完整镜头表。',
    review: `验收本集完整镜头表：按拆镜依据优先级逐项核对故事小段全部细节覆盖，不只检查关键事件；编号连续、单镜1–15秒及各段固定时长及全表总时长 ${min} 秒由程序校验；语义审核检查叙事清楚、完整台词保留，镜头之间剧情状态承接；不要求固定栏目或分段理由。`,
    facts: tableFacts(project, min, max),
  }, options)
}

export function buildSingleShotPrompts(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  return buildShotPrompts('shot-revise', {
    task: `依据本镜基稿和本次意见修订 ${shotId}，遵守基础规则和补充规则。`,
    review: `验收 ${shotId}（${shot.duration}s）的修订结果：意见落实、只改动指定镜头、标题字段与叙事完整、与前后镜衔接；不要求固定栏目或分段理由。`,
    facts: [{ title: '【本次参数】', text: { shotId, durationSeconds: shot.duration } },
      ...shotContext(project, shotId).filter(fact => fact.title !== '【本次参数】')],
  }, options)
}

// 只提取已通过前镜的切点参考；动作进度由末态表达，不传此前过程或已结束对白。
function secondsHandoff(shot) {
  const content = shot?.seconds?.check?.passed === true ? shot.seconds.content : null
  const beat = content?.beats?.at(-1)
  if (!beat?.endState) return ''
  const total = shot.duration * 1000
  const active = events => (events || []).filter(event => event.startMs < total && event.endMs === total).map(event => event.text)
  const outfits = (content.participants || []).filter(person => person.presence === 'visible' && person.outfit).map(person => ({name:person.name,outfit:person.outfit}))
  return { shotId: shot.id, ...(outfits.length ? {outfits} : {}), endState: beat.endState, camera: beat.camera, space: beat.space, sound: beat.sound,
    ambient: active(content.ambient), music: active(content.music) }
}

// 每秒指令带本镜叙事及关联资料、前镜交接摘要与大纲，不引入前镜完整过程或后镜旧稿。
export function buildSecondsPrompts(options) {
  const { project, shotId } = options
  const index = project.shots.items.findIndex(item => item.id === shotId)
  const shot = project.shots.items[index], previous = project.shots.items[index - 1]
  const related = relatedEntities([shot])
  const cards = (group, title) => { const items = (project.plot[group]?.items || [])
    .filter(card => related.has(card.id) || related.has(card.name) || (card.ownerId && related.has(card.ownerId)))
    .map(cleanCard); return { title, text: items.length ? { [group]: items } : '' } }
  return buildShotPrompts('seconds', {
    task: `依据本镜叙事与关联资料生成 ${shotId} 的每秒指令，按上一镜交接摘要承接必要状态，遵守基础规则和补充规则。`,
    review: `验收 ${shotId}（0–${shot.duration}s）的每秒指令：剧情、台词、时长与交接状态符合本镜镜头表，具体镜头设计与空间调度符合关联资料，与上一镜交接摘要无实质矛盾。`,
    facts: [
      { title: '【本镜镜头表】', text: shotData(shot) },
      { title: '【本集角色卡人物清单：参与人物仅从中选取】', text: secondsCharacterRoster(project) },
      { title: '【连续性参考：上一镜交接摘要】', text: secondsHandoff(previous) },
      cards('scenes', '【上游事实：本镜关联场景】'), cards('props', '【上游事实：本镜关联道具】'),
      { title: '【剧情大纲】', text: project.plot.outline.content ? project.plot.outline.content : '' },
      { title: '【本次参数】', text: { shotId, durationSeconds: shot.duration, startMs: 0, endMs: shot.duration * 1000 } },
    ].filter(fact => fact.text),
  }, options)
}
