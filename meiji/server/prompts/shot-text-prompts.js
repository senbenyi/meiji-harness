import { entityCatalog, entityMention } from '../../shared/entity-references.js'
import { secondsText } from '../../shared/seconds-content.js'
import { checkReasons } from '../runtime/review-checks.js'
import { checkContext } from '../runtime/operation-context.js'
import { shotResults } from '../../shared/drama-model.js'
import { buildTextPrompts } from './text-prompts.js'
import { feedbackOf } from '../../shared/review-feedback.js'
import { splitSecondsIssues } from './seconds-feedback.js'

// 镜头表及单镜镜头表修订的上下文，按 { title, text } 分段交给 prompt-request.js。
// 镜头表步骤给全部资料；单镜修订只给衔接所需：本镜及前后镜关联的卡片、
// 前镜末段与后镜开场的每秒指令，不再附相邻镜头的完整每秒指令。大纲存在时不重复附本集摘要。
const cardKeys = ['id', 'name', 'type', 'look', 'space', 'landmark', 'light', 'description', 'category', 'ownerId', 'evidence', 'identity', 'clothes', 'props', 'hairstyles']
const cleanCard = card => Object.fromEntries(cardKeys.filter(key => card[key] != null).map(key => [key, Array.isArray(card[key]) ? card[key].map(cleanCard) : card[key]]))
const shotData = shot => ({ shotId: shot.id, durationSeconds: shot.duration, content: body(shot) })
const entityFacts = project => [
  { title: '【实体引用清单】', text: { entities: entityCatalog(project).map(({ id, name, kind, ownerId }) => ({ id, name, kind, ...(ownerId ? { ownerId } : {}), reference: entityMention({ id, name }) })) } },
  { title: '【实体标注规则】', text: '正文每次提到清单内实体，按 reference 原样写作「名字【名字|ID】」；清单外物件直接描述。台词原文不插标记，说话人单独标注，仅被提及的人物不算出镜。' },
]

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
  const content = shot?.seconds?.check?.passed === true && !shot.seconds.stale ? shot.seconds.content : null
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
    ...entityFacts(project),
    { title: '【本次参数】', text: project.style ? { style: project.style } : '' },
    { title: '【上游事实：本集摘要】', text: !project.plot.outline.content && project.summary?.content ? { summary: project.summary.content } : '' },
    { title: '【上游事实：大纲】', text: project.plot.outline.content ? { outline: project.plot.outline.content } : '' },
    { title: single ? '【上游事实：本镜及前后镜关联人物】' : '【上游事实：人物资料】', text: cards('characters') },
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
  })
}

// 镜头表资料：大纲为核心输入，随后是参数（时长、项目风格）、角色/场景/道具卡与实体引用清单。
function tableFacts(project, min, max) {
  const context = shotContext({ ...project, shots: { ...project.shots, items: [] } })
  const cards = context.filter(fact => /^【上游事实：(人物|场景|道具)资料】$/.test(fact.title))
  return [
    { title: '【核心输入：大纲】', text: { outline: project.plot.outline.content } },
    { title: '【本次参数】', text: { durationSeconds: project.durationSeconds, minDurationSeconds: min, maxDurationSeconds: max, minShotDurationSeconds: 1, maxShotDurationSeconds: 15, ...(project.style ? { style: project.style } : {}) } },
    ...cards,
    ...context.filter(fact => ['【实体引用清单】', '【实体标注规则】'].includes(fact.title)),
  ].filter(fact => fact.text)
}

export function buildTablePrompts(options) {
  const { project } = options
  const min = Math.max(1, project.durationSeconds - 10), max = project.durationSeconds + 10
  return buildShotPrompts('shots', {
    task: '依据大纲生成本集完整镜头表，遵守基础规则和补充规则。',
    review: `验收本集完整镜头表：覆盖大纲事件与结尾，编号连续、单镜1–15秒且总时长在 ${min}–${max} 秒内（含边界），条目格式完整，镜头之间起止状态承接。`,
    facts: tableFacts(project, min, max),
  }, options)
}

export function buildSingleShotPrompts(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  return buildShotPrompts('shot-revise', {
    task: `依据本镜基稿和本次意见修订 ${shotId}，遵守基础规则和补充规则。`,
    review: `验收 ${shotId}（${shot.duration}s）的修订结果：意见落实、只改动指定镜头、标题字段与条目完整、与前后镜衔接。`,
    facts: [{ title: '【本次参数】', text: { shotId, durationSeconds: shot.duration, ...(project.style ? { style: project.style } : {}) } },
      ...shotContext(project, shotId).filter(fact => fact.title !== '【本次参数】')],
  }, options)
}

// 每秒指令带本镜剧情及关联资料、前镜完整指令与大纲，不引入其他镜头的旧稿。
export function buildSecondsPrompts(options) {
  const { project, shotId } = options
  const index = project.shots.items.findIndex(item => item.id === shotId)
  const shot = project.shots.items[index], previous = project.shots.items[index - 1]
  const related = relatedEntities([shot])
  const cards = (group, title) => { const items = (project.plot[group]?.items || [])
    .filter(card => related.has(card.id) || related.has(card.name) || (card.ownerId && related.has(card.ownerId)))
    .map(cleanCard); return { title, text: items.length ? { [group]: items } : '' } }
  return buildShotPrompts('seconds', {
    task: `依据本镜分段剧情与关联资料生成 ${shotId} 的每秒指令，承接上一镜已通过指令，遵守基础规则和补充规则。`,
    review: `验收 ${shotId}（0–${shot.duration}s）的每秒指令：剧情、时长与交接状态符合本镜镜头表，具体镜头设计与空间调度符合关联资料，与上一镜已通过指令连续。`,
    facts: [
      { title: '【核心输入：本镜镜头表】', text: shotData(shot) },
      { title: '【连续性参考：上一镜每秒指令】', text: previous?.seconds.check.passed === true && !previous.seconds.stale ? { seconds: previous.seconds.content } : '' },
      cards('characters', '【上游事实：本镜关联人物】'), cards('scenes', '【上游事实：本镜关联场景】'), cards('props', '【上游事实：本镜关联道具】'),
      { title: '【整体内容参考：剧情大纲】', text: project.plot.outline.content ? { outline: project.plot.outline.content } : '' },
      { title: '【本次参数】', text: { shotId, durationSeconds: shot.duration, startMs: 0, endMs: shot.duration * 1000, ...(project.style ? { style: project.style } : {}) } },
      ...entityFacts(project),
    ].filter(fact => fact.text),
  }, options)
}

// 引用编排直接以已通过的每秒指令为唯一时间线来源（不再经过独立的文本镜头转写），
// 只提供本镜关联资料与固定素材清单，不再次审核整集剧情与前镜最终稿。
export function storyboardSource(shot) {
  return secondsText(shot?.seconds?.content)
}
