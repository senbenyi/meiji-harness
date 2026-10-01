# 摘要 model 提示词编排

- 类型：重构
- 目标：让摘要 model 负责结构化输入和最终生成提示词编排。
- 调研：docs/research/调研-摘要model提示词编排.md

## 待用户决定
无。

## 改动
### 阶段 1：编排与接入
1. meiji/server/prompts/models/episode-summary-model.js — contextText/toSegments → 分段任务、参数、资料、衔接、基稿和意见；新增生成编排函数与默认 toMessages，去画幅，自动修订以失败稿为基准 → AC-1/3。
2. meiji/server/prompts/episode-prompts.js — 调用方拼接模式/基稿 → 全部交由 model；审核复用 model 上下文 → AC-1/4。
3. meiji/server/prompts/interfaces/episode.js — compose → 选择 common、补充、修订边界与协议，移除完整审核及通用语言/优先级；审核保持完整标准 → AC-2/4。
4. meiji/skills/stages/episode/common.md、protocol.md、revise.md — 重复角色及固定时长示例 → 简短创作自检与语言原则、无数值锚定的 JSON 字段要求；修订边界补入简短语言一致性原则；保持用户已修改的 constraints/episode.md 原文 → AC-2。

验证：相关测试及提示词前后快照差集，核对审核标准无丢失。

### 阶段 2：验证与说明
1. meiji/tests/episode-summary-model.test.js — 新增分支、去重、修改/修订、技能覆盖和 model 消息测试 → AC-1/2/3/4。
2. meiji/tests/skill.test.js、episode.test.js、language.test.js — 更新摘要专属编排断言，其他阶段保持原断言 → AC-2/4。
3. .agents/architecture.md、meiji/docs/episode-summary-model.md — 记录 model 编排职责与代码用法 → AC-1。

验证：cd meiji && npm test；git diff --check；更新 GitNexus 索引。

## 验收标准
- AC-1：生成与预览共用 model，规则在 system，参数/资料/意见在 user。
- AC-2：精简生成包装，审核标准留在独立审核，可编辑技能和补充继续生效。
- AC-3：全部衔接与模式分支正确，不携带重新生成旧稿，修订使用最新失败稿。
- AC-4：独立审核及预览、时长校验正常；全套测试无新增失败或取消。

## 验证结果
基线 npm test：405 通过，0 失败，0 取消。最终：411 通过，0 失败，0 取消。28 个提示词场景差集已核对，新增编排测试通过；git diff --check 通过。GitNexus analyze --index-only 成功，索引已更新。
