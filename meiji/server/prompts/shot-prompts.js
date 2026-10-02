import { entityInstructions } from '../../shared/entity-references.js'
import { secondsText } from '../../shared/seconds-content.js'
import { checkReasons } from '../data/review-checks.js'
import { checkContext } from '../data/operation-context.js'
import { shotResults } from '../../shared/drama-model.js'
import { buildTextPrompts } from './text-prompts.js'

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
    { title: '【项目配置】', text: [`项目：${project.title}`, project.style && `风格：${project.style}`].filter(Boolean).join('\n') },
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
  return buildTextPrompts({ skill, project: options.project, shotId: options.shotId, opinion, mode: options.mode || '', modify: Boolean(previous && opinion),
    instructions, baseContent: previous && opinion ? previous : '',
  })
}

export function buildTablePrompts(options) {
  const { project } = options
  const min = Math.max(1, project.durationSeconds - 10), max = project.durationSeconds + 10
  return buildShotPrompts('shots', {
    task: `本集目标 ${project.durationSeconds} 秒。先统筹全集事件、场景转换、实际身体身份及片段首末状态，再决定片段数量与各自时长，每段1–15秒，不均分、不凑满15秒。总时长必须在 ${Math.max(1, project.durationSeconds - 10)}–${project.durationSeconds + 10} 秒内（含边界）。先决定满足总时长的片段数量与时长，再安排事件；相邻简单事件可连续呈现，不把每个大纲节拍机械拆成一镜。若无法容纳关键事件，明确指出具体容量冲突，不返回超时长方案。\n场景、时代、身体身份变化及完整对白和动作结果优先作为片段边界；写清边界状态供下一步骤承接。\n一次返回完整镜头表。每段标题严格为「## S01 / 12s」，编号从S01连续递增，秒数按内容分配；分段下首行必须写「标题：简短剧情标题」，标题内容跟随项目语言，概括本镜核心事件，不能只有编号；随后自由文本描述事件、起止状态、切段理由和接续要求，不输出JSON。`,
    review: `验收本集完整镜头表：覆盖大纲事件与结尾，编号连续、单镜1–15秒且总时长在 ${min}–${max} 秒内（含边界），条目格式完整，镜头之间起止状态承接。`,
    facts: shotContext({ ...project, shots: { ...project.shots, items: [] } }),
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

export function buildSecondsPrompts(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  return buildShotPrompts('seconds', {
    task: `只为 ${shotId} 生成 0–${shot.duration}s 的时间线。返回shots JSON数组且仅含本镜，按协议填写动作节拍、对白、环境声和配乐。镜头表起始状态对应0秒，结束状态只在本镜最后时点达成；每段交接只记录截至该段结束已完成的动作与持物状态。`,
    review: `验收 ${shotId}（0–${shot.duration}s）的每秒指令：与本镜镜头表的事件、切镜点和起止状态一致，与相邻镜头衔接。`,
    facts: [{ title: '【上游事实：本镜镜头表】', text: body(shot) }, ...shotContext(project, shotId)],
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
    task: `一次返回整集所有镜头的每秒指令，统筹动作进度、对白、机位及镜头交接，不重复已经完成的动作。保持已有镜头编号、顺序和时长，不新增或合并镜头。每镜从0秒开始，覆盖该镜完整时长。同编号的镜头表是本镜依据，不是上一镜；镜头表起始状态对应本镜0秒，结束状态对应本镜最后时点，不能把末态提前套到开场。每段交接只记录该时间段结束时已发生的动作与持物状态，尚未完成的动作留给下一段，不重演、不提前完成。\n【整集覆盖与篇幅安排】\n本次必须覆盖 ${project.shots.items.length} 镜、共 ${project.shots.items.reduce((sum, shot) => sum + shot.duration, 0)} 秒：${project.shots.items.map(shot => `${shot.id}/${shot.duration}s`).join('、')}。先为全部镜头安排篇幅，不把篇幅耗在前几镜。按动作节拍分段，稳定状态合并为1–5秒，一段只交代一次持续的动作、机位、空间和声音，不按秒重复相同五条描述。每镜以350–650字为篇幅参考，关键动作或完整台词需要时可扩展；不为缩短正文删剧情或对白，不为填满时间新增动作。\n一次返回shots JSON，按清单完整生成，不得遗漏、重复或新增镜头。不要输出镜头标题或完成标记，程序负责渲染。`,
    review: `验收整集每秒指令：覆盖本次固定镜头清单的全部镜头且不增删，逐镜与已通过镜头表的事件、切镜点和起止状态一致，镜头之间交接连续。`,
    facts: [...shotContext(upstream), { title: '【本次固定镜头清单】', text: `${project.shots.items.map(shot => `${shot.id}：${shot.duration * 1000}ms`).join('\n')}` }],
  }
  const previous = ctx?.generationMode === 'modify' ? JSON.stringify({ shots: project.shots.items.map(shot => shot.seconds.content).filter(Boolean) }) : ''
  return buildTextPrompts({ skill: 'seconds', project, modify: Boolean(previous),
    instructions, baseContent: previous,
    opinion: ctx?.generationMode === 'modify' ? ctx.review || '' : '',
  })
}
