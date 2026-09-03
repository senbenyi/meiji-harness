---
name: vmp-video-factory
description: 在 DeepSeek Harness 中把故事规划为动态六锚点章节，并通过极乐世界完成自动生产、恢复、重试和验收。
---

# 极乐世界短剧生产

- 只调用 `_dsh_external_dsh_elysium_factory`，不绕过插件直接提交 ComfyUI。
- 先用 `project_list` 查找项目；需要新项目时使用 `project_create`。
- 根据故事和目标时长生成章节规划，再调用 `episode_create`。每章必须正好包含 6 个有序锚点：第 1 个 `start`，其余 5 个 `continuation`；每个锚点都有 `imagePrompt` 和 `motionPrompt`。
- 章节数量由目标时长决定。默认按约 20 秒一章规划，不固定为 2 章。
- `plan.source` 使用 `producer-agent`。提示词必须具体描述人物、场景、动作、构图和连续性，不能用同一句话填满全部锚点。
- 第一次付费生成前必须取得本次单集的明确授权，再调用 `production_start` 并传 `confirmAuthorizedContent=true`。后续恢复使用 `production_resume`，不重复索要授权。
- 使用 `production_status` 查询持久化状态。失败时只对精确 `taskId` 调用 `production_retry`，不要删除或覆盖旧产物。
- 技术 QC 通过后状态为 `awaiting_review`。只有用户完整观看当前成片并明确确认后，才能调用 `review_approve`。
- 只有状态为 `approved` 时，才能称为完整交付。
