import { checkReasons } from '../data/review-checks.js'
import { checkContext } from '../data/operation-context.js'
import { shotResults } from '../../shared/drama-model.js'
import { continuityReviewContext } from './continuity-review.js'
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
  const action = { shots: 'shots', 'shot-revise': 'revise-shot', seconds: 'shot-seconds', storyboard: 'shot-storyboard', 'text-shot': 'shot-storyboard' }[skill]
  const opinion = ctx?.generationMode === 'regenerate' ? '' : [...new Set([options.review, ctx?.review, ...checkReasons(original, { action, track: options.shotId })].filter(Boolean))].join('\n')
  const shot = original.shots?.items?.find(item => item.id === options.shotId)
  const board = shotResults(original, 'storyboard')?.find(item => item.id === options.shotId)
  const previous = skill === 'seconds' ? shot?.seconds.content
    : skill === 'text-shot' ? board?.textShot
    : skill === 'storyboard' ? (board?.prompt?.text || (board?.prompt ? JSON.stringify(board.prompt) : ''))
    : action === 'shots' ? original.shots?.items.map(item => `## ${item.id} / ${item.duration}s\n${body(item)}`).join('\n\n') : body(shot)
  return buildTextPrompts({ skill, project: options.project, shotId: options.shotId, opinion, mode: options.mode || '', modify: Boolean(previous && opinion),
    instructions, baseContent: previous && opinion ? previous : '',
    reviewInstructions: instructions,
    reviewContext: action === 'shot-storyboard' && skill !== 'storyboard' ? continuityReviewContext(options.project, options.shotId, options.reviewReferences) : '',
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

export function buildTextShotPrompts(options, shot) {
  return buildShotPrompts('text-shot', `${shotContext(options.project, options.shotId)}\n【本次任务】\n仅为 ${shot.id} 整理 ${shot.duration}s 的独立文本镜头，完整保留已通过每秒指令的时间线，不处理图片引用。\n【上游事实：本镜镜头表，起始状态对应0秒，末态对应结束】\n${body(shot)}\n【上游事实：本镜已通过每秒指令】\n${shot.seconds.content || ''}`, options)
}

// 引用编排直接以已通过的每秒指令为唯一时间线来源（不再经过独立的文本镜头转写），
// 只补充本镜实际关联的人物/场景卡和镜头表起止状态，供主体定义与空间基准使用。
export function storyboardSource(shot) {
  return String(shot?.seconds?.content || '').trim()
}

function boundCards(project, characters, scenes) {
  const pick = (cards, names) => (cards || []).filter(card => names.includes(card.name) || names.includes(card.id))
  const keys = ['id', 'name', 'description', 'identity', 'landmark', 'light', 'space', 'look']
  const clean = card => Object.fromEntries(keys.filter(key => card[key] != null && card[key] !== '').map(key => [key, card[key]]))
  return [...pick(project.plot?.characters?.items, characters), ...pick(project.plot?.scenes?.items, scenes)].map(clean)
}

export function buildStoryboardPrompts(options, { shot, video, characters, scenes, refs, images }) {
  const { project, shotId } = options
  const cards = boundCards(project, characters, scenes)
  return buildShotPrompts('storyboard', [
    '【本次任务】',
    `仅为 ${shotId} 将已通过的每秒指令直接编排为时长 ${shot.duration}s 的最终视频提示词，不输出其他镜头。`,
    '【上游事实：本镜镜头表，起始状态对应0秒，末态对应结束】',
    body(shot),
    '【上游事实：本镜已通过每秒指令（唯一时间线来源）】',
    storyboardSource(shot) || '（每秒指令通过后由程序提供）',
    '【每秒指令转写规则】',
    '每段的动作、镜头、空间、声音全部进入最终正文：动作与镜头写入对应时段的 detailed_description（或 integrated_multimodal_description），机位侧别、距离、高度、景别及其变化、画面左右与前中后景按原文保留，不改写为其他机位，不补每秒指令与场景资料都没有的光向，不在背面或远景机位补写看不到的面部细节。各段「交接」是写给下一段的衔接备注，不作为独立内容输出；中间段的交接只用于核对承接，最后一段的交接写成本镜结尾状态。删除“为下一镜做衔接”“机位准备切换”等流程说明。环境底声与持续声汇总到 overall_soundscape，与动作同步的声响留在对应时段；原文没有配乐时 non_diegetic_music 写 N/A。',
    cards.length ? `【上游事实：本镜关联的人物与场景资料】\n${JSON.stringify(cards)}` : '',
    '【程序确定的素材与模式】',
    `视频模式由程序确定：${video}。`,
    `程序关联角色：${characters.join('、') || '未关联'}`,
    `关联场景：${scenes.join('、') || '未关联'}`,
    '参考图片（固定顺序，仅使用此列表，不引用其他资产）：',
    refs || '无',
    '参考人像只锁定身份和外形，不能作为首帧或改变已通过的动作、景别与姿态。尾帧在清单中时只引用相容的衔接状态，不重演前镜。首行统一写 [opening-reference: none]；图片已纳入固定列表，提交时不追加。只转换表达结构与引用，禁止改变时间线或新增剧情。',
  ].filter(Boolean).join('\n'), { ...options, mode: video, reviewReferences: images })
}

export function buildAllSecondsPrompts(options, upstream) {
  const { project } = options
  const ctx = checkContext.getStore()
  const instructions = `${shotContext(upstream)}\n【本次任务】\n一次返回整集所有镜头的每秒指令，统筹动作进度、对白、机位及镜头交接，不重复已经完成的动作。保持已有镜头编号、顺序和时长，不新增或合并镜头。每镜从0秒开始，覆盖该镜完整时长。同编号的镜头表是本镜依据，不是上一镜；镜头表起始状态对应本镜0秒，结束状态对应本镜最后时点，不能把末态提前套到开场。每段交接只记录该时间段结束时已发生的动作与持物状态，尚未完成的动作留给下一段，不重演、不提前完成。\n【整集覆盖与篇幅安排】\n本次必须覆盖 ${project.shots.items.length} 镜、共 ${project.shots.items.reduce((sum, shot) => sum + shot.duration, 0)} 秒：${project.shots.items.map(shot => `${shot.id}/${shot.duration}s`).join('、')}。先为全部镜头安排篇幅，不把篇幅耗在前几镜。按动作节拍分段，稳定状态合并为1–5秒，一段只交代一次持续的动作、机位、空间和声音，不按秒重复相同五条描述。每镜以350–650字为篇幅参考，关键动作或完整台词需要时可扩展；不为缩短正文删剧情或对白，不为填满时间新增动作。\n每镜以独占一行的「## S01 / 5s」分段（使用实际编号和时长），正文为覆盖完整时间线的自由文本。最后独占一行输出 [seconds-complete]，只有全部镜头完整输出后才写此标记。`
  const previous = ctx?.generationMode === 'modify' ? project.shots.items.map(shot => `## ${shot.id} / ${shot.duration}s\n${shot.seconds.content || ''}`).join('\n') : ''
  return buildTextPrompts({ skill: 'seconds', project, modify: Boolean(previous),
    instructions, baseContent: previous, reviewInstructions: instructions,
    opinion: ctx?.generationMode === 'modify' ? ctx.review || '' : '',
  })
}
