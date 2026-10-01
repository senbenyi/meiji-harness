# 统一审核 JSON 协议实施记录
## 已修改文件
- shared/review-result.js：统一协议、严格 JSON 契约验证及问题格式化。
- server/prompts/skill-prompts.js、各审核 Model、interfaces/outline.js、preview.js：审核与复审共用协议，启用 JSON 模式；预览修订意见使用同结构。
- server/generate/text-steps.js：删除 PASS/FAIL 解析及建议尾部截断，结构化结论驱动最多一次修订；格式错误停止，草稿保留；程序校验问题合并为 issues。
- shared/feedback.js：完整问题去重，不按空行拆散多段证据；页面及历史复用已有失败意见展示，无存储结构迁移。
- server/generate/gateway.js：按行首日志标记区分响应，防止协议样本中的“返回：”误分类请求。
- tests/review-result.test.js、fixtures/review-result.js 及相关流程/UI 测试：统一网络夹具，覆盖所有审核入口、真实请求 JSON 模式、格式与一致性错误、自动修订、复审、草稿保留、日志及展示。
- .agents/architecture.md：说明统一契约、修订及错误边界。
## 验收标准
- AC-1 通过：摘要、大纲、人物、场景、镜头、镜头修订、整集/单镜逐秒、视频提示词、图片提示词及人工编辑审核入口测试共用协议，实际请求 response_format 为 json_object。
- AC-2 通过：拒绝旧纯文本、围栏、额外字段、空问题字段、非布尔结论及矛盾状态；格式错不修订、不放行。
- AC-3 通过：有效问题和程序规则问题共同驱动一次修订；UI 显示位置/原因/修正要求；多段证据不拆散，任务状态和用户历史数据结构保持不变。
## 验证
- 定向 94/94 通过，0 取消。
- 全量基线 501 项：486 通过、15 失败、0 取消。修改后 505 项：491 通过、14 失败、0 取消，无新增失败。原任务记录测试的旧模拟协议同步后恢复通过；其他既有失败未扩大修复。
- 真实网关：大纲审核合法 passed:true / issues:[]；无效摘要合法 passed:false / issues 两项，均由严格解析器接受。验证未写入用户项目。
- git diff --check 通过；已执行 GitNexus 影响分析与差异检查。
## 人工待办
刷新页面后重试；历史失败任务不改写，不自动覆盖用户当前草稿。

## 运行与索引
GitNexus 更新成功：6,457 节点、20,943 关系、544 流程。确认无运行任务后重启 Harness；3080 首页（认证访问）及 meiji 客户端资源均 HTTP 200。
