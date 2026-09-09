# dsh-elysium-tools

极乐世界 AI 成人短剧的 DeepSeek Harness Function Call 工具插件。配合标准模式的文件、检索、计划和工作流能力，提供角色与场景图片、视频及任务查询。预设和创作流程见 [Harness 说明](../docs/harness.md#极乐世界预设)。

生产调用链为 `Harness → workflow_generate_video → 自动选择 workflow_generate_video / workflow_director_video → ComfyUI HTTP`。工作流随插件打包，运行时不读取模型项目脚本。配置、恢复语义与适配边界见 [解耦说明](../docs/video-comfyui-decoupling.md)。

## 使用前说明

- 可以直接说“调用 `工具名`……”，也可以只描述目标，让 Harness 选择工具。
- 生产工具素材路径必须是 Harness 本机 `artifactsRoot` 内已有文件的绝对路径；插件通过 HTTP 上传到 ComfyUI，无需挂载远端目录。
- 工作流由独立进程执行，工具在程序内等待完成并返回 `job_id`、成片路径和验收结果；失败返回原因。等待中断不取消后台生产，用原任务 ID 查询或恢复，不重新提交。
- `seed` 相同不保证不同模型或工作流版本产生完全相同的结果。

## 生产工具

默认注册 `workflow_generate_video`、`workflow_resume_video`、`model_generate_image`、`model_concat_video`、`model_job_resume`、`model_job_status`、`model_job_result` 及按需发现工具 `elysium_load_tools`。插件设置 `enableAtomicTools: true`（兼容 `ELYSIUM_ENABLE_ATOMIC_TOOLS=1`）时额外注册兼容视频入口和 ComfyUI 任务工具，仅供测试；模型不能通过工具参数打开该开关。

`workflow_generate_video` 必填目标总秒数 `duration`。多镜头优先提供有序 `shots`，每镜有唯一 `id`、整数秒 `duration`、完整 `prompt`（reuse除外），总时长严格求和。15秒三个镜头须保留三个5秒镜头，不能压成单镜头。`mode` 支持 `independent`（默认，文生或起始图）、`reference`（图/视频/音频参考）、`continue`（前镜裁剪后末帧续拍）、`reuse`（已有视频，可指定剪辑起点 `in_point`）。生成镜头每段1..15秒；素材分别用 `image_path`、`video_path`、`audio_path` 绑定到镜头。reference当前每类最多一个文件；声音参考不承诺口型准确。

`shots` 不能与旧参数混用。旧 `prompts` 兼容单镜头及明确的连续长镜头，长镜头另需 `image_path` 或 `image_prompt`。旧 `video_paths` 保留按序合片。H3原生24 fps生成，最终统一480×854、30 fps、H.264；异规格来源先转换后拼接，声音使用AAC、双声道并对齐镜头时长，无声镜头补静音。H3与Wan原子入口保持各自模型帧率，生产规划固定H3路径。

查询使用原 `job_id`。失败原因处理后，调用 `workflow_resume_video(job_id)` 复用原输入及 ComfyUI 提交记录；下载/验收失败不重生成，确认执行失败才重新提交，节点缓存复用取决于 ComfyUI 状态。原输入、参考素材内容或运行规格变化须创建新任务。返回的 `shots` 包含镜号、时长与素材路径；新任务可混用生成与reuse镜头，只重做人工未采用部分。缺少明确存活进程但仍有锁时报告需运维核对，不自动重提GPU任务。内容完全由人工审片，生成成功不等于作品通过。

## 原子测试工具

以下图片、视频与合片工具均通过 ComfyUI 工作流执行。

| 工具 | 执行路径 |
|---|---|
| `model_generate_image` | ComfyUI 图片工作流 |
| `model_generate_video` | ComfyUI 视频工作流 |
| `model_generate_video_long` | ComfyUI 导演工作流 |
| `model_concat_video` | ComfyUI 合片工作流 |


### ComfyUI 任务管理

| 工具 | HTTP 接口 |
|---|---|
| `comfyui_task_queue` | `/queue` |
| `comfyui_task_status` | `/queue`、`/history/{prompt_id}` |
| `comfyui_task_result` | `/history/{prompt_id}` |
| `comfyui_task_cancel` | `/queue` 定向删除 |

必填 `server: minimax-h3`；除队列查询外，必填原生 `prompt_id`，不能传插件 `job_id`。地址必须由插件配置 `comfyUrl` 提供（兼容 `MINIMAX_H3_COMFYUI_URL`）；缺失或非法时直接报错。

取消仅针对排队任务；运行中的任务不会全局中断。产物返回派生 ID 与访问 URL，不代表媒体已验收。实例本机 URL 不保证客户端可访问。

生产链路使用工具插件与 ComfyUI 工作流，不依赖模型项目 Shell 入口。

### `model_generate_image`

根据文字生成图片。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `prompt` | 是 | - | 画面描述 |
| `preset` | 否 | `standard` | 仅 `standard`，`fast` 已移除 |
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

已有片段合片调用 `model_concat_video`；导演工作流已返回成片时无需重复合片。合片保留原音轨，要求编码、画幅、帧率与音轨规格一致。发布与验收见 [Harness 文档](../docs/harness.md)。

对应 ComfyUI 视频工作流，生成 1..15 秒短视频（包含 15 秒）。必填 `mode`、`prompt`；`duration` 默认 5 秒，`seed` 默认 666。

| mode | 作用 | 参考参数 |
|---|---|---|
| `text` | 文字生成视频 | 不接受参考素材 |
| `image` | 起始图片生成视频 | 必填 `image_path` |
| `reference` | 参考素材生成视频 | `image_path`、`video_path`、`audio_path` 至少一项 |

执行模型由 `routes.yaml` 决定；声音支持、尺寸及更严格的单段上限以执行模型为准。

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

- `src/index.js`、`tool-discovery.js`：插件注册与会话工具发现。
- `src/functions/endpoint/`、`functions/jobs/`：工具参数适配、状态和结果查询入口。
- `src/functions/comfyui/`：HTTP 客户端及原生队列、状态、结果、取消工具。
- `src/functions/common/`：工具结果渲染、文件哈希和诊断；`task.js` 保留兼容导出。
- `src/jobs/`：任务创建、会话绑定、启动锁、提交记录、等待、状态读取和旧产物兼容。
- `src/workflows/*-plan.js`：业务输入校验；`*-graph.js` 与 `video-workflow.js`：执行图与可视化图。
- `src/workflows/comfy-execution.js`：公共快照恢复、提交与等待；`video-execution.js`、`media-execution.js`：业务编排。
- `src/media/probe.js`、`src/workflows/*-artifacts.js`、`video-validation.js`：素材探测、下载及产物验收。
- `src/http/media-jobs.js`：会话绑定后的状态、预览和下载路由。

完整调用路径、外部节点边界及重构验证见 [执行链路](../docs/tools-execution-chain.md)。

## 独立安装配置

插件通过 Cordis 的 `apply(ctx, config)` 接收配置，`src/config.js` 定义默认值与校验。包内 `cordis.patch.yml` 注册空配置；请在安装机器的 `$DSH_HOME/profiles/web/cordis.patch.yml`（默认 `~/.dsh/profiles/web/cordis.patch.yml`）按相同 id 覆盖：

```yaml
- id: dsh-elysium-tools
  config:
    comfyUrl: http://127.0.0.1:6016
    publicUrl: http://127.0.0.1:6016
    # 可选，本机绝对路径，不使用 ~。
    # artifactsRoot: /Users/your-name/.dsh/elysium/artifacts
    # stateRoot: /Users/your-name/.dsh/elysium/tasks
    python: python3
    ffmpeg: ffmpeg
    ffprobe: ffprobe
    enableAtomicTools: false
```

`comfyUrl` 是 Harness 可达的 ComfyUI HTTP 地址，`publicUrl` 是浏览器可达的地址，须分别填写。示例需要本机 ComfyUI 或已有隧道；远端服务填写实际可达地址，插件不建立 SSH 隧道。

`artifactsRoot`、`stateRoot` 默认位于 `$DSH_HOME/elysium/artifacts`、`$DSH_HOME/elysium/tasks`，DSH_HOME 未设置则使用 `~/.dsh`。首次调用自动创建目录；输入素材放在 artifactsRoot 下。恢复旧任务保持原目录和后端地址。

本机需要 Node.js、Python 3、FFmpeg、FFprobe；程序配置可以是命令名或绝对路径。`legacyOutputRoot` 仅用于历史非 HTTP 视频任务，新任务不需要服务器目录挂载。

优先级为插件显式配置 → 旧环境变量 → 本机目录／程序默认值。地址没有默认值，显式空值或非法值报错。环境变量兼容 `MINIMAX_H3_COMFYUI_URL`、`MINIMAX_H3_COMFYUI_PUBLIC_URL`、`ARTIFACTS_ROOT`、`ELYSIUM_TOOLS_STATE_ROOT`、`MINIMAX_H3_COMFYUI_OUTPUT_ROOT`、`HARNESS_PYTHON`、`FFMPEG_BIN`、`FFPROBE_BIN` 与 `ELYSIUM_ENABLE_ATOMIC_TOOLS`。

修改配置后重新加载插件或重启 Harness；已启动 worker 保持原配置。插件不修改宿主全局环境变量。工具可独立调用；会话媒体卡片需配套安装 `dsh-elysium-ui`，安装包自带 Elysium preset、人格、指令和创作技能；默认模型和权限仍由 Harness 管理。

源码发布时按授权执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm package:registry
dsh plugin --profile web add --workspace-root ./registry
```

安装并重新加载 Harness 后，在新会话中选择“极乐世界”即可使用包内人格、协作指令和 `creation-video`／`creation-drama` 技能；不需要复制仓库 `app/config/`、`.dsh/` 或修改全局 AGENTS.md。插件不强制切换现有会话或宿主默认模型。需要默认使用 Elysium 时，在 Harness 设置中选择它为默认 Agent preset。

包内 `presets/elysium/agent.cordis.yml` 只声明人格和技能目录两处差异；`standard.mjs` 在运行时读取宿主 standard，通过原生分组加载工具，不复制标准工具配置、不写回宿主预设，用户定制建议在 Harness 中复制成另一个 preset。若安装机器自行覆盖 `agent-presets.config.roots`，需保留包提供的 preset 根目录。

Node.js 最低 20.16，包路径解析使用其 `process.getBuiltinModule`。完整交付包必须包含 `presets/`，registry 打包脚本已包含该目录。

## 服务器部署

`app/config/harness-settings.yaml` 仅是这套部署的配置来源。部署器只生成宿主 settings 与 profile 的 `dsh-elysium-tools.config`，不生成 Elysium preset、全局 AGENTS.md 或 persona；独立安装不需要这些脚本。部署仍按授权完成安装、配置覆盖和重启。

## 调试输出

工具默认返回交付或失败摘要，完整调试信息按 `renderToolDebug` 的调试开关展示。`path` 是 Harness 本机可复用素材路径；`comfyui_view_url` 是原始输出的浏览器访问地址。

- `job_id`：插件任务 ID；`comfyui_prompt_id`：ComfyUI 原生任务 ID，两者不能混用。
- `comfyui_artifact_id`：视频成片按服务地址、prompt_id、最终节点和文件描述计算的 SHA-256；不是 ComfyUI 原生字段，图片和合片不保证提供。
- `comfyui_artifacts`：原始文件描述；视频成片额外保留服务地址、浏览地址和本地路径，逐镜结果在 `shots` 中。
- `stage`、`failed_stage`：插件准备、提交、排队、执行或产物验收阶段；不等同于单个节点或纯 GPU 推理耗时。
- `media_info` 来自 FFprobe；成功结果的 `validation.full_decode`、`specification_match` 为 `passed`，`human_review` 仍为 `not_run`。

内部 API 与浏览器地址分别使用插件配置 `comfyUrl`、`publicUrl`，不互相回退。任务目录保存工作流快照、提交记录、ComfyUI 历史和媒体探测报告；视频另存 `diagnostics.json`、`execution.log` 及成片旁的 `.validation.json`。当前 HTTP 链路不生成 `.comfyui.json` 旁文件，旧产物兼容逻辑独立保留。

恢复先查询原任务；提交结果不明时停止，下载或验收失败不重复推理。错误与诊断字段以任务实际保存内容为准，不承诺尚未采集的节点级耗时或推理质量。

通用工具及其说明在极乐世界内通过 `elysium_load_tools` 按组加载，保留原注册和权限执行链，详见 [上下文说明](../docs/harness.md#上下文成本)。

图片工具支持可选 `image_path` 人物参考图；图片与合片默认可见，直接提交可视化 ComfyUI 工作流。`model_job_resume` 按原 job_id 恢复图片、视频和合片任务；导演工作流已输出成片时无需再次合片。图片默认 standard（832×1216、30 步），会话卡片支持预览与下载。
