# 摘要 model 提示词编排实施记录

## 已修改文件
- meiji/server/prompts/models/episode-summary-model.js — 分段组织任务、参数、故事资料与前后集条件；生成/修订编排及最终消息函数；支持赋值输出协议。
- meiji/server/prompts/episode-prompts.js、interfaces/episode.js — 实际调用共用 model；生成移除完整审核包装，审核保持原标准与协议。
- meiji/skills/stages/episode/common.md、protocol.md、revise.md — 简短创作自检与语言原则；输出字段无固定时长示例；保留修改时语言一致性原则。
- meiji/tests/episode-summary-model.test.js — 新增 6 项编排、模式、衔接、覆盖及预览测试。
- meiji/tests/episode.test.js、skill.test.js、language.test.js — 更新摘要专属包装及语言参数位置断言，保留其他阶段断言。
- .agents/architecture.md、meiji/docs/episode-summary-model.md — 编排职责与赋值/函数用法。

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|---|---|---|
| AC-1 | 通过 | model 最终消息测试；中间集预览与实际 system/user 一致 |
| AC-2 | 通过 | 职责、语言、范围、300 字去重；完整审核仅独立请求；技能覆盖及补充测试 |
| AC-3 | 通过 | 首集/追加新集、中间集重做、人工修改、自动修订分支测试 |
| AC-4 | 通过 | 原生成、审核、修订、保存与时长校验测试；全套 411 项通过 |

## 测试
- 基线 npm test：405 通过，0 失败，0 取消。
- 编排接入阶段相关测试：33 通过。
- 最终 npm test：411 通过，0 失败，0 取消。
- git diff --check：通过。
- 提示词快照：28 场景；差集的 11 项全局删除及生成请求移出项均已记录去向，其他阶段字数未变。
- GitNexus：analyze --index-only 成功，5,453 节点、17,700 关系。工具报告部分调用图受候选/深度上限限制，索引已更新但不表示调用图完整。

## 人工待办
无。测试使用模拟模型响应，未发起付费模型请求；实际创作质量需观察后续生成效果。
