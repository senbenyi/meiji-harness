// 剧本节点上的审核结论：剧情连续性与拍摄适配，不适合时保存修改意见。审核状态使用剧本的 node_state。
export const emptyScriptReviewModel = () => ({
  has_result: false,
  story_continuous: false,
  continuity: "",
  filmable: false,
  filmability: "",
  suggestions: "",
});
