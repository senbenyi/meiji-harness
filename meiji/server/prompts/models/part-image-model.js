// part-image 的图片 prompt 结构；修改此文件不会改变其他图片接口。
import { imageParts, segment } from '../skill-prompts.js'
import { withReviewPrompt } from '../../data/review-checks.js'

function generate(args) {
  const p = imageParts({ ...args, stage: 'part-image', request: withReviewPrompt(args.request) })
  return [segment('context', '【角色与职责】', '你是一名道具素材设计师。'), segment('context', '【本次任务】', '根据下方素材资料生成一张独立道具图片。'),
    { ...p.request, title: '【上游资料与本次意见】' }, { ...p.requirement, title: '【基础生产规则】' }, p.addition, p.language, p.style,
    segment('protocol', '【输出要求】', '只输出一张图片，不输出解释文字。')]
}

export class PartImageModel {
  constructor(task = {}) { this.task = { ...task } }
  toGenerateSegments() { return generate(this.task) }
  toReviseSegments(request) { return generate({ ...this.task, request }) }
}
