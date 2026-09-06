---
name: elysium-oneline
description: >-
  一句话成片：用户给一句话就提交生产，其余参数由 Producer Agent 推断。当用户用一句话
  描述想要的短剧并要求"直接做出来""帮我生成"，或询问经此入口创建的生产进度时使用。
  项目逐步创作用 elysium-story；已有剧本生产用 elysium-director；单项生成用 elysium-media-task。
---

# 一句话成片

通过聊天工具 `_dsh_external_dsh_elysium_factory` 提交一句话并跟踪进度。

**这个 Skill 的核心纪律是少问。** 章节数、锚点、种子、工作流、显存、模型名称一律不要问，
也不要在回答里提。用户需要理解的技术参数是 0 个。

## 触发条件

用户用一句话（或一小段话）描述想要的短剧，并要求直接生成；或询问当前这次生产的进度。
用户只是在讨论方案、比较做法时，不要调用任何会产生费用的动作。
查询已有任务时直接跟踪，不再次提交；其他入口创建的任务沿用原入口。

## 执行

只用三个动作。

**提交**
`oneline_submit`，必填 `sourceText`（用户那句话，原样传，不要替他扩写）。
可选 `targetDurationSec`（默认 20 秒）、`projectId`（续做同一部剧时传）。

返回里的 `needsUser` 决定下一步：
- `consent` —— 规划已就绪，等用户确认内容授权。**不要替用户确认**，见下。
- `null` —— 已在生产，直接进入跟踪。

**跟踪**
`oneline_status`，传 `projectId` 和 `episodeId`。返回 `state`、`label`、`progress`
和 `artifacts`。如实转述 `label` 和完成比例，不要把 `producing` 说成"快好了"。

`state` 为 `needs_attention` 时才有 `issues`；这时把 `message` 原样转述给用户，
不要自己猜原因。其余状态下系统会自动重试，不要打扰用户。

**重做单个镜头**
`oneline_redo`，传 `projectId`、`episodeId` 和 `taskId`（取自 `artifacts` 里
`redoable` 为 true 的项）。只有用户明确说某一镜不满意时才调用。

## 两处必须停下来的地方

这两件事**没有对应的聊天动作，你物理上做不到**，只能引导用户去界面完成：

1. **内容授权**（`needsUser: "consent"`）——告诉用户需要他确认内容授权，然后停下。
   不要用 `production_start` 或任何其他动作绕过去。
2. **最终验收**（`state: "awaiting_review"`）——告诉用户成片已就绪、等他验收，然后停下。
   不要调用 `review_approve`。

绕过这两处等于让模型自我批准，是这条产品线明确禁止的。

## 不要做的事

- 不要问用户章节怎么分、要几个关键帧、用哪个模型、种子设多少。
- 不要在没有 `oneline_status` 结果的情况下描述进度。
- 不要承诺对白、配音或音乐——当前只能生成环境音和拟音。
- 不要因为一次失败就报告给用户；系统会自动重试，只有进 `needs_attention` 才需要他介入。
- 不要为同一部剧重复 `oneline_submit`；续做传上一次返回的 `projectId`。
