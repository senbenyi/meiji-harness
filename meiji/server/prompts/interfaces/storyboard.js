// 接口只给本步骤 Model 赋值；三类提示词在 Model 内独立编排。
import { TextStoryboardModel } from '../models/text-storyboard-model.js'
export default {
  generate: task => new TextStoryboardModel(task).toGenerateSegments(),
  review: (task, content) => new TextStoryboardModel(task).toReviewSegments(content),
  revise: (task, content, opinion) => new TextStoryboardModel(task).toReviseSegments(content, opinion),
}
