// 本地拼接业务上下文，不发起模型请求。
export function buildGenerationPrompt({ instructions, correction }) {
  return `【任务与上下文】\n${instructions}` + (correction ? `\n【本轮定向修订】\n最新失败稿（以此为基准）：\n${correction.text}\n自审不通过原因：\n${correction.reviewText}\n保留原人工意见，只修改受影响内容及必要衔接。返回完整修订结果，不返回修改说明。旧基稿仅作背景，以最新失败稿为准。` : '')
}
export function buildSelfReviewPrompt({ skill, instructions, content, extraContext = '' }) {
  return `阶段：${skill}\n【任务与上下文】\n${instructions}\n${extraContext}\n【本次待审内容】\n${content}\n只审核最新待审内容；核实意见是否解决，不把历史失败直接当作新失败。输出 PASS 或 FAIL，FAIL 后说明具体原因，采用项目配置语言。`
}
