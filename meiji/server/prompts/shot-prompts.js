import { entityInstructions } from '../../shared/entity-references.js'
import { secondsText } from '../../shared/seconds-content.js'
import { checkReasons } from '../data/review-checks.js'
import { checkContext } from '../data/operation-context.js'
import { shotResults } from '../../shared/drama-model.js'
import { buildTextPrompts } from './text-prompts.js'
import { feedbackOf } from '../../shared/feedback.js'
import { splitSecondsIssues } from './seconds-feedback.js'

// 镜头相关步骤的上游事实与上下文，按 { title, text } 分段返回，由 request.js 组装进 user。
// 整集步骤（镜头表、整集每秒指令）给全部资料；单镜步骤只给衔接所需：本镜及前后镜关联的卡片、
// 前镜末段与后镜开场的每秒指令，不再附相邻镜头的完整每秒指令。大纲存在时不重复附本集摘要。
const cardKeys = ['id', 'name', 'type', 'look', 'space', 'landmark', 'light', 'description', 'category', 'ownerId', 'evidence', 'identity', 'clothes', 'props', 'hairstyles']
const cleanCard = card => Object.fromEntries(cardKeys.filter(key => card[key] != null).map(key => [key, Array.isArray(card[key]) ? card[key].map(cleanCard) : card[key]]))

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
  return position === 'end'
    ? `${shot.id} 末段：动作：${beat.action}\n镜头：${beat.camera}\n空间：${beat.space}\n声音：${beat.sound}\n段末状态：${beat.endState}`
    : `${shot.id} 开场：动作：${beat.action}\n镜头：${beat.camera}\n空间：${beat.space}\n声音：${beat.sound}`
}

export function shotContext(project, shotId) {
  const rows = project.shots?.items || []
  const index = rows.findIndex(shot => shot.id === shotId)
  const single = Boolean(shotId) && index >= 0
  const [previous, current, next] = single ? [rows[index - 1], rows[index], rows[index + 1]] : []
  const related = single ? relatedEntities([previous, current, next]) : null
  const pick = (items = []) => single ? items.filter(card => related.has(card.id) || related.has(card.name) || (card.ownerId && related.has(card.ownerId))) : items
  const cards = group => { const items = pick(project.plot[group]?.items); return items.length ? JSON.stringify(items.map(cleanCard)) : '' }
  const entities = entityInstructions(project).replace(/^【实体引用清单】\n/, '')
  return [
    { title: '【实体引用清单】', text: entities },
    { title: '【本次参数】', text: project.style ? `项目风格：${project.style}` : '' },
    { title: '【上游事实：本集摘要】', text: project.plot.outline.content ? '' : project.summary?.content },
    { title: '【上游事实：大纲】', text: project.plot.outline.content },
    { title: single ? '【上游事实：本镜及前后镜关联人物】' : '【上游事实：人物资料】', text: cards('characters') },
    { title: single ? '【上游事实：本镜及前后镜关联道具】' : '【上游事实：道具资料】', text: cards('props') },
    { title: single ? '【上游事实：本镜及前后镜关联场景】' : '【上游事实：场景资料】', text: cards('scenes') },
    { title: '【上游事实：已通过镜头表，同编号是本镜依据】', text: !shotId ? rows.map(shot => `## ${shot.id} / ${shot.duration}s\n${body(shot)}`).join('\n\n') : '' },
    { title: '【上下文：前镜已发生，本次不重演】', text: previous ? `## ${previous.id} / ${previous.duration}s\n${body(previous)}` : '' },
    { title: '【上下文：后镜尚未发生，本次不提前演出】', text: next ? `## ${next.id} / ${next.duration}s\n${body(next)}` : '' },
    { title: '【上下文：相邻镜头每秒指令的衔接段，不重复执行】', text: [handoff(previous, 'end'), handoff(next, 'start')].filter(Boolean).join('\n\n') },
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
    : action === 'shots' ? original.shots?.items.map(item => `## ${item.id} / ${item.duration}s\n${body(item)}`).join('\n\n') : body(shot)
  if (skill === 'seconds') {
    const record = feedbackOf(original, `seconds:${options.shotId}`)
    const regenerate = ctx?.generationMode === 'regenerate'
    const human = regenerate ? '' : options.review ?? ctx?.batchReview ?? record.review.text ?? ''
    const issues = splitSecondsIssues(regenerate ? [] : record.check?.passed === false ? record.check.failures : [])
    const modify = Boolean(previous && (human || issues.programIssues.length || issues.semanticIssues.length))
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
    { title: '【核心输入：大纲】', text: project.plot.outline.content },
    { title: '【本次参数】', text: [`本集时长：${project.durationSeconds} 秒（各镜时长之和 ${min}–${max} 秒，单镜 1–15 秒）`, project.style && `项目风格：${project.style}`].filter(Boolean).join('\n') },
    ...cards,
    ...context.filter(fact => fact.title === '【实体引用清单】'),
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
    task: `只生成 ${shotId}，时长 ${shot.duration}s。直接返回修改后的完整正文，首行保留「标题：简短剧情标题」；原文缺标题时补充，核心事件未变时沿用原标题。`,
    review: `验收 ${shotId}（${shot.duration}s）的修订结果：意见落实、只改动指定镜头、首行标题与条目完整、与前后镜衔接。`,
    facts: shotContext(project, shotId),
  }, options)
}

// 每秒指令资料：镜头表为核心输入，随后是参数、相邻镜头衔接、角色/场景/道具卡、大纲参考与实体引用清单。
const secondsTitles = {
  '【上下文：前镜已发生，本次不重演】': '【衔接：前镜（已发生，不重演）】',
  '【上下文：后镜尚未发生，本次不提前演出】': '【衔接：后镜（尚未发生，不提前演出）】',
  '【上下文：相邻镜头每秒指令的衔接段，不重复执行】': '【衔接：相邻镜头每秒指令】',
  '【上游事实：大纲】': '【参考：大纲】',
  '【上游事实：本集摘要】': '【参考：本集摘要】',
}
function secondsFacts(context, core, params) {
  const pick = test => context.filter(fact => test(fact.title)).map(fact => ({ ...fact, title: secondsTitles[fact.title] || fact.title }))
  return [core, { title: '【本次参数】', text: params.filter(Boolean).join('\n') },
    ...pick(title => title.startsWith('【上下文：')),
    ...pick(title => /^【上游事实：.*(人物|场景|道具)/.test(title)),
    ...pick(title => title === '【上游事实：大纲】' || title === '【上游事实：本集摘要】'),
    ...pick(title => title === '【实体引用清单】'),
  ].filter(fact => fact.text)
}

export function buildSecondsPrompts(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  return buildShotPrompts('seconds', {
    task: '依据本镜镜头表生成本镜每秒指令，遵守基础规则和补充规则。',
    review: `验收 ${shotId}（0–${shot.duration}s）的每秒指令：与本镜镜头表的事件、切镜点和起止状态一致，与相邻镜头衔接。`,
    facts: secondsFacts(shotContext(project, shotId), { title: '【核心输入：本镜镜头表】', text: body(shot) },
      [`本镜：${shotId}，时长 ${shot.duration} 秒（0–${shot.duration * 1000}ms）`, project.style && `项目风格：${project.style}`]),
  }, options)
}

// 引用编排直接以已通过的每秒指令为唯一时间线来源（不再经过独立的文本镜头转写），
// 只提供本镜关联资料与固定素材清单，不再次审核整集剧情与前镜最终稿。
export function storyboardSource(shot) {
  return secondsText(shot?.seconds?.content)
}

export function buildAllSecondsPrompts(options, upstream) {
  const { project } = options
  const ctx = checkContext.getStore()
  const instructions = {
    task: '依据已通过镜头表生成整集每秒指令，遵守基础规则和补充规则。',
    review: `验收整集每秒指令：覆盖本次固定镜头清单的全部镜头且不增删，逐镜与已通过镜头表的事件、切镜点和起止状态一致，镜头之间交接连续。`,
    facts: secondsFacts(shotContext(upstream), { title: '【核心输入：已通过镜头表】', text: upstream.shots.items.map(shot => `## ${shot.id} / ${shot.duration}s\n${body(shot)}`).join('\n\n') },
      [`本集镜头清单：${project.shots.items.map(shot => `${shot.id}/${shot.duration}s`).join('、')}（共 ${project.shots.items.length} 镜、${project.shots.items.reduce((sum, shot) => sum + shot.duration, 0)} 秒）`, project.style && `项目风格：${project.style}`])
      .filter(fact => fact.title !== '【上游事实：已通过镜头表，同编号是本镜依据】'),
  }
  const previous = ctx?.generationMode === 'modify' ? JSON.stringify({ shots: project.shots.items.map(shot => shot.seconds.content).filter(Boolean) }) : ''
  const record = feedbackOf(ctx?.originalProject || project, 'seconds')
  return buildTextPrompts({ skill: 'seconds', project, modify: Boolean(previous),
    instructions, baseContent: previous,
    opinion: ctx?.generationMode === 'modify' ? options.review ?? ctx.batchReview ?? record.review.text ?? '' : '',
    ...splitSecondsIssues(ctx?.generationMode === 'modify' ? record.check.failures : []),
  })
}
