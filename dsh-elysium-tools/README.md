# dsh-elysium-tools

独立的 DeepSeek Harness Function Call 工具插件。安装后可在 Harness 对话中用一句话调用图片、视频、对白和任务查询能力。

调用链为 `Harness → dsh-elysium-tools → llm-ai-model/scripts/endpoint`，不依赖额外 HTTP 服务。

## 使用前说明

- 可以直接说“调用 `工具名`……”，也可以只描述目标，让 Harness 选择工具。
- `image_path`、`reference_path` 和 `video_path` 必须是服务器共享产物目录 `/root/autodl-fs/artifacts/` 内已有文件的绝对路径，不能传本机路径或网址。
- 生成和处理工具会直接执行服务器脚本并等待完成，成功后返回 `job_id`、产物绝对路径、文件大小和 SHA-256。
- `seed` 相同不保证不同模型或工作流版本产生完全相同的结果。

## 工具使用

7 个能力工具与 endpoint 一一对应；`model_job_status`、`model_job_result` 仅负责查询。

| 工具 | Endpoint |
|---|---|
| `model_generate_image` | `generate_image.sh` |
| `model_generate_video` | `generate_video.sh` |
| `model_generate_video_long` | `generate_video_long.sh` |
| `model_generate_video_audio` | `generate_video_audio.sh` |
| `model_generate_dialogue` | `generate_dialogue.sh` |
| `model_interpolate_video` | `interpolate_video.sh` |
| `model_upscale_video` | `upscale_video.sh` |


### ComfyUI 任务管理

| 工具 | `scripts/comfyui/` 入口 |
|---|---|
| `comfyui_task_queue` | `task_queue.sh` |
| `comfyui_task_status` | `task_status.sh` |
| `comfyui_task_result` | `task_result.sh` |
| `comfyui_task_cancel` | `task_cancel.sh` |

必填 `server: production|minimax-h3`；除队列查询外，必填原生 `prompt_id`，不能传插件 `job_id`。地址由模型项目 `config/autodl-server.yaml` 的 `comfyui` 配置读取。

取消仅针对排队任务；运行中的任务不会全局中断。产物返回派生 ID 与访问 URL，不代表媒体已验收。实例本机 URL 不保证客户端可访问。

部署需同时更新模型项目的脚本与配置，以及工具插件；仅更新插件不能补齐服务器脚本。

### `model_generate_image`

根据文字生成图片。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `prompt` | 是 | - | 画面描述 |
| `preset` | 否 | `standard` | `fast` 或 `standard` |
| `seed` | 否 | `666` | 随机种子 |

一句话示例：

```text
调用 model_generate_image，生成一张电影感的雨夜东京街头照片，霓虹灯倒映在路面，preset 使用 standard，seed 使用 666。
```

### `model_generate_video_long`

使用角色锚点图片和 1..6 段提示词执行 Wan2.2 Remix v3 + SVI2Pro。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `image_path` | 是 | - | 角色锚点图片绝对路径 |
| `prompts` | 是 | - | 1..6 条连续视频提示词 |
| `preset` | 否 | `long_mvp_preview` | `long_mvp_preview` 或 `long_mvp_final` |
| `seed` | 否 | `666` | 随机种子 |

一句话示例：

```text
调用 model_generate_video_long，角色图片使用 /root/autodl-fs/artifacts/projects/tool-<image-job>/assets/characters/img.png，prompts 依次为“缓慢转身”“走向窗边”“回头看向镜头”，preset 使用 long_mvp_preview。
```

### `model_generate_video`

对应 `generate_video.sh`，必填 `mode`、`prompt`，可选 `seed`（默认 666）。

| mode | 作用 | 参考参数 |
|---|---|---|
| `text` | 文字生成视频 | 不接受参考素材 |
| `image` | 起始图片生成视频 | 必填 `image_path` |
| `reference` | 参考素材生成视频 | `image_path`、`video_path`、`audio_path` 至少一项 |

执行模型由 `models_routes.yaml` 决定；声音支持、尺寸和时长以执行模型为准。

### `model_generate_dialogue`

对应 `generate_dialogue.sh`。必填 `text`（对白文本），可选 `language`（默认 `zh`）、`seed`（默认 42），返回音频产物。

### `model_interpolate_video`

对视频插帧，提高帧率和运动流畅度。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `video_path` | 是 | - | 输入视频绝对路径 |
| `multiplier` | 否 | `2` | 插帧倍数：`2`、`3` 或 `4` |

一句话示例：

```text
调用 model_interpolate_video，把 /root/autodl-fs/artifacts/projects/tool-<job_id>/output/final.mp4 做 2 倍插帧。
```

### `model_upscale_video`

放大视频分辨率。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `video_path` | 是 | - | 输入视频绝对路径 |
| `resolution` | 否 | `720` | 目标短边，必须是偶数 |
| `max_resolution` | 否 | `1280` | 最大长边，必须是偶数；`0` 表示不限制 |
| `batch_size` | 否 | `5` | 必须满足 `4n+1`，例如 `1`、`5`、`9` |

一句话示例：

```text
调用 model_upscale_video，把 /root/autodl-fs/artifacts/projects/tool-<job_id>/output/interpolated.mp4 超分，resolution 使用 720，max_resolution 使用 1280，batch_size 使用 5。
```

### `model_generate_video_audio`

为视频生成并合成同步环境音和拟音；不负责对白 TTS 或配乐生成。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `video_path` | 是 | - | 输入视频绝对路径 |
| `prompt` | 否 | - | 环境音和拟音描述 |
| `steps` | 否 | `25` | 生成步数，范围 `1` 至 `100` |
| `seed` | 否 | `42` | 随机种子 |

一句话示例：

```text
调用 model_generate_video_audio，为 /root/autodl-fs/artifacts/projects/tool-<job_id>/output/upscaled.mp4 添加雨声、脚步声和衣物摩擦声，steps 使用 25，seed 使用 42。
```

### `model_job_status`

查询已有任务的当前状态。状态可能是 `queued`、`running`、`succeeded` 或 `failed`。

| 参数 | 必填 | 说明 |
|---|---|---|
| `job_id` | 是 | 32 位任务 ID |

一句话示例：

```text
调用 model_job_status，查询任务 c97be71c64474c228fc0fe29c2ff7da8。
```

### `model_job_result`

取得成功任务的产物元数据，包括服务器路径、文件大小和 SHA-256。任务尚未成功时会返回错误。

| 参数 | 必填 | 说明 |
|---|---|---|
| `job_id` | 是 | 32 位任务 ID |

一句话示例：

```text
调用 model_job_result，取得任务 c97be71c64474c228fc0fe29c2ff7da8 的结果。
```

## 源码职责

- `src/functions/`：直接调用 `scripts/endpoint/` 的 Harness 工具，每个工具一个文件。
- `src/workflows/`：保留内部工作流执行器，不向 Harness 注册。
- `src/index.js`：插件身份、导出和注册。

## 安装

主配置为仓库根目录 `config/harness-settings.yaml`；系统提示词和对话指令分别读取同目录的 `system-prompt.yaml`、`harness-agent.md`。
`scripts/common/config_loader.py` 生成设置、profile、Agent preset 和项目指令。
执行仓库根目录的 `bash scripts/deploy_dsh_elysium_tools.sh` 会同步配置和启动链路，
在本地构建并上传产物，再于服务器目录执行 `scripts/common/install_dsh_elysium_tools.sh` 安装、重启与检查；启动前备份并完整覆盖配置，保留会话与项目数据。
新对话加载默认 Agent 和 `harness-agent.md` 内容，不扫描工作目录指令；已有对话不自动切换 Agent。

```sh
pnpm install
pnpm build
pnpm package:registry
dsh plugin --profile web add --workspace-root ./registry
```

## 调试输出

所有工具的文本结果展示实际 `input` 和 `output`。生成任务额外返回 `debug`：插件/工具名、原始与生效输入、执行命令、路由配置、provider、ComfyUI 提交与产物事件，以及日志和 trace 路径。查询工具读取已保存结果，不重新生成。

- `comfyui_prompt_id`：ComfyUI 原生任务 ID，与工具 `job_id` 不同。
- `comfyui_artifact_id`：由服务地址、prompt_id、输出节点/位置及文件信息计算的稳定 SHA-256 标识，不是 ComfyUI 原生字段。
- `comfyui_view_url`：原始产物 `/view` 地址，文件名和目录经过 URL 编码。
- `comfyui_artifacts`：工作流各阶段的产物及原始文件描述，包含 `url_scope`。
- 元数据缺失返回 null 和原因；本地混音成片没有 ComfyUI 原生产物，原始阶段产物仍在列表中。

访问地址默认使用实际 ComfyUI 地址。需要从浏览器访问时，在服务器启动环境设置 `COMFYUI_PUBLIC_URL`、`MINIMAX_H3_PUBLIC_URL` 为对应服务已配置的代理地址；不提供时 localhost 链接仅在服务器本机有效，不代表已开放公网。元数据同时保存在产物旁的 `.comfyui.json` 文件中；旧产物不会凭空补出 ID 或 URL。

### 诊断与验收

- `trace_id` 串联整个任务；工作流阶段用 `span_id` 区分，未创建独立子任务时 `parent_job_id` 为 null。
- `stage`、`failed_stage`、`timings` 展示准备、执行、产物检查及总耗时；`debug.stage_timings` 是各阶段已记录事件间的耗时，不等同于纯 GPU 推理耗时。
- `debug.resolved_config` 包含模型选择来源、配置/适配器哈希、生效参数与工作流哈希；`code_version` 返回插件版本和执行代码哈希。
- `debug.comfyui_status`、`debug.node_errors` 返回原始状态与失败节点；完整请求、响应、堆栈保存为文件，通过 `request_path`、`response_path`、`diagnostic_path` 读取。
- `media_info` 来自 ffprobe：宽高、实际宽高比、时长、帧率、编码与音轨信息。`FFPROBE_BIN` 可指定程序；缺少程序或探测失败时不会声称规格已验证。
- `validation` 分别报告文件存在、非空、媒体探测、尺寸匹配、完整解码和人工验收。完整解码及人工验收当前为 not_run；没有明确输出尺寸时不猜测规格匹配。
- `warnings` 明确元数据缺失、地址仅本机可用、探测失败或尺寸不符。`retryable` 为 null 表示尚不能判断；已有 prompt_id 时先查原任务，不自动整链重跑。

工具返回摘要；`debug.diagnostic_path` 保留完整诊断快照，`debug.media_probe_path` 保留探测结果。只记录任务参数，不输出进程的完整环境变量。
