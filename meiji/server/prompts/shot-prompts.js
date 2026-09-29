import { checkReasons } from '../data/review-checks.js'
import { checkContext } from '../data/operation-context.js'
import { shotResults } from '../../shared/drama-model.js'
import { continuityReviewContext } from './continuity-review.js'
import { buildTextPrompts } from './text-prompts.js'

export function shotContext(project, shotId) {
  const cleanCard = card => Object.fromEntries(['id', 'name', 'type', 'look', 'space', 'description', 'identity', 'clothes', 'props', 'hairstyles'].filter(key => card[key] != null).map(key => [key, Array.isArray(card[key]) ? card[key].map(cleanCard) : card[key]]))
  const rows = project.shots?.items || []
  const index = rows.findIndex(shot => shot.id === shotId)
  const neighbors = index < 0 ? [] : [rows[index - 1], rows[index + 1]].filter(Boolean)
  return `【项目背景】\n项目：${project.title}\n风格：${project.style || ''}\n本集摘要：${project.summary?.content || ''}\n【输入内容】\n大纲：\n${project.plot.outline.content || ''}\n角色资料：\n${JSON.stringify(project.plot.characters?.items.map(cleanCard) || [])}\n场景资料：\n${JSON.stringify(project.plot.scenes?.items.map(cleanCard) || [])}\n【上下文与衔接边界】\n完整镜头表（仅作上下文，不扩大本次生成范围）：\n${rows.map(shot => `## ${shot.id} / ${shot.duration}s\n${body(shot)}`).join('\n\n')}\n相邻镜头已通过的每秒指令（用于承接，不重复执行）：\n${neighbors.filter(shot => shot.seconds?.check?.passed === true && !shot.seconds.stale).map(shot => `${shot.id}：${shot.seconds.content || ''}`).join('\n')}`
}
function body(shot) { return shot?.content || '' }

export function buildShotPrompts(skill, instructions, options) {
  const ctx = checkContext.getStore()
  const original = ctx?.originalProject || options.project
  const action = { 'skill-jingtou-jingtoubiao-table-generate': 'shots', 'skill-jingtou-jingtoubiao-shot-review': 'revise-shot', 'skill-jingtou-meimiao-seconds-generate': 'shot-seconds', 'skill-jingtou-wenben-storyboard-generate': 'shot-storyboard' }[skill]
  const opinion = ctx?.generationMode === 'regenerate' ? '' : [...new Set([options.review, ctx?.review, ...checkReasons(original, { action, track: options.shotId })].filter(Boolean))].join('\n')
  const shot = original.shots?.items?.find(item => item.id === options.shotId)
  const board = shotResults(original, 'storyboard')?.find(item => item.id === options.shotId)
  const previous = skill === 'skill-jingtou-meimiao-seconds-generate' ? shot?.seconds.content
    : skill === 'skill-jingtou-wenben-storyboard-generate' ? (board?.prompt?.text || (board?.prompt ? JSON.stringify(board.prompt) : ''))
    : action === 'shots' ? original.shots?.items.map(item => `## ${item.id} / ${item.duration}s\n${body(item)}`).join('\n\n') : body(shot)
  return buildTextPrompts({ skill, project: options.project, opinion,
    instructions: instructions + (previous && opinion ? `\n【修改基稿】\n${previous}\n只修改意见涉及内容及必要衔接，其他内容原样保留。返回完整正文。` : ''),
    reviewInstructions: instructions,
    reviewContext: action === 'shot-storyboard' ? continuityReviewContext(options.project, options.shotId, options.reviewReferences) : '',
  })
}

export function buildTablePrompts(options) {
  const { project } = options
  const instructions = `${shotContext({ ...project, shots: { ...project.shots, items: [] } })}\n【本次目标与执行要求】\n本集目标 ${project.durationSeconds} 秒。先统筹全集事件、场景转换、实际身体身份及片段首末状态，再决定片段数量与各自时长，每段1–15秒，不均分、不凑满15秒。总时长尽量等于目标，容差10秒。\n场景/时代/身体变化、完整对白和动作结果优先作为边界；比较首帧接续与多模态参考时状态衔接是否成立，不在本阶段选择最终模式或编造关键帧。\n一次返回完整镜头表。每段标题严格为「## S01 / 12s」，编号从S01连续递增，秒数按内容分配；分段下首行必须写「标题：简短剧情标题」，标题内容跟随项目语言，概括本镜核心事件，不能只有编号；随后自由文本描述事件、起止状态、切段理由和接续要求，不输出JSON。`
  return buildShotPrompts('skill-jingtou-jingtoubiao-table-generate', instructions, options)
}

export function buildSingleShotPrompts(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  return buildShotPrompts('skill-jingtou-jingtoubiao-shot-review', `${shotContext({ ...project, shots: { ...project.shots, items: project.shots.items.filter(item => item.id !== shotId) } }, shotId)}\n【本次目标与执行要求】\n只生成 ${shotId}，时长 ${shot.duration}s。直接返回修改后的完整正文，首行保留「标题：简短剧情标题」；原文缺标题时补充，核心事件未变时沿用原标题。`, options)
}

export function buildSecondsPrompts(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  return buildShotPrompts('skill-jingtou-meimiao-seconds-generate', `${shotContext(project, shotId)}\n【本次目标与执行要求】\n只为 ${shotId} 生成 0–${shot.duration}s 的时间线。\n镜头原文：${body(shot)}\n自由文本分段写时间、动作、摄影机、空间、声音及交接，不输出 JSON。`, options)
}

export function buildStoryboardPrompts(options, { shot, video, characters, scenes, refs, images }) {
  const { project, shotId } = options
  return buildShotPrompts('skill-jingtou-wenben-storyboard-generate', `${shotContext(project, shotId)}\n镜头 ${shotId}，${shot.duration}s。\n镜头原文：${body(shot)}\n每秒指令原文：\n${shot.seconds.content || ''}\n视频模式由程序确定：${video}。\n程序关联角色：${characters.join('、')}\n关联场景：${scenes.join('、') || '未关联'}\n参考图片（固定顺序，仅使用此列表，不引用其他资产）：\n${refs || '无'}\n完整保留每秒指令中的剧情。首行返回 [opening-reference: previous-tail] 或 [opening-reference: none]。尾帧若在参考图片列表中，无论转场与否均须绑定其 Picture 编号，在主体定义、保留分析和开场描述中说明用途：连续剧情从该尾帧构图与动作状态开始，立即继续运动，不停留展示图片；场景切换、时间跳跃或身份变化直接从第一帧进入本镜新剧情，尾帧仅参考相容状态，不先展示旧场景、不插入静帧或第二帧转场、不重演前镜剧情；若没有尾帧则不虚构。首行统一使用 none，图片已纳入固定列表，不在提交时追加。首行后只返回最终视频提示词原文，不返回 JSON 或说明。`, { ...options, reviewReferences: images })
}

export function buildAllSecondsPrompts(options, upstream) {
  const { project } = options
  const ctx = checkContext.getStore()
  const instructions = `${shotContext(upstream)}\n【本次目标与执行要求】\n一次返回整集所有镜头的每秒指令，统筹动作进度、对白、机位及镜头交接，不重复已经完成的动作。保持已有镜头编号、顺序和时长，不新增或合并镜头。每镜从0秒开始，覆盖该镜完整时长。\n【整集覆盖与篇幅安排】\n本次必须覆盖 ${project.shots.items.length} 镜、共 ${project.shots.items.reduce((sum, shot) => sum + shot.duration, 0)} 秒：${project.shots.items.map(shot => `${shot.id}/${shot.duration}s`).join('、')}。先为全部镜头安排篇幅，不把篇幅耗在前几镜。按动作节拍分段，稳定状态合并为1–5秒，一段只交代一次持续的动作、机位、空间和声音，不按秒重复相同五条描述。每镜以350–650字为篇幅参考，关键动作或完整台词需要时可扩展；不为缩短正文删剧情或对白，不为填满时间新增动作。\n每镜以独占一行的「## S01 / 5s」分段（使用实际编号和时长），正文为覆盖完整时间线的自由文本。最后独占一行输出 [seconds-complete]，只有全部镜头完整输出后才写此标记。`
  const previous = ctx?.generationMode === 'modify' ? project.shots.items.map(shot => `## ${shot.id}\n${shot.seconds.content || ''}`).join('\n') : ''
  return buildTextPrompts({ skill: 'skill-jingtou-meimiao-seconds-generate', project,
    instructions: instructions + (previous ? `\n【修改基稿】\n${previous}` : ''), reviewInstructions: instructions,
    opinion: ctx?.generationMode === 'modify' ? ctx.review || '' : '',
  })
}
