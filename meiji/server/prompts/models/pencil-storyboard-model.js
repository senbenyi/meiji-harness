// pencil 的图片 prompt 结构；修改此文件不会改变其他图片接口。
import { imageParts, segment } from '../skill-prompts.js'
import { withReviewPrompt } from '../../runtime/review-checks.js'

function generate(args) {
  const p = imageParts({ ...args, stage: 'pencil', request: withReviewPrompt(args.request) })
  return [segment('context', '【角色与职责】', '你是一名分镜画师。'), segment('context', '【本次任务】', '根据已确定的文本分镜绘制一张铅笔分镜图。'),
    { ...p.request, title: '【上游资料与本次意见】' }, { ...p.requirement, title: '【基础生产规则】' }, p.addition, p.language, p.style,
    segment('protocol', '【输出要求】', '只输出一张图片，不输出解释文字。')]
}

export class PencilImageModel {
  constructor(task = {}) { this.task = { ...task } }
  toGenerateSegments() { return generate(this.task) }
  toReviseSegments(request) { return generate({ ...this.task, request }) }
}
