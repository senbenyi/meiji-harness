# 剧情 model 三类请求编排调研

## 结论
- AC-1 已确认：当前 story-prompts.js 拼接上下文，outline.js 混合生成、自检、通用审片协议；需要独立 model 三入口。
- AC-2 已确认：generate/story.js 一次生成完整剧情包、一次独立审核，失败自动修订；保持请求与保存流程。
- AC-3 已确认：outline/generate.md 已要求先大纲后建卡，应明确最终大纲是提取依据，修改同步必要连带卡片。
- AC-4 已确认：单类卡片修改解析顶层 items，但接口仍携带整包协议，需独立选择输出协议并限定审核范围。

## 规格
- 目标：用 StoryModel 组织生成、修订、审核，保证大纲与人物场景资料一致。
- 非目标：不增加拆分 API 调用，不改网关、存储、图片生成及重试策略。
- 验收：AC-1 三类方法可直接生成 messages；AC-2 首次依据摘要、重新生成隔离旧摘要及历史意见、修订对照基稿；AC-3 先完成最终大纲再提取人物与实际空间，独立审核覆盖性；AC-4 人物/场景单类修改不触碰其他资料且只返回 items。

## 调用链
操作 → generateStoryPackage/regenerateCardGroup → buildStoryPrompts → outline 接口 → buildTextPrompts → runTextSteps。预览同样使用 outline 接口。

## 证据
| 来源 | 结论 |
|---|---|
| meiji/server/prompts/story-prompts.js | 上下文及修改基稿目前以字符串拼接 |
| meiji/server/prompts/interfaces/outline.js | 三类请求共用生成材料，审核注入跨阶段通用协议 |
| meiji/server/generate/story.js | 整包与单类卡片有不同解析要求 |
| meiji/skills/stages/outline/generate.md、review.md | 身体身份、真实空间及覆盖性规则须保留 |

## 问题
生成附带完整审核正文、审核采用审片身份，任务职责重复；单类卡片协议与整包冲突。基线相关测试 41 通过，失败/取消均 0。

## 待用户决定
无。用户明确只跑相关功能测试，覆盖仓库全套测试要求。

## 补充取证与最新规格
用户明确三次独立 API 调用、三个 Model；原来一次返回协议已不适用。registry.js 原 text(story) 计划须改为三个目标，review-checks.js 原整包审核状态传播须改为阶段独立。任务快照仍以 story 聚合内容保存，避免修改持久化结构。AC-5 为顺序、门禁、分阶段保存及失败保留。
