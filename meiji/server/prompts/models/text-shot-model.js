import { currentSkillSet, generationParts, reviewParts, segment } from '../skill-prompts.js'
import { withRequirements, revisionTask } from '../interfaces/text-context.js'

export class TextShotModel {
  constructor(task = {}) {
    this.task = { ...task, project: structuredClone(task.project || {}), skillSet: structuredClone(currentSkillSet(task.project, task.skillSet)) }
  }
  compose(task, kind) {
    const p = generationParts({ ...task, stage: 'text-shot', nodeKey: task.shotId ? `text-shot:${task.shotId}` : 'text-shot', kind })
    return { json: false,
      system: [segment('context', '【角色与职责】', '你是一名文本镜头编剧，忠实整理本镜已通过的每秒指令，形成独立可读的文本镜头。本步骤不处理图片、素材编号或视频接口格式。'),
        p.generate, ...p.additions, ...(kind !== 'generate' ? p.revisionBoundary : []), p.language, p.priority, p.protocol],
      user: [p.context, segment('context', '【修改基稿】', kind !== 'generate' ? task.baseContent : ''), p.opinion] }
  }
  toGenerateSegments() { const task = withRequirements(this.task); return this.compose(task, task.modify ? 'modify' : 'generate') }
  toReviewSegments(content) {
    const p = reviewParts({ ...withRequirements(this.task), stage: 'text-shot', nodeKey: this.task.shotId ? `text-shot:${this.task.shotId}` : 'text-shot' }, content)
    return { json: false, system: [p.commonProtocol, p.language, p.protocol],
      user: [p.stage, p.context, segment('context', '【修订基稿】', this.task.baseContent), p.opinion, p.criteria, ...p.additions, p.content, p.scope] }
  }
  toReviseSegments(content, opinion) { return this.compose(revisionTask(withRequirements(this.task), content, opinion), 'revise') }
}
