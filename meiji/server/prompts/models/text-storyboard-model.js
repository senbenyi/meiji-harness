// storyboard 审核：文本分镜由程序编译，这里只组装人工编辑稿的审核请求。
import { currentSkillSet, reviewParts, segment } from '../skill-prompts.js'
import { baseSegments, factSegments, requirementSegment, reviewRequest, taskInput } from '../request.js'

function outputStructure(mode = 'text') {
  return `本次固定模式：${mode}。使用真实换行，按顺序输出 ${mode === 'reference' ? 'subject_definitions、summary、retention_analysis、detailed_description、overall_soundscape、non_diegetic_music' : 'integrated_multimodal_description、overall_soundscape、non_diegetic_music'}，每个英文标题后加冒号，另起行写非空正文。${mode === 'reference' ? 'subject_definitions 定义每张 Picture 与 Subject 的真实用途；summary 简述本镜；retention_analysis 说明参考特征的保留与变化；detailed_description 在原时段的动作或环境描述中使用对应 Subject。每张图片都绑定，每个已定义主体都在正文使用，图片与主体的编号体系独立。' : '没有图片，不写 Picture 或 Subject。'}不输出 JSON、代码围栏或额外说明。`
}

const conversion = '每段的动作、镜头、空间、声音全部进入对应时段的 detailed_description（或 integrated_multimodal_description），保留机位侧别、距离、高度、景别变化、画面左右与前中后景，不概括为剧情摘要。各段「交接」只用于核对承接，最后一段的交接写成本镜结尾状态，不输出“为下一镜衔接”“机位准备切换”等流程备注。用 [Shot 1] 开始，只有每秒指令已确定的实际剪辑才递增 Shot 编号并标明原切镜时点；连续运镜不另算切镜。环境底声与持续声汇总到 overall_soundscape，与动作同步的声响保留在对应时段。仅为实际发声者使用稳定的 (S1)、(S2) 编号，它们与视觉 Subject 编号独立；说话人、画内/画外、已给语气和嘴部状态写在 <d> 外，<d> 内仅写对白语言标签与原文台词，不重复完整台词到声音汇总。既定对白保持原文，不补写对白、声线、光向或动作细节。原文没有配乐时 non_diegetic_music 写 N/A。时间码与引用标签不是画面字幕。'

// 文本分镜由程序生成；模型只审核人工编辑后的最终提示词。结构与其他步骤一致（request.js）。
function review(task, content) {
  const p = reviewParts({ ...task, stage: 'storyboard' }, content)
  const input = taskInput(task.instructions)
  return reviewRequest({
    role: segment('context', '【角色与职责】', '你是一名视频提示词与引用审核员，验收最新待审内容是否忠实转换本镜每秒指令、正确绑定素材并符合格式。'),
    scope: segment('context', '【目标边界】', `只验收 ${task.shotId || '本镜'} 是否完整保留已通过每秒指令的动作、机位、景别、空间关系与声音，交接说明是否已转为承接与结尾状态而非流程备注，以及模式、素材用途、Picture/Subject 绑定和输出结构是否正确。不重新审核此前已通过的镜头规划或每秒指令，不虚构前镜，不以个人节奏、裁切比例或微动作偏好改写已通过文字。缺少 Subject 引用属于绑定错误，应在对应时段补引用，不能借此重编动作。`),
    method: segment('context', '【审核方式】', '以本镜已通过每秒指令为唯一时间线依据，关联资料只核对身份与环境，固定素材清单只核对引用。只把明确遗漏、错误引用或转写引入的改动判为问题。合理等义合并通过；不重新验收上游镜头规划、动作设计、节奏或前镜最终稿。上游自身冲突应指出具体来源，不将其判成转写新增的错误，不授权引用阶段修复上游。'),
    criteria: p.criteria, additions: p.additions, assetRules: p.assetRules, language: p.language,
    structure: [segment('protocol', '【转写与声音格式验收依据】', conversion),
      segment('protocol', '【输出结构验收依据】', `${outputStructure(task.mode)}生成稿首行标记为 [opening-reference: none]；已保存或人工编辑的正文可以省略此程序标记。`)],
    protocol: p.protocol,
    stage: p.stage, task: segment('context', '【审核目标】', input.review || input.task), requirements: requirementSegment(),
    facts: factSegments(input.facts), assets: p.assetContent,
    base: baseSegments({ kind: 'review', baseContent: task.baseContent, opinion: task.opinion }),
    content: p.content, closing: p.closing,
  })
}

export class TextStoryboardModel {
  constructor(task = {}) {
    this.task = { ...task, nodeKey: task.shotId ? `storyboard:${task.shotId}` : 'storyboard', project: structuredClone(task.project || {}), skillSet: structuredClone(currentSkillSet(task.project, task.skillSet)) }
  }
  toReviewSegments(content) { return review(this.task, content) }
}
