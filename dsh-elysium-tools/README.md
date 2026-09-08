# dsh-elysium-tools

极乐世界 AI 成人短剧的 DeepSeek Harness Function Call 工具插件。配合标准模式的文件、检索、计划和工作流能力，提供角色与场景图片、视频、对白、声音及任务查询。预设和创作流程见 [Harness 说明](../docs/harness.md#极乐世界预设)。

生产调用链为 `Harness → workflow_generate_video → ComfyUI HTTP → C-MMH3-18 兼容 API 图`。工作流随插件打包，运行时不读取模型项目脚本。配置、恢复语义与适配边界见 [解耦说明](../docs/video-comfyui-decoupling.md)。

## 使用前说明

- 可以直接说“调用 `工具名`……”，也可以只描述目标，让 Harness 选择工具。
- 生产工具素材路径必须是 Harness 本机 `ARTIFACTS_ROOT` 内已有文件的绝对路径；插件通过 HTTP 上传到 ComfyUI，无需挂载远端目录。旧原子测试工具仍按各自共享路径要求执行。
- 工作流由独立进程执行，工具在程序内等待完成并返回 `job_id`、成片路径和验收结果；失败返回原因。等待中断不取消后台生产，用原任务 ID 查询或恢复，不重新提交。
- `seed` 相同不保证不同模型或工作流版本产生完全相同的结果。

## 生产工具

默认只注册 `workflow_generate_video`、`workflow_resume_video`、`model_job_status`、`model_job_result`。服务端显式设置 `ELYSIUM_ENABLE_ATOMIC_TOOLS=1` 时才额外注册下方原子与 ComfyUI 工具，仅供测试；模型不能通过工具参数打开该开关。

`workflow_generate_video` 必填目标总秒数 `duration`。多镜头优先提供有序 `shots`，每镜有唯一 `id`、整数秒 `duration`、完整 `prompt`（reuse除外），总时长严格求和。15秒三个镜头须保留三个5秒镜头，不能压成单镜头。`mode` 支持 `independent`（默认，文生或起始图）、`reference`（图/视频/音频参考）、`continue`（前镜裁剪后末帧续拍）、`reuse`（已有视频，可指定剪辑起点 `in_point`）。生成镜头每段1..15秒；素材分别用 `image_path`、`video_path`、`audio_path` 绑定到镜头。reference当前每类最多一个文件；声音参考不承诺口型准确。

`shots` 不能与旧参数混用。旧 `prompts` 兼容单镜头及明确的连续长镜头，长镜头另需 `image_path` 或 `image_prompt`。旧 `video_paths` 保留按序合片。H3原生24 fps生成，最终统一480×854、30 fps、H.264；异规格来源先转换后拼接，声音使用AAC、双声道并对齐镜头时长，无声镜头补静音。H3与Wan原子入口保持各自模型帧率，生产规划固定H3路径。

查询使用原 `job_id`。失败原因处理后，调用 `workflow_resume_video(job_id)` 复用原输入及 ComfyUI 提交记录；下载/验收失败不重生成，确认执行失败才重新提交，节点缓存复用取决于 ComfyUI 状态。原输入、参考素材内容或运行规格变化须创建新任务。返回的 `shots` 包含镜号、时长与素材路径；新任务可混用生成与reuse镜头，只重做人工未采用部分。缺少明确存活进程但仍有锁时报告需运维核对，不自动重提GPU任务。额外配音、混音、字幕、运动插帧和超分未自动加入生产；内容完全由人工审片，生成成功不等于作品通过。

## 原子测试工具

以下旧原子测试工具仍与 endpoint 一一对应；新的生产工作流不再调用这些入口。

| 工具 | Endpoint |
|---|---|
| `model_generate_image` | `generate_image.sh` |
| `model_generate_video` | `generate_video.sh` |
| `model_generate_video_long` | `generate_video_long.sh` |
| `model_concat_video` | `concat_video.sh`（已有 MP4 按顺序合片，CPU） |
| `model_generate_video_audio` | `generate_video_audio.sh` |
| `model_generate_dialogue` | `generate_dialogue.sh` |
| `model_interpolate_video` | `interpolate_video.sh` |
| `model_upscale_video` | `upscale_video.sh` |


### ComfyUI 任务管理

| 工具 | HTTP 接口 |
|---|---|
| `comfyui_task_queue` | `/queue` |
| `comfyui_task_status` | `/queue`、`/history/{prompt_id}` |
| `comfyui_task_result` | `/history/{prompt_id}` |
| `comfyui_task_cancel` | `/queue` 定向删除 |

必填 `server: production|minimax-h3`；除队列查询外，必填原生 `prompt_id`，不能传插件 `job_id`。地址读取 `COMFYUI_URL` 或 `MINIMAX_H3_COMFYUI_URL`。

取消仅针对排队任务；运行中的任务不会全局中断。产物返回派生 ID 与访问 URL，不代表媒体已验收。实例本机 URL 不保证客户端可访问。

生产链路只需更新工具插件并配置 ComfyUI 地址；旧原子测试工具仍依赖模型项目部署。

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

生成超过 15 秒的长视频，当前默认 MiniMax H3，以前段末帧续接下一段。总时长必须明确传入；默认保留原生帧率和音轨。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `image_path` | 是 | - | 起始图片绝对路径，使用本次图片工具返回值 |
| `prompts` | 是 | - | 至少 2 条连续分镜提示词，H3 不再限制最多 6 段 |
| `duration` | 否 | max(20, 段数×5) | 总秒数，必须超过 15；均分后每段 1..15 秒 |
| `preset` | 否 | `long_vertical_preview` | 竖版 preview/standard；横版 `long_fast`/`long_standard`，采样设置以服务器为准 |
| `seed` | 否 | `666` | 随机种子 |

一分钟示例：`duration: 60`，12 条提示词（每段 5 秒），或 6 条提示词（每段 10 秒）。更多片段受服务器任务超时和实际算力限制；产物时长、音画衔接需要验收。

### `model_generate_video`

原子合片测试可调用 `model_concat_video`；生产必须将已有片段交给 `workflow_generate_video`。合片保留原音轨，要求编码、画幅、帧率与音轨规格一致。发布与验收见 [Harness 文档](../docs/harness.md)。

对应 `generate_video.sh`，生成 1..15 秒短视频（包含 15 秒）。必填 `mode`、`prompt`；`duration` 默认 5 秒，`seed` 默认 666。

| mode | 作用 | 参考参数 |
|---|---|---|
| `text` | 文字生成视频 | 不接受参考素材 |
| `image` | 起始图片生成视频 | 必填 `image_path` |
| `reference` | 参考素材生成视频 | `image_path`、`video_path`、`audio_path` 至少一项 |

执行模型由 `routes.yaml` 决定；声音支持、尺寸及更严格的单段上限以执行模型为准。

### `model_generate_dialogue`

对应 `generate_dialogue.sh`。必填 `text`（对白文本），可选 `language`（默认 `zh`）、`seed`（默认 42），返回音频产物。

### `model_interpolate_video`

对视频插帧，提高帧率和运动流畅度。会使帧数翻倍；同时需要超分时排在 `model_upscale_video` 之后。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `video_path` | 是 | - | 输入视频绝对路径 |
| `multiplier` | 否 | `2` | 插帧倍数：`2`、`3` 或 `4` |

一句话示例：

```text
调用 model_interpolate_video，把 /root/autodl-fs/artifacts/projects/tool-<job_id>/output/upscaled.mp4 做 2 倍插帧。
```

### `model_upscale_video`

放大视频分辨率。耗时与输入帧数成正比；同时需要插帧时排在 `model_interpolate_video` 之前。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `video_path` | 是 | - | 输入视频绝对路径 |
| `resolution` | 否 | `720` | 目标短边，必须是偶数 |
| `max_resolution` | 否 | `1280` | 最大长边，必须是偶数；`0` 表示不限制 |
| `batch_size` | 否 | `21` | 必须满足 `4n+1`，例如 `1`、`5`、`21` |

一句话示例：

```text
调用 model_upscale_video，把 /root/autodl-fs/artifacts/projects/tool-<job_id>/output/combined.mp4 超分，resolution 使用 720，max_resolution 使用 1280。
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

- `src/functions/endpoint/`：生成与后处理工具，与 `scripts/endpoint/` 一一对应。
- `src/functions/jobs/`：插件任务状态、结果查询。
- `src/functions/comfyui/`：ComfyUI 队列、任务状态、结果和取消。
- `src/functions/common/`：任务执行、结果封装和诊断，不注册工具。
- `src/functions/index.js`：模型工具汇总与导出。
- `src/workflows/`：生产工具、后台任务、标准 ComfyUI 图编译与 HTTP 执行。
- `src/index.js`：插件身份、导出和注册。

## 安装

主配置为仓库根目录 `config/harness-settings.yaml`；系统提示词和对话指令分别读取同目录的 `system-prompt.yaml`、`harness-agent.md`。
`app/common/config_loader.py` 生成设置、profile、Agent preset 和项目指令。
执行仓库根目录的 `bash app/deploy_dsh_elysium_tools.sh` 会同步配置和启动链路，
部署入口在本地构建并上传产物，再自动调用服务器的 `app/common/install_plugin.sh tools` 安装、重启与检查；启动前备份并完整覆盖配置，保留会话与项目数据。
新对话加载默认 Agent 和 `harness-agent.md` 内容，项目指令发现沿用标准模式；已有对话不自动切换 Agent。

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

通用工具及其说明在极乐世界内通过 `elysium_load_tools` 按组加载，保留原注册和权限执行链，详见 [上下文说明](../docs/harness.md#上下文成本)。
