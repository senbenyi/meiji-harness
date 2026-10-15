// 剧本审核节点模型：剧情连续性与拍摄适配结论，不适合时保存修改意见。
import { emptyNodeStateModel } from "./node_state_model.js";
export const emptyScriptReviewModel = () => ({
  node_state: emptyNodeStateModel(),
  has_result: false,
  story_continuous: false,
  continuity: "",
  filmable: false,
  filmability: "",
  suggestions: "",
});
