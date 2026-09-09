# 视频生产与模型脚本解耦

当前链路：`Harness → workflow_generate_video → 自动选择 generate/director 工作流 → ComfyUI HTTP → 最终 MP4`。

## 运行边界

生产路径只需要工具插件、可访问的 ComfyUI、Harness 本机素材/状态目录和用于素材探测、成片验收的 FFmpeg/FFprobe。不需要 模型项目脚本入口或 ComfyUI 服务器目录挂载；本地二进制不承担生成、剪辑、拼接。

配置：

- `MINIMAX_H3_COMFYUI_URL`：服务地址，必须显式配置。
- `MINIMAX_H3_COMFYUI_PUBLIC_URL`：浏览器可访问的产物服务地址，必须显式配置，不回退到内部请求地址。
- `ARTIFACTS_ROOT`：Harness 本机素材与下载目录。输入仍为该目录内的真实文件，经过 HTTP 上传后变成 ComfyUI input 文件名。
- `ELYSIUM_TOOLS_STATE_ROOT`：Harness 本机持久化任务目录。
- `FFMPEG_BIN`、`FFPROBE_BIN`：本机验收工具；缺失时不宣称媒体验收成功。

`video-graph.js` 按执行单元分流：一个生成片段使用 `workflow_generate_video`；多个片段或已有视频剪辑使用 `workflow_director_video`。一次生成内的多个镜头不拆成多段。两份源图位于模型项目 `workflows/video-generate-minimax-h3/`，作者参考图仍为 `workflows/video-generate-minimax-h3/template/C-MMH3-18.json`。

节点类型、控件参数、生成分支连线和操作模板从可视化图导出。插件按片段数展开模板并绑定提示词、时长、素材、随机种子和输出路径；续接及按时间取帧的展开由 `video-graph.js` 完成。时间映射由自定义 `ElysiumSelectFrames` 节点按索引一次取帧，并返回选取后的真实末帧；模型仓库的 `app/deploy_workflows.sh` 部署 `scripts/common/comfyui/elysium_media.py`。首次安装或更新该节点后须按授权在队列空闲时重启 ComfyUI。可选参考、首帧等模板在源图中禁用，插件选择时才实例化。

`comfy-execution.js` 供视频及图片／合片编排共用，保存 `comfyui-workflow.json`（执行图、请求、选中的工作流与规格）以及 `comfyui-workflow-ui.json`（本次实际展开的可视化图）。后者以 `extra_data.extra_pnginfo.workflow` 随 `/prompt` 提交，可从 ComfyUI 历史加载，节点 ID 与执行图一致。恢复时复用原始快照，不用新模板重建已提交任务；旧任务没有 UI 快照时仍按原 API 图恢复。

开发时在模型仓库运行 `python3 scripts/common/comfyui/build_video_workflows.py`，自动更新相邻插件的 `src/workflows/templates/workflow_*.json`；`--check` 只检查同步状态。运行时只读取插件包内模板。修改源图后需重新导出、测试并按授权发布。

## 状态与恢复

POST `/prompt` 前持久化提交意图，返回后保存原 `prompt_id`。丢失提交响应时，按 `extra_data.elysium_job_id` 查询队列与历史；无法确认时停止，不盲目重提。普通重连继续查询原任务。显式 `workflow_resume_video` 只有确认原任务终止失败后才重新提交；ComfyUI 缓存可能复用节点，不保证重启后保留 GPU 缓存。

成片下载或验收失败时，恢复下载/验收，不重复生成。每镜产物与最终产物分开返回；只认 `final` 输出为成片，不以任意中间 MP4 替代。返回成功前检查独立音/视频时长、画幅、帧率、编码及完整解码；人工审片仍为 `not_run`。

ComfyUI 队列、状态、结果、取消工具也改为 HTTP。取消仅删除指定排队 ID，不使用全局 `/interrupt`；返回 `cancel_requested` 不冒充运行中任务已取消。

旧任务保留原有结果读取兼容。插件仅保留图片、视频、合片及任务管理入口。

## 验证

本地回归在 `dsh-elysium-tools` 运行 `pnpm test`。按授权发布时再运行 `pnpm build`、`pnpm package:registry`（构建与测试串行）。测试包含：原图导出一致性、时间基准、镜头连线、模拟 HTTP 生命周期、丢响应恢复、终止失败后显式重试，以及模型仓库路径不存在时的生产调用。模拟 HTTP 不等于真实节点执行；真实 ComfyUI 与媒体验收单独记录。

本次职责重构与核对记录见 [执行链路](tools-execution-chain.md)；重构代码尚未构建或部署。

当前所有 ComfyUI 能力入口统一使用 `minimax-h3` 服务配置（6016），插件的图片、视频与合片入口均使用 ComfyUI 工作流；尚未接入 SwarmUI。此前部署与重启情况见下方带日期的实测记录。

## C-MMH3-18 适配

作者原文件 SHA-256 为 `5ebbc15a9d49b179b93c1291fa027b0d36aff8098d20d0eea88c9f9be9c04914`。原文件完整保留；现在以两份生产可视化图为导出来源；原始作者图只作参考，不由导出脚本手写重建。源图与插件导出的同步、实际执行图与可视化快照的连线一致性由测试检查。

保留作者 Director、LoRA、SigmaShift/Attention、Guider/Sampler、音视频解码、EnhancedVideoCombine 主链，节点 `_meta.source_id` 对应生产可视化源图的节点 ID。服务器缺少 `ModelPreviewOverrideKJ`、`ModelPatchTorchSettings`，兼容图旁路它们；原图已关闭的非生产分支不提交，不增加节点。原图的 pruned int8 模型、res_multistep/25步配置按当前服务器已有 4Turbo 模型适配为 Euler/4步/shift 10/5，并保留已有编码器/VAE 文件名。这是显式兼容版本，不声称与原图原样运行等价。

续拍使用作者 Guide 所调用的原生 `MiniMaxH3ImageToVideo` 接收上一镜真实末帧；Director 本身没有 IMAGE socket。24fps 生成到30fps交付按时间选择帧，不能直接改导出帧率。取帧节点数量按镜头增长，帧索引列表与解码张量内存仍随帧数增长，短片通过不代表任意长片已验证。

## 2026-09-08 实测记录

- 三种 H3 模式及续拍图通过 `6016` 在线节点 schema 检查；REF2VA 素材生成质量仍未验收。
- 文生一秒 + 末帧续拍一秒：`prompt_id=0b4283aa-6484-4056-b382-570d99404e60`。两秒成片 480×854、30fps、H.264/AAC，完整解码通过；SHA-256 `9cf13a02688d62bfc622963b4682c2293fc8cb767204b393a371b33015d9ec7f`。
- 补齐逐镜输出后的有声/无声混合素材裁剪合片：`prompt_id=12755c8c-ffb9-48c8-b426-e26fe5d3e4fd`。两秒成片及两个独立一秒镜头均经 HTTP 取回；独立音视频时长、规格及完整解码通过；SHA-256 `4285cfe3214914bafa4605d680306500a1f3de44521eb7750a85719988d02946`。
- 测试进程未配置模型项目目录，未挂载服务器目录，通过临时 SSH HTTP 转发访问。该转发不是永久服务入口。
- 新版插件安装后直接调用 Harness profile 中的工具包：未依赖模型项目目录，复用素材的一秒任务 `prompt_id=68761a35-e3e4-4b0a-a52e-e8f98b631acc` 成功；逐镜与成片下载、独立音视频时长、规格及完整解码通过，恢复调用保持原任务 ID。部署时 50 项测试通过，Harness 3080 与现有本地 23080 入口均返回 HTTP 200。部署脚本最后新建隧道步骤因 23080 已占用退出；现有 SSH 隧道继续使用。
- 本地旧工作流目录及对应编排测试已删除；导出器迁至 `scripts/common/comfyui/build_video_workflows.py`。旧 `app/start_comfyui.sh` 已删除，启动入口继续调用 `start_comfyui_minimax.sh`。
- 以上不代表 Harness 自然语言对话、内容审片、长片规模或 SwarmUI 验收。

## 地址配置约束

`app/config/harness-settings.yaml` 的 `harness-runtime` 是 Harness 部署配置入口。部署器将工具运行值写入 profile 的插件节点 config；独立安装按插件 README 配置，无需部署器。地址必须填写，本机目录有默认值，非法配置会报错。当前合片同样通过 ComfyUI，必须提供服务地址。

内部 API 与浏览器产物地址分别配置为 `MINIMAX_H3_COMFYUI_URL`、`MINIMAX_H3_COMFYUI_PUBLIC_URL`。SSH 目标、监听主机和端口也由配置读取。更换地址后须重新应用配置并重启 Harness 才对运行进程生效；本次配置改造未执行远程部署或服务重启。

模型仓库独立读取自己的 `config/comfyui.yaml`、`config/runtime.yaml` 和 `config/paths.yaml`，Harness 不读取模型仓库配置。`production` 实例标识已移除，旧调用须改用 `minimax-h3`。


兼容视频工具 `model_generate_video` 和 `model_generate_video_long` 同样调用 ComfyUI 后台任务，保留会话卡片绑定与恢复能力；不再运行 Shell 视频入口。长视频旧 preset 名称仅作兼容，规格取可视化工作流。

图片与已有视频合片已迁移为同类 ComfyUI 后台任务，源图分别位于模型仓库 `workflows/image-generate-sdxl/` 与 `workflows/video-concat/`，通过 `scripts/common/comfyui/build_image_concat_workflows.py` 导出。图片取消 fast，仅保留 standard，并同步视频首帧组件。新增 `model_job_resume` 和图片媒体回传。
