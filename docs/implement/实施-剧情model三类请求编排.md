# 剧情 model 三类请求编排实施记录

## 已修改文件
- prompts/models/story-outline-model.js、story-character-model.js、story-scene-model.js：三个业务模型，各自明确职责、资料字段和输出目标。
- prompts/models/story-model.js：共享上下文、基稿与意见隔离、生成/修订/审核函数。
- prompts/story-prompts.js、interfaces/outline.js：给对应模型赋值、选择对应技能小节；生成不附完整审核正文，审核不附通用审片协议。
- generate/story.js、flow/operations/registry.js：大纲、人物、场景各自独立生成/审核，前项通过后继续。
- flow/operations/story.js、finish.js、data/story-package.js、review-checks.js：分阶段保存与状态，后项失败保留前项通过状态；允许尚无卡片时修订已有大纲。
- data/task-store.js：剧情快照验收结果按三项聚合，不以大纲通过代替整包通过。
- skills/stages/outline 五份正文：分步骤技能小节和独立输出协议；保留独立身体与场景空间约束。
- prompts/preview.js、client/skill-detail.js：三模型请求预览及中文标题。
- tests/story-model.test.js 和相关测试、fixtures/prompt-scenarios.js：覆盖独立步骤与边界，更新旧整包断言。
- meiji/docs/story-model.md、.agents/architecture.md：模型及流程说明。

## 验收标准核对
| AC | 状态 | 证据 |
|---|---|---|
| AC-1 三个业务模型与三类组装函数 | 通过 | story-model.test.js 各模型 segments/messages，实际预览一致 |
| AC-2 任务模式、基稿及意见隔离 | 通过 | prompt-nodes、generation-mode、story-model |
| AC-3 最终大纲提取人物与场景 | 通过 | story-package、project-generation-review；自动修订后提取只收到最终大纲 |
| AC-4 单类输出与修订边界 | 通过 | 各小节选择、独立协议；人物/场景只返回 items |
| AC-5 独立步骤、保存与门禁 | 通过 | 正常 6 次请求、计划三目标；失败停止、错误/取消保留草稿与通过状态 |

## 测试
基线相关 41 项通过，0 失败/取消；最终只执行相关 15 个测试文件，共 108 项通过，0 失败/取消。未跑全套测试，未请求真实付费模型 API。

提示词快照 28 → 30 个场景，37 条删除/改写在 docs/research/提示词差集-剧情model三类请求编排.md 逐项核对。git diff --check 通过。

## 人工待办
无。真实模型输出质量未做线上验证；本次完成提示词组装及模拟接口流程验证。

## GitNexus
已执行规定的 gitnexus analyze --index-only 并成功更新（432 文件，5,669 节点）；读取仓库 context 核实加载成功。
