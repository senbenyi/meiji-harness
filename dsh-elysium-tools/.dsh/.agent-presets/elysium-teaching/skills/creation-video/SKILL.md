---
name: creation-video
description: 使用 RunPod 现有 MiniMax H3 五种模式整理提示词、生成和改稿。
---

# 视频创作

只调用 `workflow_generate_video`；根据输入选择 `t2va`、`i2va`、`fl2va`、`fl2va-loop` 或 `r2va`。

- 只补关键缺项，用当前 Harness 模型整理一版可直接提交给 MiniMax H3 的最终提示词；明确主体、动作、场景、镜头和声音，按 schema 执行。
- 图片素材必须是当前 RunPod 的 ComfyUI `/view` URL；不使用本地路径，不下载或检查模型文件。
- 不传工作流未公开的参数；模型、时长、分辨率、帧率、采样器和后处理保持 RunPod 快照原值。
- 改稿只改指定部分；咨询或保存不生成，任务成功不等于人工验收通过。
