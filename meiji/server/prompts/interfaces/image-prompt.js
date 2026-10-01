// 接口只给本步骤 Model 赋值；三类提示词在 Model 内独立编排。
import { ImagePromptModel } from '../models/image-prompt-model.js'
export default {
  generate: task => new ImagePromptModel(task).toGenerateSegments(),
  review: (task, content) => new ImagePromptModel(task).toReviewSegments(content),
  revise: (task, content, opinion) => new ImagePromptModel(task).toReviseSegments(content, opinion),
}
