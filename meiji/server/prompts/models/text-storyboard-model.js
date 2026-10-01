// storyboard 接口：在此独立定义生成、审核、修订的角色、顺序与输出格式。
// 下列片段均为显式选择；可删减、移动到另一角色，或替换为本接口自己的 segment。
import { currentSkillSet, generationParts, reviewParts, segment } from '../skill-prompts.js'
import { withRequirements, revisionTask } from '../interfaces/text-context.js'

function compose(task, kind) {
  const p = generationParts({ ...task, stage: 'storyboard', kind, outputProtocol: '只返回目标镜头的最终视频提示词正文及要求的首行标记，禁止 JSON 包装。' })
  return {
    json: false,
    system: [
      segment('context', '【角色与职责】', '你是一名视频多模态引用编排师，将已通过的文本镜头转换为程序指定模式的最终视频提示词。只组织输出结构与素材绑定，不重新创作剧情；时间线、动作、机位、起止状态和声音以已通过文本镜头为准。程序提供有序素材清单，不能增删或重排。'), p.common, ...p.commonShared, p.generate,
      ...p.guidance, ...p.additions, ...p.assetRules,
      ...(kind === 'revise' ? p.revisionBoundary : p.selfCheck),
      ...(kind === 'modify' ? p.revisionBoundary : []),
      p.language, p.priority,
      segment('protocol', '【引用标签与用途】', '编号写成 <Picture 1>、<Subject 1>（空格后直接是整数），不能写 <Subject N1>、<Picture N1> 或占位符。人物图只提供人物身份与外形，不能用其背景替代本镜场景；没有场景图的环境按已通过文字描述，不给它虚构图片来源。subject_definitions 定义的每个 <Subject 1> 等标签必须在 detailed_description 对应动作或环境描述中原样使用。'),
      segment('protocol', '【本次输出协议】', `本次固定模式：${task.mode || 'text'}。首行仅写 [opening-reference: none]，随后使用真实换行输出 ${task.mode === 'reference' ? 'subject_definitions、summary、retention_analysis、detailed_description、overall_soundscape、non_diegetic_music' : 'integrated_multimodal_description、overall_soundscape、non_diegetic_music'}，每个英文标题后加冒号，按此顺序写非空正文。${task.mode === 'reference' ? 'subject_definitions 定义 Picture 与 Subject 的用途；detailed_description 引用已定义 Subject 执行原文本镜头动作，每张图片都绑定，每个主体都在正文使用。' : '没有图片，不写 Picture 或 Subject。'}只输出本镜最终正文，不输出 JSON、代码围栏、解释或检查过程。`),
    ],
    user: [p.context, ...p.assetContent,
      segment('context', task.automatic ? '【最新失败稿（唯一修改基准）】' : '【修改基稿】', kind !== 'generate' ? task.baseContent : ''),
      p.opinion, ...(task.automatic ? [segment('context', '【原人工意见】', task.humanOpinion)] : [])],
  }
}

function generate(task) {
  return compose(withRequirements(task), task.modify ? 'modify' : 'generate')
}

function review(task, content) {
  const p = reviewParts({ ...withRequirements(task), stage: 'storyboard' }, content)
  return {
    json: false,
    system: [segment('context', '【角色与职责】', '你是一名独立视频文本分镜编剧审核员，只验收最新待审内容，不生成或修改原文。'), p.commonProtocol, ...p.shared, ...p.assetRules, p.language, p.protocol],
    user: [p.stage, p.context,
      segment('context', '【修订基稿（用于对照范围）】', task.baseContent),
      p.opinion, p.criteria, ...p.guidance, ...p.additions,
      ...p.assetContent, p.continuity, p.content, p.scope,
      segment('context', '【目标边界】', `只验收 ${task.shotId || '本镜'} 是否完整保留已通过文本镜头，以及模式、素材用途、Picture/Subject 绑定和输出结构是否正确。不重新审核此前已通过的镜头规划或每秒指令，不虚构前镜，不以个人节奏、裁切比例或微动作偏好改写已通过文字。缺少 Subject 引用属于绑定错误，应在对应时段补引用，不能借此重编动作。`)],
  }
}

function revise(task, content, review) {
  return compose(revisionTask(withRequirements(task), content, review), 'revise')
}

export class TextStoryboardModel {
  constructor(task = {}) {
    this.task = { ...task, nodeKey: task.shotId ? `storyboard:${task.shotId}` : 'storyboard', project: structuredClone(task.project || {}), skillSet: structuredClone(currentSkillSet(task.project, task.skillSet)) }
    this.generationRules = task.generationRules ?? this.task.skillSet.skills['storyboard'].constraints
  }
  requestTask() { this.task.skillSet.skills['storyboard'].constraints = this.generationRules; return this.task }
  toGenerateSegments() { return generate(this.requestTask()) }
  toReviewSegments(content) { return review(this.requestTask(), content) }
  toReviseSegments(content, opinion) { return revise(this.requestTask(), content, opinion) }
}
