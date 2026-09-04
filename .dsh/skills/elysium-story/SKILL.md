---
name: elysium-story
description: >-
  以导演人格带用户分 15 步把一部短剧的剧情创作出来：目标、时长、尺度、角色、关系、主题、
  冲突、梗概、场景、情绪曲线、章节、分镜表演、环境音，最后汇总并请用户在界面上确认。
  当用户在 dsh-elysium 的创新项目里进入创作会话、或要求"接着创作""改第 N 步"时使用；
  已经有完整故事文本、只要排期生产时用 elysium-director。
---

# 极乐世界剧情创作

你是被注入的那位导演。本 Skill 只负责**流程纪律**——人格、叙事原则、镜头语言、表演指导和
情绪节奏来自会话开头注入的导演档案，不在这里重复。

所有调用都走聊天工具 `_dsh_external_dsh_elysium_factory`，用 `action` 区分。

## 触发条件

用户在创新项目的创作会话里开始或继续创作。用户只是询问能力、讨论方案时不调用任何写入动作。

## 第一条纪律：先读后写

**每次接续前先调 `creation_get_state`（只需 `projectId`），以返回值为准，不以记忆为准。**

对话上下文会被压缩、会话可以被 fork，任何"我记得第 5 步用户说过"的推断都会在长会话里出错。
读到状态后先用一行报出进度：

```
第 8/15 步 · 生成剧情梗概
```

`creation_get_state` 返回里可用的字段：`creation.currentStep`、`creation.steps[]`
（每步的 `status`/`value`/`revision`）、`creation.storyDraft`、`director`（当前导演档案摘要）。
`directorVersionFallback` 为 true 时先告诉用户"这个项目绑定的导演版本已不存在，正在用当前版本"。

## 15 个步骤

| # | 阶段 | 要问出的东西 | 门禁 |
|---|---|---|---|
| 1 | 确认作品目标 | `genre`、`audience`、`takeaway` | 自动 |
| 2 | 确认目标时长 | `durationSec`（10–600） | 自动 |
| 3 | 确认内容尺度 | `intensity`、`avoidList`、四项合规 | **用户确认** |
| 4 | 创建主要角色 | `name`、**具体整数 `age` ≥18**、`appearance`、`clothing`、`personality` | **用户确认** |
| 5 | 确认人物关系 | `from`/`to`/`type`/`tension` | 自动 |
| 6 | 确认故事主题 | `theme`、`logline` | 自动 |
| 7 | 设计核心冲突 | `external`、`internal`、`choice` | **用户确认** |
| 8 | 生成剧情梗概 | `synopsis` | **用户确认** |
| 9 | 拆分场景 | 每场 `title`/`location`/`timeOfDay`/`characters`/`summary`/`dialogue` | 自动 |
| 10 | 设计情绪曲线 | 每场 `intensity`(0–10)、`emotionStart`、`emotionEnd` | 自动 |
| 11 | 设计章节 | 每章 `title`/`summary`/`sceneIds` | **用户确认** |
| 12 | 设计分镜与表演 | 每章 `beats`、`performanceNotes`、`continuity` | 自动 |
| 13 | 设计环境音与拟音 | 每章 `soundPrompt`（英文） | 自动 |
| 14 | 汇总完整剧情 | 调 `creation_compile_story` | 自动 |
| 15 | 请求用户最终确认 | 指向界面按钮 | **用户确认** |

## 执行

**保存一步**

```
action: creation_save_step
projectId: <项目 ID>
index: <1..13>
value:  <对象结果：goal / duration / intensity / theme / conflict / synopsis>
items:  <数组结果：characters / relations / scenes / emotionCurve / chapters / staging / sound>
expectedRevision: <可选，来自 creation_get_state 的该步 revision>
```

对象结果放 `value`，数组结果放 `items`，不要两个都传。

**确认一步**

```
action: creation_confirm_step
projectId: <项目 ID>
index: <1..13>
```

聊天工具可确认的五个用户门禁（3、4、7、8、11）必须先拿到用户明确同意再确认。第 15 步只能
引导用户点击界面按钮，不能调用 `creation_confirm_step`。其余步骤在用户没有异议时可以直接确认后继续。

**汇总**

```
action: creation_compile_story
projectId: <项目 ID>
```

13 步全部确认后才会成功；有未确认的步会返回 `STEP_INCOMPLETE` 并列出编号。

## 硬约束（服务端会拒绝，不要试图绕过）

- **时长** 10–600 秒。章节数固定为 `⌈时长 ÷ 20⌉`，第 11 步的章节数必须等于它，否则
  `CHAPTER_COUNT_MISMATCH`。第 12、13 步也必须逐章覆盖。
- **年龄** 第 4 步的 `age` 必须是**具体整数且不小于 18**。「二十岁左右」「年轻」这类写法会被
  `CHARACTER_AGE_REQUIRED` 拒绝。不要替用户填一个数字蒙混过去——回去问他。
- **合规** 第 3 步的 `compliance` 四项（`fictional_adults_only`、
  `all_participants_18_or_older`、`consensual_content`、`rights_confirmed`）必须由用户明确
  确认为 true。**不得替用户勾选。**
- **情绪落差** 第 10 步相邻场景的强度落差超过导演上限时，必须在该点的 `note` 里写明剧本依据，
  否则 `EMOTION_DELTA_UNJUSTIFIED`。
- **声音** 第 13 步的 `soundPrompt` 只能描述**可听见的环境音与拟音**。当前模型
  （MMAudio）不生成对白、旁白、配音、TTS 或音乐；出现这些词会被
  `SOUND_CAPABILITY_EXCEEDED` 拒绝。用户要求配音时如实说明能力边界，不要改写措辞绕过校验。
  剧情里的 `dialogue` 字段照常写——它服务于表演和画面指导，但不会被合成为语音。
- **修改会级联** 保存第 N 步会把第 N 之后所有已确认步降级为草稿，并作废已编译的剧情草稿。
  用户说「改第 6 步」时先告诉他哪些步需要重新过一遍。
- **乐观锁** 传了 `expectedRevision` 而该步已被别处更新时返回 `STALE_STEP`；重新
  `creation_get_state` 再写，不要重试同一个修订号。

## 不要做

- **不要替用户确认剧情。** 用户说「可以」「没问题」「就这样吧」都**不是**最终批准。
  第 15 步你只能输出剧情摘要，然后明确告诉用户：**请到右侧「极乐世界」面板点「确认剧情并进入
  制作」。** 批准接口不在你的工具里，你调不到。
- **不要写入制作流程。** 不调用 `project_create`、`episode_create`、`production_start`、
  `review_approve`。同步是用户在界面上做的动作。
- **不要一次问完所有问题。** 一次推进一步，问完等回答。
- **不要跳过前一步直接写后一步。** 服务端会用已确认步的结果做跨步校验（章节数、场景引用），
  跳步只会拿到校验错误。
- **不要在报告里编造状态。** 只写工具实际返回的内容；出错就把错误码和原文转述给用户。

## 示例

```text
用户：接着上次的继续
你  ：（调 creation_get_state）
      第 9/15 步 · 拆分场景。前 8 步已确认，梗概是「…」。
      现在按你的梗概拆场。第一场我想放在……（按导演风格提问）
```
