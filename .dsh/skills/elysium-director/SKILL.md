---
name: elysium-director
description: >-
  用 dsh-elysium 插件把剧本或故事推进为成片：建项目、建单集（自动触发场景拆解与章节规划）、
  授权后自动生产、跟踪问题、人工终审。当用户给出故事文本并要求"排期""生成短剧""开始生产"
  或询问单集进度时使用；不用于反推已有视频（那是 qwen38-video-reverse 的职责）。
---

# 极乐世界导演

通过聊天工具 `_dsh_external_dsh_elysium_factory` 驱动短剧生产。导演方法论（场景拆解 →
章节锚点分配）已经实现在插件的 Producer Agent 里，本 Skill 不重复写提示词，只负责按正确
顺序调用动作、如实转述状态、在该停的地方停下。

## 触发条件

用户给出故事文本（或指向的剧本文件）并要求生成短剧、排期或开始生产；或询问某单集当前进度。
用户只是询问能力、讨论方案时，不调用任何会产生费用的动作。

## 执行

所有调用都走同一个工具，用 `action` 区分。

**第一步 · 项目**
`project_list` 查看现有项目；没有合适的再 `project_create`（需要 `title`）。不要为同一部剧
重复建项目。

**第二步 · 建单集（这一步会调用 Qwen3.8 做场景拆解和章节规划）**
`episode_create`，必填 `projectId`、`title`、`sourceText`、`targetDurationSec`（10–600 秒）；
可选 `aspectRatio`（`9:16` 或 `16:9`）、`profile`（`preview`/`final`）、`stylePrompt`、
`castPrompt`、`negativePrompt`、`budget`。

- 章节数由目标时长决定（每章 20 秒），**每章恰好 6 个锚点**：第 1 个是文生图起始帧，其余 5 个
  是连续关键帧。这是硬约束，不要试图改成别的数量。
- 规划失败（`PLANNER_*` 系列错误）时如实报告原文，不要自己编一份 plan 塞进去。
- 需要人工改规划时用 `episode_update` 传 `plan` / `script` / `assets` / `updates`，改完再生产。

**第三步 · 生产授权**
`production_start` 需要 `confirmAuthorizedContent: true`。**这是产生 GPU 费用的一步**：必须
用户明确授权后才传 true，不得替用户勾选。授权记录会写进单集。

**第四步 · 跟踪**
`production_status` 读取单集、阶段、任务和问题快照。调度是依赖驱动的自动流程，不要逐阶段手动
催；有明确失败再动作：

- `production_retry`（`taskId` 或实体）精确重试；
- `issue_resolve` 处理集中问题（`issueId` + `resolution`）；
- `artifact_adopt` 采用指定历史版本（`path`）；
- `production_pause` / `production_resume` 控制是否继续提交新任务。注意 `pause` 只停新任务，
  已产生费用的远端任务会继续收敛。

**第五步 · 人工终审**
技术 QC 通过后单集进入 `awaiting_review`。`review_approve` 需要 `confirmHumanReviewPassed: true`
且绑定当前成片哈希。**必须用户完整看过成片并明确通过后才可为 true。**

## 状态口径

单集：`draft → ready → running → awaiting_review → approved`，异常分支 `paused` 与
`needs_attention`。任务：`pending → queued → running → succeeded`，失败分支 `retry_wait`、
`needs_attention`、`cancelled`，上游变更后旧产物转 `stale`。

报告时只写工具实际返回的状态，不要用推测代替证据；`needs_attention` 必须转述原始错误。

## 不要做

- 不要使用旧 `vmp-1` 生产单（`create`/`run`/`shot-01`/`block-01` 那套）。那是 `/factory.execute`
  的兼容入口，新流程一律走 project/episode 动作。
- 不要替用户勾 `confirmAuthorizedContent` 或 `confirmHumanReviewPassed`。
- 不要在 `elysium-workspace/`、`registry/` 里手改产物或模板（都是运行时/生成目录）。

## 示例

```text
/elysium-director 目标 60 秒竖屏，故事见下：<粘贴剧本文本>
```

先 `project_list` 看有没有可复用项目，再 `episode_create` 建单集并报告章节数与锚点数，
然后停下来等用户授权生产。
