// character-image 的图片 prompt 结构；修改此文件不会改变其他图片接口。
import { imageParts } from '../skill-prompts.js'
import { withReviewPrompt } from '../../data/review-checks.js'

function generate(args) {
  const p = imageParts({ ...args, stage: 'character-image', request: withReviewPrompt(args.request) })
  return [p.requirement, p.addition, p.language, p.style, p.request]
}

export default { generate }
