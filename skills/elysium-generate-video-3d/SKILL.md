---
name: elysium-generate-video-3d
description: 使用当前项目已验证的 Elysium Qwen Image 2.1 与 MiniMax H3 工作流，把故事创意制作成完整 3D 动画短片。
trigger: 用户要求制作包含角色、场景、镜头规划、逐镜生成与拼接交付的 3D 动画短片时使用。
---

# 3D 动画短片（Elysium）

## 硬边界

- 只使用以下工作流家族：
  - `elysium-qwen-image-21-t2i-*`
  - `elysium-qwen-image-21-i2i-*`
  - `elysium-minimax-h3-ref2v-*`
  - `elysium-minimax-h3-i2v-*`
- 每种 capability 第一次调用前先运行 `comfy_list_workflows`。解析结果不是相应 Elysium 家族时立即停止，报告配置错误；不得回退到作者工作流。
- H3 提示词只委托 `elysium-generate-minimax-h3`。
- 当前 Elysium 视频清单不声明 `chain`，禁止传 `continuity_from`，不得承诺 latent 续接。
- 当前活动注册表没有 `image.from_video` 和 `video.upscale`，不得调用抽帧或超分，也不得承诺 2K/4K 后处理交付。
- Skill 只表达 capability、tier 和创作参数；模型文件名以 manifest/config 为准。

## 能力对应

| 任务 | 调用 |
| --- | --- |
| 角色卡、场景卡、分镜静帧 | `comfy_generate_image` |
| 基于单张卡片改绘 | `comfy_render(capability='image.image2image', ref_nodes=[...])` |
| 参考图约束的视频镜头 | `comfy_generate_video(type='r2v', ref_nodes=[...])` |
| 首帧或首末帧约束的视频镜头 | `comfy_generate_video(type='i2v', first_frame_node=..., last_frame_node=...)` |
| 拼接片段 | `video_concat` |

三档均为 `fast` / `balanced` / `quality`。缺省固定为 `fast`；只有需要日常或成片档时才显式传 `balanced` / `quality`。

## 整书快速验证模式

用户明确要求整部小说快速验证，并允许降低图片/视频质量、跳过质检时，优先走本模式：

1. 沿用文本开发已经批准的全部分集与镜头；不重新读取全文，也不在媒体阶段重做剧情推理。只有用户明确要求浓缩版时才使用 1 集、8–12 镜。
2. 每种 capability 只调用一次 `comfy_list_workflows`，确认 `fast` 解析到 Elysium 实现；同一项目不重复核对实现。
3. 资产上限为 2 张主角单视图卡和 3 张无人场景卡，全部 `tier=fast`；可复用已有合格卡片，不做 quality 重绘、字节一致性比对或逐张确认。
4. 镜头表只做一次结构自检。逐镜即时生成 H3 prompt，生成完成后不在后续上下文重复携带以前镜头的 prompt。
5. 所有视频固定 `tier=fast`、124 帧；调用一次 `studio_batch_generate` 创建持久异步任务后立即释放 Agent，不在对话里等待 GPU。后续只用 `studio_production_status` 读取紧凑进度；中断后用 `studio_production_resume` 恢复，禁止重复提交已带 `promptId` 的任务。
6. 跳过逐镜人工批准和视觉终检。全部成功镜头按顺序调用一次 `video_concat`；失败镜头在交付中列明，不阻塞其余镜头生成。
7. 镜头用 `studio_shot_batch_upsert` 一次写入，生成用 `studio_batch_generate`，保存返回的 `runId`。后台 Worker 完成后，候选资产用 `studio_review_batch_decide` 按用户本次授权一次批准，再组装 timeline 并导出。

该模式的完成标准是“全部规划分集都已处理，整书主线有开端、冲突、高潮和结局，且成片可播放”，不是只完成局部样片。

## 工作流

### 1. 确认生产规格

开始前确认：故事目标、总时长、画幅、视觉基调、台词语言、音频要求、交付到哪一步，以及生成档位。没有明确台词语言时不要替用户指定。

把确认结果写入项目简报。默认画幅可建议 16:9，但必须以用户选择为准。

### 2. 生成资产

1. 先写角色和场景的文字设定。
2. 用 `image.text2image` 生成单视图角色卡和无人场景卡；卡面不得带文字、拼图或多视图。
3. 需要修改已有卡片时使用 `image.image2image`，prompt 明确“保留什么、只改什么”。
4. 每张资产经用户确认后再进入镜头规划。

### 3. 镜头表

镜头表至少包含：镜号与时长、连续性状态、参考锚点、画面与运镜、音频与对白、生成形态。

- 同场景连续性依靠一致的角色卡、场景卡、空间锚点、光线和动作交接，不声称 latent 续接。
- `r2v` 用于角色/场景参考绑定；`i2v` 只用于已有静帧节点作为首帧或末帧锚点。
- 每镜 5–15 秒；帧数按 H3 的 `17k+5` 网格规划，如 124 帧约 5 秒。
- 全片保持统一画幅；分档尺寸由 manifest 决定。

镜头表完成后先做自检，再让用户批准，未批准不进入批量生成。

### 4. 分镜与 Prompt

每镜写一段可独立执行的分镜章节：开场状态、逐秒动作、镜头运动、声音、对白/字幕、结束状态与下一镜交接。

调用 `elysium-generate-minimax-h3` 生成 H3 结构化 prompt。字幕和画面内文字完全遵循该 Skill 的写法，不在此重复另一套规则。

### 5. 逐镜生成

逐镜执行，不并发烧满显存：

1. 再次核对 capability + tier 实际解析到的 `implementation` 以 `elysium-` 开头。
2. 正片镜优先调用 `comfy_generate_video(type='r2v', tier=..., ref_nodes=[角色卡, 场景卡], ...)`。
3. 已有批准静帧需要精确起止构图时调用 `type='i2v'`；不得同时传 `ref_nodes`。
4. 工具返回的 `warnings`、实际尺寸、实现和失败原因必须如实记录。
5. 单镜失败先修 prompt 或锚点；同一参数不得原样盲重试。字幕字准问题可升到 `quality`，但要明确成本变化。

每镜生成后让用户选择批准或重做。重做产生新节点后，后续引用只使用新节点。

### 6. 拼接与交付

所有镜头批准后按镜头表顺序调用 `video_concat`。终检：镜头顺序、总时长、角色/场景一致性、对白与字幕、音频接缝、黑帧、重复帧和交付尺寸。

交付回复列出：成片节点、各镜节点、实际档位与尺寸、未解决问题。不得声称已执行被归档的抽帧、续接或超分能力。
