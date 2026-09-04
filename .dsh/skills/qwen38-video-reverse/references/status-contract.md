# 状态输出契约

每次只输出当前发生变化的阶段，使用下列 YAML 字段：

```yaml
workflow: qwen38-video-reverse
run_id: runid-1658-ep-5
episode_id: 1658-ep-5
artifact_date: 20260901
step: 1/5
name: Qwen3.8 API 就绪
status: running
evidence: "[1/5] 启动或复用 Qwen3.8 API"
outputs: []
next: 等待 API 验收后下载授权视频
```

- `workflow`：固定为 `qwen38-video-reverse`。
- `run_id` / `episode_id`：本次真实值；`run_id` 必须以小写 `runid-` 开头。
- `artifact_date`：共享产物所属的 `YYYYMMDD` 日期目录。
- `step`：`accepted`、`1/5` 至 `5/5`、`completed` 或 `failed`。
- `status`：只允许 `accepted`、`running`、`succeeded`、`failed`、`completed`、`not_run`。
- `evidence`：实际命令输出、退出码或校验证据；不输出思考过程。
- `outputs`：本阶段已确认存在的文件或目录，尚未产生时为 `[]`。
- `next`：下一个动作；失败时改为需要用户处理的单一事项。

| 标记 | 阶段名 | 成功证据 |
|---|---|---|
| `[1/5]` | Qwen3.8 API 就绪 | 出现 `[2/5]` |
| `[2/5]` | 授权视频下载 | 出现 `[3/5]` |
| `[3/5]` | 完整视频分析与 42 帧提取 | 出现 `[4/5]` |
| `[4/5]` | 工作流输入与产物生成 | 出现 `[5/5]` |
| `[5/5]` | 契约校验与发布 | 同时出现两条 `[DONE]` 路径 |

`completed` 记录还必须包含：

```yaml
validation:
  source_video: passed
  analysis_json: passed
  analysis_report: passed
  reference_frames: 42
  workflow_blocks: 7
  episode_json: passed
  keyframes_json: passed
downstream_generation: not_run
```
