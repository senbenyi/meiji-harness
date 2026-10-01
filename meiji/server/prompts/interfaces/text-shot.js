import { TextShotModel } from '../models/text-shot-model.js'
export default {
  generate: task => new TextShotModel(task).toGenerateSegments(),
  review: (task, content) => new TextShotModel(task).toReviewSegments(content),
  revise: (task, content, opinion) => new TextShotModel(task).toReviseSegments(content, opinion),
}
