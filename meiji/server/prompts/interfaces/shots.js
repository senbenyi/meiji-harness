// 接口只给本步骤 Model 赋值；三类提示词在 Model 内独立编排。
import { ShotTableModel } from '../models/shot-table-model.js'
export default {
  generate: task => new ShotTableModel(task).toGenerateSegments(),
  review: (task, content) => new ShotTableModel(task).toReviewSegments(content),
  revise: (task, content, opinion) => new ShotTableModel(task).toReviseSegments(content, opinion),
}
