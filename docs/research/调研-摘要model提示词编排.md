# 摘要 model 提示词编排调研

## 结论
- AC-1 — 已确认 — episode-prompts.js 已实例化 model，但模式、基稿仍在调用方拼接，接口继续注入完整通用包装。
- AC-2 — 已确认 — interfaces/episode.js 使用 selfCheck（完整 review.md）、通用语言和优先级；角色、300 字及协议示例存在重复。
- AC-3 — 已确认 — model 已按剧情顺序选择前后集，需显式表达缺少前集或后集的分支。
- AC-4 — 已确认 — reviewParts 独立提供验收标准，preview 复用 buildEpisodePrompts，可保留审核与同步预览。

## 规格
- 目标：由 episode-summary-model.js 通过结构化属性生成清晰的 system/user 提示词。
- 非目标：修改 API 协议、图片流程、摘要校验、持久化与审核步骤。
- AC-1：实际生成与预览经 model 编排；固定规则置于 system，任务、参数、资料、意见置于 user。
- AC-2：生成不携带完整审核标准、通用镜头/素材语言说明及固定 120 秒示例；保留可编辑 common、本剧补充及修订边界。
- AC-3：首集/后续集、有后集/无后集、重新生成/人工修改/自动修订分别提供正确上下文；重新生成不携带旧摘要或意见，自动修订使用最新失败稿。
- AC-4：完整标准仍用于独立审核，时长不漂移，预览一致，原功能不新增测试失败。

## 调用链
story.js → buildEpisodePrompts → EpisodeSummaryModel → buildTextPrompts → interfaces/episode.js → gateway；preview 复用同一入口。

## 证据
| 来源 | 支持的结论 |
|---|---|
| meiji/server/prompts/models/episode-summary-model.js:contextText/toSegments | 当前数据选择与角色组织 |
| meiji/server/prompts/interfaces/episode.js:compose/review | 生成引入完整审核，独立审核可保留 |
| meiji/server/prompts/episode-prompts.js:buildEpisodePrompts | 调用方仍组装模式及基稿 |
| meiji/tests/episode-summary.test.js | 范围校验、修订时长与预览一致性 |

## 问题
| AC | 预期 | 实际 | 根因 |
|---|---|---|---|
| AC-1/2 | model 组织生成请求 | 调用方与接口重复包装 | model 仅组织部分上下文 |
| AC-3 | 显式条件与模式 | 无后集仅靠通用规则；模式和基稿在调用方 | 数据与文案编排分散 |

## 待用户决定
无。用户已要求代码实现编排。
