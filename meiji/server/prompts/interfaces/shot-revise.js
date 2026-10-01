// 接口只给本步骤 Model 赋值；三类提示词在 Model 内独立编排。
import { ShotRevisionModel } from '../models/shot-revision-model.js'
export default {
  generate: task => new ShotRevisionModel(task).toGenerateSegments(),
  review: (task, content) => new ShotRevisionModel(task).toReviewSegments(content),
  revise: (task, content, opinion) => new ShotRevisionModel(task).toReviseSegments(content, opinion),
}
