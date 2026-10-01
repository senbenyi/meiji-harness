import { checkReasons } from '../data/review-checks.js'
import { checkContext } from '../data/operation-context.js'
import { shotResults } from '../../shared/drama-model.js'
import { storyboardContext } from './storyboard-context.js'
import { buildTextPrompts } from './text-prompts.js'

export function shotContext(project, shotId) {
  const cleanCard = card => Object.fromEntries(['id', 'name', 'type', 'look', 'space', 'landmark', 'light', 'description', 'identity', 'clothes', 'props', 'hairstyles'].filter(key => card[key] != null).map(key => [key, Array.isArray(card[key]) ? card[key].map(cleanCard) : card[key]]))
  const rows = project.shots?.items || []
  const index = rows.findIndex(shot => shot.id === shotId)
  const neighbors = index < 0 ? [] : [rows[index - 1], rows[index + 1]].filter(Boolean)
  const section = (title, value) => value ? `${title}\n${value}` : ''
  return [
    section('【项目配置】', [`项目：${project.title}`, project.style && `风格：${project.style}`].filter(Boolean).join('\n')),
    section('【上游事实：本集摘要】', project.summary?.content),
    section('【上游事实：大纲】', project.plot.outline.content),
    section('【上游事实：人物资料】', project.plot.characters?.items?.length ? JSON.stringify(project.plot.characters.items.map(cleanCard)) : ''),
    section('【上游事实：场景资料】', project.plot.scenes?.items?.length ? JSON.stringify(project.plot.scenes.items.map(cleanCard)) : ''),
    section('【上游事实：已通过镜头表，同编号是本镜依据】', !shotId ? rows.map(shot => `## ${shot.id} / ${shot.duration}s\n${body(shot)}`).join('\n\n') : ''),
    section('【上下文：前镜已发生，本次不重演】', shotId && rows[index - 1] ? `## ${rows[index - 1].id} / ${rows[index - 1].duration}s\n${body(rows[index - 1])}` : ''),
    section('【上下文：后镜尚未发生，本次不提前演出】', shotId && rows[index + 1] ? `## ${rows[index + 1].id} / ${rows[index + 1].duration}s\n${body(rows[index + 1])}` : ''),
    section('【上下文：相邻镜头已通过的每秒指令，不重复执行】', neighbors.filter(shot => shot.seconds?.check?.passed === true && !shot.seconds.stale).map(shot => `${shot.id}：${shot.seconds.content || ''}`).join('\n')),
  ].filter(Boolean).join('\n\n')
}
function body(shot) { return shot?.content || '' }

export function buildShotPrompts(skill, instructions, options) {
  const ctx = checkContext.getStore()
  const original = ctx?.originalProject || options.project
  const action = { shots: 'shots', 'shot-revise': 'revise-shot', seconds: 'shot-seconds', storyboard: 'shot-storyboard' }[skill]
  const opinion = ctx?.generationMode === 'regenerate' ? '' : [...new Set([options.review, ctx?.review, ...checkReasons(original, { action, track: options.shotId })].filter(Boolean))].join('\n')
  const shot = original.shots?.items?.find(item => item.id === options.shotId)
  const board = shotResults(original, 'storyboard')?.find(item => item.id === options.shotId)
  const previous = skill === 'seconds' ? shot?.seconds.content
    : skill === 'storyboard' ? (board?.prompt?.text || (board?.prompt ? JSON.stringify(board.prompt) : ''))
    : action === 'shots' ? original.shots?.items.map(item => `## ${item.id} / ${item.duration}s\n${body(item)}`).join('\n\n') : body(shot)
  return buildTextPrompts({ skill, project: options.project, shotId: options.shotId, opinion, mode: options.mode || '', modify: Boolean(previous && opinion),
    instructions, baseContent: previous && opinion ? previous : '',
    reviewInstructions: instructions,
  })
}

export function buildTablePrompts(options) {
  const { project } = options
  const instructions = `${shotContext({ ...project, shots: { ...project.shots, items: [] } })}\n【本次任务】\n本集目标 ${project.durationSeconds} 秒。先统筹全集事件、场景转换、实际身体身份及片段首末状态，再决定片段数量与各自时长，每段1–15秒，不均分、不凑满15秒。总时长必须在 ${Math.max(1, project.durationSeconds - 10)}–${project.durationSeconds + 10} 秒内（含边界）。先决定满足总时长的片段数量与时长，再安排事件；相邻简单事件可连续呈现，不把每个大纲节拍机械拆成一镜。若无法容纳关键事件，明确指出具体容量冲突，不返回超时长方案。\n场景、时代、身体身份变化及完整对白和动作结果优先作为片段边界；写清边界状态供下一步骤承接。\n一次返回完整镜头表。每段标题严格为「## S01 / 12s」，编号从S01连续递增，秒数按内容分配；分段下首行必须写「标题：简短剧情标题」，标题内容跟随项目语言，概括本镜核心事件，不能只有编号；随后自由文本描述事件、起止状态、切段理由和接续要求，不输出JSON。`
  return buildShotPrompts('shots', instructions, options)
}

export function buildSingleShotPrompts(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  return buildShotPrompts('shot-revise', `${shotContext(project, shotId)}\n【本次任务】\n只生成 ${shotId}，时长 ${shot.duration}s。直接返回修改后的完整正文，首行保留「标题：简短剧情标题」；原文缺标题时补充，核心事件未变时沿用原标题。`, options)
}

export function buildSecondsPrompts(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  return buildShotPrompts('seconds', `${shotContext(project, shotId)}\n【本次任务】\n只为 ${shotId} 生成 0–${shot.duration}s 的时间线。\n镜头原文：${body(shot)}\n自由文本分段写时间、动作、摄影机、空间、声音及交接，不输出 JSON。镜头表起始状态对应0秒，结束状态只在本镜最后时点达成；每段交接只记录截至该段结束已完成的动作与持物状态。`, options)
}

// 引用编排直接以已通过的每秒指令为唯一时间线来源（不再经过独立的文本镜头转写），
// 只提供本镜关联资料与固定素材清单，不再次审核整集剧情与前镜最终稿。
export function storyboardSource(shot) {
  return String(shot?.seconds?.content || '').trim()
}

export function buildStoryboardPrompts(options, { shot, video, characters, scenes, refs }) {
  return buildShotPrompts('storyboard', storyboardContext({ project: options.project, shot, video, characters, scenes, refs }), { ...options, mode: video })
}

export function buildAllSecondsPrompts(options, upstream) {
  const { project } = options
  const ctx = checkContext.getStore()
  const instructions = `${shotContext(upstream)}\n【本次任务】\n一次返回整集所有镜头的每秒指令，统筹动作进度、对白、机位及镜头交接，不重复已经完成的动作。保持已有镜头编号、顺序和时长，不新增或合并镜头。每镜从0秒开始，覆盖该镜完整时长。同编号的镜头表是本镜依据，不是上一镜；镜头表起始状态对应本镜0秒，结束状态对应本镜最后时点，不能把末态提前套到开场。每段交接只记录该时间段结束时已发生的动作与持物状态，尚未完成的动作留给下一段，不重演、不提前完成。\n【整集覆盖与篇幅安排】\n本次必须覆盖 ${project.shots.items.length} 镜、共 ${project.shots.items.reduce((sum, shot) => sum + shot.duration, 0)} 秒：${project.shots.items.map(shot => `${shot.id}/${shot.duration}s`).join('、')}。先为全部镜头安排篇幅，不把篇幅耗在前几镜。按动作节拍分段，稳定状态合并为1–5秒，一段只交代一次持续的动作、机位、空间和声音，不按秒重复相同五条描述。每镜以350–650字为篇幅参考，关键动作或完整台词需要时可扩展；不为缩短正文删剧情或对白，不为填满时间新增动作。\n【本次必须逐项输出的镜头标题清单】\n${project.shots.items.map(shot => `## ${shot.id} / ${shot.duration}s`).join('\n')}\n按此清单逐镜展开，每个标题独占一行且仅出现一次；先完成本镜0至规定时长的时间线，再写下一镜标题并从0重新计时。禁止缺标题、合并镜头或在同一镜下重复从0开始。不得照搬协议示例的镜头数量和时长。清单全部完成后，最后独占一行输出 [seconds-complete]。`
  const previous = ctx?.generationMode === 'modify' ? project.shots.items.map(shot => `## ${shot.id} / ${shot.duration}s\n${shot.seconds.content || ''}`).join('\n') : ''
  return buildTextPrompts({ skill: 'seconds', project, modify: Boolean(previous),
    instructions, baseContent: previous, reviewInstructions: instructions,
    opinion: ctx?.generationMode === 'modify' ? ctx.review || '' : '',
  })
}
