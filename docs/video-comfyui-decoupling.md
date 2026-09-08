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

`video-graph.js` 根据分镜展开标准节点图；`video-execution.js` 保存请求、图、提交 ID、历史及验证结果；`functions/comfyui/client.js` 承担传输与后端协议。模板随插件分发；模型项目 `workflows/video-production/` 保存作者原文件及三种 API 导出。

## 状态与恢复

POST `/prompt` 前持久化提交意图，返回后保存原 `prompt_id`。丢失提交响应时，按 `extra_data.elysium_job_id` 查询队列与历史；无法确认时停止，不盲目重提。普通重连继续查询原任务。显式 `workflow_resume_video` 只有确认原任务终止失败后才重新提交；ComfyUI 缓存可能复用节点，不保证重启后保留 GPU 缓存。

成片下载或验收失败时，恢复下载/验收，不重复生成。每镜产物与最终产物分开返回；只认 `final` 输出为成片，不以任意中间 MP4 替代。返回成功前检查独立音/视频时长、画幅、帧率、编码及完整解码；人工审片仍为 `not_run`。

ComfyUI 队列、状态、结果、取消工具也改为 HTTP。取消仅删除指定排队 ID，不使用全局 `/interrupt`；返回 `cancel_requested` 不冒充运行中任务已取消。

旧任务保留原有结果读取兼容。显式启用的原子测试工具仍保留旧 endpoint 路径，默认生产入口不调用它们；此次没有迁移对白、插帧、超分等独立能力。

## 验证

在 `dsh-elysium-tools` 运行 `pnpm test`、`pnpm build`、`pnpm package:registry`（构建与测试串行）。测试包含：原图导出一致性、时间基准、镜头连线、模拟 HTTP 生命周期、丢响应恢复、终止失败后显式重试，以及模型仓库路径不存在时的生产调用。模拟 HTTP 不等于真实节点执行；真实 ComfyUI 与媒体验收单独记录。

本次不接入 SwarmUI，不变更 6006，不部署节点，不自动重启服务器。插件构建产物需要按现有部署流程安装后，Harness 服务才使用新版本。

## C-MMH3-18 适配

作者原文件 SHA-256 为 `5ebbc15a9d49b179b93c1291fa027b0d36aff8098d20d0eea88c9f9be9c04914`。原文件完整保留；开发时运行模型项目 `scripts/comfyui/export_h3_api.py` 生成三种 API 图，再同步至插件 `src/workflows/templates/`；一致性由测试检查。

保留作者 Director、LoRA、SigmaShift/Attention、Guider/Sampler、音视频解码、EnhancedVideoCombine 主链，节点 `_meta.title` 标明作者节点 ID。服务器缺少 `ModelPreviewOverrideKJ`、`ModelPatchTorchSettings`，兼容图旁路它们；原图已关闭的分块、潜空间超分、插帧、水印等分支不提交，不增加节点。作者 8Turbo/8步/shift 12/3 配置按当前服务器已有 4Turbo 模型适配为 Euler/4步/shift 10/5，并保留已有编码器/VAE 文件名。这是显式兼容版本，不声称与原图原样运行等价。

续拍使用作者 Guide 所调用的原生 `MiniMaxH3ImageToVideo` 接收上一镜真实末帧；Director 本身没有 IMAGE socket。24fps 生成到30fps交付按时间选择帧，不能直接改导出帧率。静态图大小与内存随帧数增长，短片通过不代表任意长片已验证。

## 2026-09-08 实测记录

- 三种 H3 模式及续拍图通过 `6016` 在线节点 schema 检查；REF2VA 素材生成质量仍未验收。
- 文生一秒 + 末帧续拍一秒：`prompt_id=0b4283aa-6484-4056-b382-570d99404e60`。两秒成片 480×854、30fps、H.264/AAC，完整解码通过；SHA-256 `9cf13a02688d62bfc622963b4682c2293fc8cb767204b393a371b33015d9ec7f`。
- 补齐逐镜输出后的有声/无声混合素材裁剪合片：`prompt_id=12755c8c-ffb9-48c8-b426-e26fe5d3e4fd`。两秒成片及两个独立一秒镜头均经 HTTP 取回；独立音视频时长、规格及完整解码通过；SHA-256 `4285cfe3214914bafa4605d680306500a1f3de44521eb7750a85719988d02946`。
- 测试进程 `LLM_AI_MODEL_ROOT` 指向不存在的目录，未挂载服务器目录，通过临时 SSH HTTP 转发访问。该转发不是永久服务入口。
- 以上不代表 Harness 已安装新版插件、内容审片、长片规模或 SwarmUI 验收。
