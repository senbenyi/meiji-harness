// 接口只给本步骤 Model 赋值；三类提示词在 Model 内独立编排。
import { EpisodeSecondsModel } from '../models/episode-seconds-model.js'
import { ShotSecondsModel } from '../models/shot-seconds-model.js'
const modelOf = task => new (task.shotId ? ShotSecondsModel : EpisodeSecondsModel)(task)
export default {
  generate: task => modelOf(task).toGenerateSegments(),
  review: (task, content) => modelOf(task).toReviewSegments(content),
  revise: (task, content, opinion) => modelOf(task).toReviseSegments(content, opinion),
}
