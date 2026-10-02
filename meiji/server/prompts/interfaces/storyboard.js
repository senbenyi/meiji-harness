// 程序负责生成，模型只审核人工编辑后的内容。
import { TextStoryboardModel } from '../models/text-storyboard-model.js'
export default { review: (task, content) => new TextStoryboardModel(task).toReviewSegments(content) }
