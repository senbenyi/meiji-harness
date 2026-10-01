# 统一审核 JSON 协议
- 类型：重构
- 调研：docs/research/调研-统一审核JSON协议.md
## 改动
1. shared/review-result.js：统一协议、严格解析、问题格式化 → AC-1/2/3。
2. prompts/skill-prompts、各审核 Model、interfaces/outline、preview：共用协议，开启审核 JSON 模式，删除 PASS/FAIL 指令 → AC-1。
3. generate/text-steps：结构化结论驱动修订，程序问题合并为 issues，输出已有 check 与可读意见 → AC-2/3。
4. tests：审核响应夹具切换新协议；增加所有审核入口、严格解析、修订/复审、保存和界面结果测试 → AC-1/2/3。
5. architecture.md：记录协议与错误边界；不变更用户数据结构。
## 待用户决定
无。
## 验证结果
定向 94/94 通过；全量 491 通过、14 既有失败、0 取消，无新增失败（基线失败 15）。真实网关通过与未通过两类 JSON 结果均验证成功。diff 检查通过；索引和运行状态详见实施记录。

追加已确认的相关修复：gateway.writeApiLog 原以任意出现的“返回：”区分响应；统一协议含返回样本使请求误分类。改为匹配日志行首返回标记，由既有 session-log 集成测试验证。
问题展示去重同步调整：shared/feedback.js 按 issues 映射后的一条完整意见去重，不再按空行拆分，避免多段证据失去镜头归属；all-seconds 回归测试覆盖多段问题。
