# skill 清理与请求编排验收

## 结论
- AC-1 已确认：基础文档含重复任务、模式说明及大纲阶段不适用的表演细则。
- AC-2 已确认：场景图 Model 已定义三种任务，但输出要求仍放在 skill。
- AC-3 未验收：需加载修改后的服务，创建新项目检查真实步骤提示词。

## 规格
- 目标：清理冗余 skill，再从新项目检查实际请求并提出编排建议。
- 非目标：本轮不全面重构所有 Model，不删生产约束，不绕过审核门禁。
- AC-1：基础 skill 保留生产约束，重复任务说明有明确删除依据。
- AC-2：场景图生成、参考和修改由 Model 明确任务与图片输出要求。
- AC-3：创建项目和剧集，从摘要逐步生成，记录实际请求、结果与阻塞；建议区分实际验证和未执行分支。

## 调用链
面板操作 → 任务执行器 → 生成入口 → 接口赋值 → Model → 网关；步骤提示词快照用于核对实际请求。

## 证据
| 来源 | 结论 |
|---|---|
| meiji/skills/task/*.md | 场景首句混合任务与无人约束；摘要重复模式；大纲混入逐招与机位要求 |
| meiji/server/prompts/models/scene-image-model.js | 三模式已有任务分支，缺显式图片输出片段 |
| meiji/server/prompts/models/episode-summary-model.js | 本次任务与重新生成边界已由代码管理 |
| meiji/server/prompts/models/part-image-model.js、pencil-image-model.js、film-model.js | 当前仍使用请求资料与规则组合，后续需建议明确任务分区 |

## 问题
任务描述和规则混在基础 skill，跨阶段细则增加输入噪声；实际是否出现审核误判需新项目取证。

## 待用户决定
无。
