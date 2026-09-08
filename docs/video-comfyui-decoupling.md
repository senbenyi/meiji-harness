# 视频生产与模型脚本解耦

当前链路：`Harness → workflow_generate_video → ComfyUI HTTP → C-MMH3-18 兼容 API 图 → 最终 MP4`。

## 运行边界

生产路径只需要工具插件、可访问的 ComfyUI、Harness 本机素材/状态目录和用于素材探测、成片验收的 FFmpeg/FFprobe。不需要 `LLM_AI_MODEL_ROOT`、模型项目 Python、Shell 入口或 ComfyUI 服务器目录挂载；本地二进制不承担生成、剪辑、拼接。

配置：

- `MINIMAX_H3_COMFYUI_URL`：服务地址，默认 `http://127.0.0.1:6016`。
- `MINIMAX_H3_COMFYUI_PUBLIC_URL`：浏览器可访问的产物服务地址；未设置时使用服务地址，不会自动建立公网入口。
- `ARTIFACTS_ROOT`：Harness 本机素材与下载目录。输入仍为该目录内的真实文件，经过 HTTP 上传后变成 ComfyUI input 文件名。
- `ELYSIUM_TOOLS_STATE_ROOT`：Harness 本机持久化任务目录。
- `FFMPEG_BIN`、`FFPROBE_BIN`：本机验收工具；缺失时不宣称媒体验收成功。

`video-graph.js` 根据分镜展开标准节点图；`video-execution.js` 保存请求、图、提交 ID、历史及验证结果；`functions/comfyui/client.js` 承担传输与后端协议。模板随插件分发，来源及旁路差异见模型项目 `workflows/video-production/README.md`。

## 状态与恢复

POST `/prompt` 前持久化提交意图，返回后保存原 `prompt_id`。丢失提交响应时，按 `extra_data.elysium_job_id` 查询队列与历史；无法确认时停止，不盲目重提。普通重连继续查询原任务。显式 `workflow_resume_video` 只有确认原任务终止失败后才重新提交；ComfyUI 缓存可能复用节点，不保证重启后保留 GPU 缓存。

成片下载或验收失败时，恢复下载/验收，不重复生成。每镜产物与最终产物分开返回；只认 `final` 输出为成片，不以任意中间 MP4 替代。返回成功前检查独立音/视频时长、画幅、帧率、编码及完整解码；人工审片仍为 `not_run`。

ComfyUI 队列、状态、结果、取消工具也改为 HTTP。取消仅删除指定排队 ID，不使用全局 `/interrupt`；返回 `cancel_requested` 不冒充运行中任务已取消。

旧任务保留原有结果读取兼容。显式启用的原子测试工具仍保留旧 endpoint 路径，默认生产入口不调用它们；此次没有迁移对白、插帧、超分等独立能力。

## 验证

在 `dsh-elysium-tools` 运行 `pnpm test`、`pnpm build`、`pnpm package:registry`（构建与测试串行）。测试包含：原图导出一致性、时间基准、镜头连线、模拟 HTTP 生命周期、丢响应恢复、终止失败后显式重试，以及模型仓库路径不存在时的生产调用。模拟 HTTP 不等于真实节点执行；真实 ComfyUI 与媒体验收单独记录。

本次不接入 SwarmUI，不变更 6006，不部署节点，不自动重启服务器。插件构建产物需要按现有部署流程安装后，Harness 服务才使用新版本。
