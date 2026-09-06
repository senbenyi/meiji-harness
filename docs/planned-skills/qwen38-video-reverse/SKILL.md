---
name: qwen38-video-reverse
description: 用 Qwen3.8 下载并反推已授权的剧集视频 URL，为 DeepSeek Harness 的每个流水线阶段输出结构化中文进度，并验收 workflow inputs 和 artifacts。当用户要求下载、解析、反推视频或查看该流程状态时使用。
---

# Qwen3.8 视频反推

> **状态：规格文档，当前不可执行。** 下文依赖的 `workflows/qwen38/scripts/run_pipeline.sh`
> 在本仓库与 `llm-ai-model` 的全部 git 历史中从未存在过。反推能力属于本插件的业务能力，
> 实现落地前，本文件只作为待实现规格；不要按下文命令直接执行，也不要声称已完成反推。

用唯一入口处理视频，同时让用户看到每个阶段正在做什么、实际结果和下一步。

## 请求解析

1. 只处理用户有权处理的 HTTP(S) URL。用户只是举例、询问能力或讨论方案时，不执行流水线。
2. 用户已给出 `EPISODE_ID` 时原样使用；`RUN_ID` 仅接受小写 `runid-<标识>`，例如 `runid-1658-ep-2`。拒绝 `episode-...`、大写、下划线、点号和路径分隔符，不自行改成其他前缀。
3. 如果 URL 形如 `/video/<series>/ep-<number>/` 且用户没有给 ID，推导 `EPISODE_ID=<series>-ep-<number>` 和 `RUN_ID=runid-<series>-ep-<number>`。
4. `ARTIFACT_DATE` 使用服务器 `Asia/Shanghai` 当日；用户明确要求补跑到某日时才设置 `QWEN38_ARTIFACT_DATE=YYYYMMDD`。
5. 执行前输出 `accepted` 记录，明确 URL、ID、日期、两个目标目录和命令。
6. 已存在的 workflow input、当日 artifact 或 `.<runid>.incoming` 都不覆盖；报告冲突路径并请用户给出新的合规 `RUN_ID`，不得自行生成 `episode-...` 等旁路名称。

## 执行

只运行：

```bash
bash workflows/qwen38/scripts/run_pipeline.sh '<URL>' '<EPISODE_ID>' --run-id '<RUN_ID>'
```

- 不拆分调用底层脚本，不运行下游视频或音频生成。
- 使用 `bash` 工具的 `run_in_background: true`，保存返回的 job id。
- 使用 `job_output` 读取增量输出。没有新输出时不忙轮询；收到完成通知时立即收集最终输出。
- 识别 `[1/5]` 至 `[5/5]`。看到下一个阶段时才将前一阶段标记为 `succeeded`；看到两条 `[DONE]` 路径才将第 5 阶段标记为 `succeeded`。
- 每次状态变化都按 [references/status-contract.md](references/status-contract.md) 输出一条记录，不用推测代替证据。

## 失败和完成

- 失败时把当前阶段标记为 `failed`，保留最后一条原始错误，列出已完成阶段和可能的 incoming 目录。不自动删除、覆盖或重试。
- 完成时输出 `completed` 总结，列出 `workflows/qwen38/inputs/<runid>/`、`/root/autodl-fs/artifacts/YYYYMMDD/<runid>/`、中文 `analysis/report.md`、42 张参考帧、7 个 block 和关键 JSON 校验结果。
- 未执行下游生成必须明确写 `not_run`。

## 示例

```text
/qwen38-video-reverse https://huangguoai.com/video/1658/ep-5/
```

未指定 ID 时，先报告 `EPISODE_ID=1658-ep-5` 和 `RUN_ID=runid-1658-ep-5`，再进入后台流水线。
