---
name: qwen38-video-rerun
description: 复用已有 Qwen3.8 artifact 的 source/source.mp4，在提示词调整后跳过下载并重新反推，生成全新的 workflow inputs 和 artifacts。当用户给出 /root/autodl-fs/artifacts/.../source/source.mp4 并要求重新反推时使用；新视频 URL 仍使用 qwen38-video-reverse。
---

# Qwen3.8 既有视频重新反推

> **状态：规格文档，流水线已可执行。** `run_pipeline.sh` 已在 `llm-ai-brain` 实现（支持
> `--source-video` 复用模式）。本文件作为行为规格参考；Harness Skill 包装尚未随插件分发。

复用已经归档的授权源视频，按当前提示词重新执行完整分析、42 帧提取、生产包生成和契约校验。旧 run 必须保持不变。

## 请求解析

1. 仅接受绝对路径 `/root/autodl-fs/artifacts/YYYYMMDD/<old-run-id>/source/source.mp4`。用户只是举例、询问能力或讨论方案时，不执行流水线。
2. 从同一旧 run 的 `episode/episode.json` 读取 `id` 作为 `EPISODE_ID`；文件缺失、JSON 无效或 id 不合规时停止，不根据目录名猜测。
3. 用户指定新 `RUN_ID` 时，要求其符合小写 `runid-<标识>`，且 workflow input、当日 artifact 和 incoming 目录均不存在。
4. 用户未指定新 `RUN_ID` 时，以旧 run ID 为前缀，选择第一个未占用的 `<old-run-id>-rerun-N`，从 `N=1` 递增检查。不得复用旧 run ID，也不得覆盖任何既有目录。
5. `ARTIFACT_DATE` 默认使用服务器 `Asia/Shanghai` 当日；用户明确要求补跑到某日时才设置 `QWEN38_ARTIFACT_DATE=YYYYMMDD`。
6. 用户给出新的 instruction 文件时增加 `--instruction-file '<FILE>'`，并先确认文件存在且非空；否则使用当前已部署代码中的提示词。
7. 执行前输出 `accepted` 记录，明确源视频、原 run、新 run、episode、日期、instruction 来源、两个新目标目录和实际命令。

## 执行

只运行唯一入口：

```bash
bash workflows/qwen38/scripts/run_pipeline.sh \
  --source-video '<SOURCE_MP4>' '<EPISODE_ID>' \
  --run-id '<NEW_RUN_ID>' \
  [--instruction-file '<FILE>']
```

- 不调用下载脚本，不拆分调用底层分析、打包或校验脚本。
- 使用后台 job 执行并保存 job id；只在有增量输出或完成通知时读取结果，不忙轮询。
- 识别 `[1/5]` 至 `[5/5]`。阶段 2 必须看到 `[SOURCE] 复用既有 artifact 源视频`，否则不得声称已跳过下载。
- 看到下一阶段时才将前一阶段标记为 `succeeded`；同时看到两条 `[DONE]` 路径才将第 5 阶段标记为 `succeeded`。
- 每次状态变化输出结构化中文 YAML，字段使用：`workflow`、`run_id`、`episode_id`、`artifact_date`、`step`、`name`、`status`、`evidence`、`outputs`、`next`。`workflow` 固定为 `qwen38-video-rerun`。

## 失败和完成

- 失败时保留最后一条原始错误，列出已完成阶段和可能存在的 incoming 目录；不自动删除、覆盖或重试。
- 完成时列出新的 `workflows/qwen38/inputs/<runid>/`、`/root/autodl-fs/artifacts/YYYYMMDD/<runid>/`，并确认中文报告、42 张参考帧、7 个 block 和关键 JSON 均通过校验。
- 明确写出旧 run 未修改、下载 `not_run`、下游视频和音频生成 `not_run`。

## 示例

```text
/qwen38-video-rerun /root/autodl-fs/artifacts/20260901/runid-1658-ep-2/source/source.mp4
```

若旧 run 元数据中的 episode id 为 `1658-ep-5`，且没有已有 rerun，则新 run 使用 `runid-1658-ep-2-rerun-1`。
