# 单机 AI 成人短剧创作工具：事实基线、目标架构与完整执行流程

> 文档状态：可执行架构基线，供实现、迁移与架构审核使用  
> 基线日期：2026-10-02  
> 适用仓库：`llm-dsh-plugins`  
> 核心插件：`dsh-short-video-studio`  
> 部署形态：单用户、单机 Harness、单机 GPU、一个本地或受信任局域网 ComfyUI  
> 非目标：多租户 SaaS、分布式 GPU 集群、Kubernetes、Temporal、Kafka、PostgreSQL、MinIO/S3、企业级 RBAC

## 1. 文档目的

本文是本项目后续重构的独立架构基线。它同时回答四类问题：

1. 当前系统实际有哪些组件、模型、工具、工作流和数据路径。
2. 单机个人创作场景下，哪些 Harness 能力直接复用，哪些短剧能力由插件负责。
3. 从用户输入一句创作需求，到图片、视频、音频、审核、拼接和交付，数据如何流动。
4. 如何在不引入分布式基础设施的前提下，补齐项目状态、幂等、恢复、血缘和成人内容治理。

本文是架构真相，不是产品宣传。每项内容都标记为以下三种状态之一：

- **当前已实现**：仓库中已有执行代码或工作流。
- **目标重构**：本轮架构要求，但尚未完成。
- **明确不做**：不符合单机产品边界。

“已确认”仅表示已由仓库代码、已安装包或用户配置证明；涉及正在运行的模型端点、ComfyUI 节点和模型文件时，还必须经过运行时探测，不能用 manifest 存在代替可运行。

## 2. 已确认的产品边界

### 2.1 用户与运行环境

- 一个创作者在自己的电脑上使用 DeepSeek Harness。
- Harness 提供会话、Agent、Skill、工具调用、人工选择卡、画布插槽和最终交付入口。
- GPU 生成任务全部在单机执行，不调度到集群。
- 不建设租户系统、组织系统、计费平台或公共云服务。
- 不要求多人同时编辑同一个项目。
- 项目可以跨 Harness 会话继续，但不要求跨设备实时同步。

### 2.2 模型与执行路径

| 能力 | 当前目标实现 | 调用边界 |
| --- | --- | --- |
| 聊天、规划、结构化文本 | Qwen3.8 | Harness 通过 OpenAI 兼容接口调用聊天网关 |
| 文生图、图生图 | Qwen-Image 2.1 | 插件编译本地 workflow，直接调用 ComfyUI HTTP API |
| 参考图生视频 | MiniMax H3 Ref2VA | 插件直接调用 ComfyUI workflow |
| 首帧/首末帧生视频 | MiniMax H3 I2VA/FL2VA | 插件直接调用 ComfyUI workflow |
| 视频语音、对白、环境声 | MiniMax H3 原生音视频能力 | 与视频在同一次 H3 workflow 中生成 |
| 独立 TTS（备用） | edge-tts / GPT-SoVITS（本地） | 当 H3 音轨质量不足或需要精细对白控制时启用 |
| 独立 BGM（备用） | MusicGen / 本地音频素材库 | 当 H3 背景音乐不满足创意需求时启用 |
| VLM 视觉自检 | Qwen3-VL（或同系列 VL 模型） | 聊天网关 OpenAI 兼容接口（multimodal chat），传入生成帧 + 结构化 prompt；不可用时降级为元数据启发式检查 |
| 抽帧、超分、拼接 | ComfyUI workflow；拼接可优先使用本机 FFmpeg | 插件本地执行 |

聊天网关与媒体生成是两条独立路径：

```text
聊天路径
Harness Agent
  → OpenAI-compatible endpoint
  → 聊天网关
  → Qwen3.8

媒体路径
Harness Agent
  → dsh-short-video-studio tool
  → 本地 workflow registry
  → 编译 ComfyUI graph
  → ComfyUI HTTP API
  → Qwen-Image 2.1 / MiniMax H3 / 媒体节点
```

媒体请求不经过聊天网关。`lib/gateway.js` 当前没有进入 `lib/index.js` 主执行路径，属于需要审计后删除或明确隔离的兼容代码；不得把它重新定义为媒体主路径。

### 2.3 “成人短剧”的含义与硬边界

本文的“成人短剧”指面向成年观众的剧情内容。项目域必须保存内容分级、来源和授权信息，但本文不把内容安全委托给 prompt 自觉。

硬性要求：

- 所有涉及性或亲密内容的角色必须明确为成年人。
- 真人肖像、真人参考图、声音克隆和品牌素材必须有来源与授权记录。
- 未成年人或年龄不明角色不得进入成人内容生产链。
- 生成前、交付前分别执行一次结构化安全检查。
- 审核决定、修改人和时间必须留下本地记录。

## 3. 为什么不采用分布式生产平台架构

本工具的瓶颈是单机 GPU 生成速度，而不是服务间吞吐。引入 Temporal、Kafka、PostgreSQL、MinIO、Keycloak、OPA 或 Kubernetes 会新增部署、备份、升级、网络、鉴权和故障面，却不能提高单张图片或单段视频的生成质量。

单机架构采用以下等价机制：

| 分布式平台常用组件 | 单机替代方案 |
| --- | --- |
| Temporal | 项目领域状态机 + 持久 GenerationAttempt + 恢复扫描 |
| Kafka/NATS | 同进程领域事件 + 持久 outbox；当前只需要单消费者 |
| PostgreSQL | Harness Domain Storage 的单 Project 聚合记录 |
| S3/MinIO | 宿主定位的本地 File Service |
| Redis | 进程内短期缓存；任何可恢复状态不得只放缓存 |
| Keycloak/OPA | 本机用户信任边界 + 插件 token + 领域安全规则 |
| Grafana/Loki/Jaeger | 本地结构化事件日志 + 项目诊断读模型 |

如果未来变为多用户或分布式产品，应在 Repository、FileService、AttemptRunner、EventSink 等接口后替换实现，不修改领域实体和 Skill 流程。

## 4. 总体架构

```text
┌────────────────────────────────────────────────────────────┐
│ DeepSeek Harness                                          │
│ 会话 · Agent Loop · Qwen3.8 · Skill · Todo/Goal/Plan      │
│ Ask User / Approval · Tool Registry · UI Slots · Delivery │
└──────────────────────────┬─────────────────────────────────┘
                           │ 结构化工具调用
┌──────────────────────────▼─────────────────────────────────┐
│ dsh-short-video-studio 宿主插件                            │
│                                                          │
│  Studio Project Domain                                   │
│  Project · StoryBible · Character · Scene · Shot          │
│  GenerationAttempt · Asset · Review · Timeline            │
│                                                          │
│  Local Capability Registry                               │
│  workflow manifest · schema · tier · constraints          │
│                                                          │
│  Execution Services                                      │
│  ComfyClient · RenderService · MediaService · FileService │
└───────────────┬───────────────────┬────────────────────────┘
                │                   │
       ┌────────▼────────┐  ┌──────▼─────────────────┐
       │ ComfyUI :8188   │  │ 本地项目文件与画布     │
       │ Qwen-Image 2.1  │  │ media / export / cache │
       │ MiniMax H3      │  │ project read models    │
       │ upscale/extract │  │ assets / lineage       │
       └─────────────────┘  └────────────────────────┘
```

横切约束：

- 所有业务写入经过领域命令。
- 所有媒体写入经过 File Service。
- 所有生成任务先创建 Attempt，再提交 ComfyUI。
- 所有人工选择通过 Harness 交互收集，但决定写回 Project Domain。
- 所有 UI 只读取 read model，不直接修改 JSON 文件。

## 5. Harness 与插件的职责分离

### 5.1 Harness 负责

- Qwen3.8 对话调用和 Agent Loop。
- Skill 发现、加载和上下文管理。
- Todo、Goal、Plan 等当前会话决策辅助。
- ToolDefinition 注册与参数校验入口。
- `ask_user_question`、Approval 等人机交互。
- 会话 UI、设置页、右侧栏和视图 tab 插槽。
- 普通附件和最终 Deliverables 展示。
- 长上下文压缩和工具结果 spill。

Harness 中的 Todo、Goal、Plan 和聊天记录不是短剧 Project 的权威状态。

### 5.2 插件负责

- 短剧领域实体和不变量。
- 制片阶段、审核状态和失效传播。
- workflow manifest 注册、校验和图编译。
- ComfyUI 上传、提交、轮询、下载。
- 画布 read model 和媒体预览。
- 跨会话资产库。
- 镜头连续性、参考绑定和生成血缘。
- 本地恢复、拼接、超分和交付清单。
- 成人内容的年龄、来源、授权和交付安全门。

### 5.3 Skill 负责

- 如何从创意推进到成片的制片知识。
- 何时确认画幅、时长、音频模式、档位和交付画质。
- 角色卡、场景卡、镜头表和分镜的写作规范。
- 逐镜生成、逐镜审核和失败回退策略。
- prompt 组织规则。

Skill 不直接拥有 Project 状态，不应通过聊天文本猜测当前批准版本。

### 5.4 Harness 实际能力契约、限制与 fallback

以下基线来自本机全局安装的 DeepSeek Harness，核验日期为 `2026-10-02`。所有相关包当前均为 `0.1.2-rc.1`；升级 Harness 后必须重新运行契约测试，不能默认 RC 版本 API 稳定。

| 能力 | 已核实的实际入口 | 本项目用法 | 已知限制 | 本地 fallback |
| --- | --- | --- | --- | --- |
| Domain Storage | `@deepseek-ai/dsh-storage-domain`：`defineDomain`、`domainTable`、`ctx.storageDomain.open(spec)`；表句柄提供 `get/entries/update/delete` | 一个 `short-video-studio` domain，以 `projectId` 为表 key，Project 为聚合 value | 同一 facility 内同名 domain 只能打开一次；后端路由缺失会显式失败；串行语义只覆盖当前进程 | 启动失败即只读，不退回散落 JSON 写入；提供显式 JSON 导出/恢复命令 |
| JSON 后端 | `@deepseek-ai/dsh-storage-json` 经 `@deepseek-ai/dsh-storage` 注册 | 作为单机 Domain Storage 后端 | 不是数据库、无跨进程事务、不能承担二进制媒体 | 项目级单写者租约 + revision CAS；媒体由 File Service 管理 |
| Tool Registry | `@deepseek-ai/dsh-tools`：`defineTool`；`ctx.tools.register/get/execute`；插件实际注入 `tools` | 注册兼容工具和领域工具；参数由 schema 校验 | Tool 调用不是业务事务；工具成功不代表 Project 已提交 | 工具执行器只调用领域命令，返回 `projectRevision/attemptId/assetId` |
| Ask User | `@deepseek-ai/dsh-tool-ask-user` 注册 `ask_user_question` | 收集规格确认、重试选择和审核意见 | 交互结果是会话消息，不是领域记录 | 回答必须转换为命令并落 `ReviewDecision`；中断时 ReviewTask 保持待决 |
| Approval | `@deepseek-ai/dsh-user-approval` 的 `ApprovalService` | 只用于有副作用动作的交互门 | 同进程；要求当前 session 有打开的 turn；无 answerer 时 fail-closed；仅有 `ask/never` 策略 | 不把 Approval 当业务状态；失败或不可用时创建 `awaiting_human` ReviewTask，在 Studio 审核队列完成 |
| UI Slots | 客户端注入 `slots`，实际使用 `conversation.view`、`sidebar.right.pane.tab`、`conversation.input.*`、`settings.section` | 挂载画布、生成条和设置 | 右侧栏能力为软注入，宿主未安装时不会执行回调 | 优先 conversation tab；两处均不可用时保留 HTTP 页面与工具能力 |
| Skill | `@deepseek-ai/dsh-skill` + `@deepseek-ai/dsh-tool-skill` | 加载制片流程知识 | Skill 只影响 Agent 上下文，不是持久工作流 | 每一步由 Project 状态机、命令前置条件和恢复扫描保证 |
| Deliverables | `@deepseek-ai/dsh-client-ui-deliverables` 当前公开入口主要注册文件引用渲染指引 | 展示最终文件引用 | 它不是短剧 Deliverable Registry，不保存版本、hash 或状态 | 插件自己的 `Deliverable` 实体是权威记录；Harness 仅负责展示/发送 |
| Workspace | 插件实际注入 `workspaceRegistry`，使用 `get/list` 解析会话工作区 | 定位项目根和资产根 | 会话可能无法唯一匹配 workspace | 不能写入时要求用户显式选择项目根；不得回退历史固定目录 |

当前插件服务端实际注入 `webServer/tools/systemPrompt/workspaceRegistry`，客户端注入 `slots`。目标实现新增 `storageDomain` 依赖后，启动时必须输出 capability audit；必需能力缺失时进入只读或明确降级，禁止悄悄换数据源。

## 6. 当前插件组成

### 6.1 Node 宿主半

| 文件 | 职责 |
| --- | --- |
| `lib/index.js` | 插件 `apply()`、配置、ComfyUI 客户端、渲染编排、HTTP 路由、工具注册、画布读写和 Skill 安装 |
| `lib/manifest.js` | capability 词汇、manifest 校验、资产解析、参数注入和 graph 编译 |
| `lib/convert.js` | 将 ComfyUI API 导出 JSON 转换为 workflow manifest 草稿 |
| `lib/assets.js` | 跨会话角色/场景/风格/片段/文本资产库 |
| `lib/concat.js` | FFmpeg 拼接和 ComfyUI 拼接图 |
| `lib/pdf.js` | 文本交付物的 HTML/PDF 导出 |
| `lib/gateway.js` | 未进入媒体主路径的兼容客户端；目标架构不依赖 |

### 6.2 浏览器客户端

| 文件 | 职责 |
| --- | --- |
| `lib/client.js` | 注册画布 tab 或右侧栏、ComfyUI 设置区和输入框生成条 |
| `studio/index.html` | 自包含画布页面入口 |
| `studio/app.js` | 节点渲染、编辑、重做、替换、废弃、恢复、排序、分组和资产操作 |
| `studio/app.css` | 画布主题和响应式布局 |

### 6.3 数据与生产知识

| 目录 | 职责 |
| --- | --- |
| `workflows/` | 当前本地 workflow manifests；仓库基线为 63 份 |
| `schemas/workflow-manifest.schema.json` | workflow manifest 外部 JSON Schema |
| `skills/3d-animation-short-generator/` | 完整 3D 短剧生产流程 |
| `skills/h3-prompt-writing/` | MiniMax H3 prompt 结构和字幕唯一规则 |
| `skills/image-generate/` | 单次图片生成流程 |
| `skills/video-generate/` | 单次视频生成流程 |
| `scripts/` | smoke、e2e、probe、benchmark、preview 与模板生成脚本 |

## 7. 本地 Capability Registry

单机版不建设独立注册中心服务。`workflows/*.json`、`lib/manifest.js` 和用户导入目录共同组成 Local Capability Registry。

### 7.1 三层契约

1. **任务契约**：Agent 只表达 capability、tier 和语义参数。
2. **能力契约**：定义某能力接受哪些输入、输出什么媒体、有哪些约束。
3. **workflow 绑定契约**：把语义参数映射到一张具体 ComfyUI graph。

Agent 不直接传 workflow id。实现选择由配置中的 tier/preferred 规则决定。

### 7.2 当前能力词汇

- `image.text2image`
- `image.image2image`
- `video.reference2video`
- `video.image2video`
- `video.upscale`
- `image.from_video`
- `audio.tts`
- `audio.bgm`
- 视频拼接由 `video_concat` 服务处理

### 7.3 Manifest 最低字段

```text
id
version
capability
group
tier
priority
graph
params
assets
requiresNodes
constraints
note
estSeconds
```

目标重构允许在不破坏现有 manifest 的前提下增加：

```text
outputKinds
supportsCancellation
supportsContinuity
maxReferences
durationRange
resolutionRange
audioMode
deterministic
sideEffects
license
verifiedAt
benchmark
```

这些字段属于本地数据契约，不需要 MCP、OpenAPI 或远程注册服务。

### 7.4 目标模型映射

- Qwen-Image 2.1 manifests 作为 `image.text2image` 与 `image.image2image` 的首选实现。
- MiniMax H3 Ref2VA manifests 作为 `video.reference2video` 的实现。
- MiniMax H3 I2VA/FL2VA manifests 作为 `video.image2video` 的实现。
- `fast`、`balanced`、`quality` 是面向用户的产品档位；模型文件名和节点实现不暴露给 Skill。
- FLUX 等已有 manifests 可以继续保留为候选，但不作为本产品第一条生产链路的默认实现。

### 7.5 模型与工作流验证状态

`configured`、`manifest_verified` 和 `runtime_verified` 必须分开记录。`verifiedAt` 只说明验证发生时间，不能在模型、节点、endpoint 或 manifest hash 改变后沿用。

| 能力 | 当前证据 | 截至 2026-10-02 的状态 | 进入生产链前还要验证 |
| --- | --- | --- | --- |
| Qwen3.8 聊天 | 用户确认目标模型和 OpenAI 兼容网关路径 | `configured`；运行时 model id **未确认** | `GET /v1/models` 或等价探测、一次结构化输出、流式/非流式、超时和上下文上限 |
| Qwen-Image 2.1 | 仓库存在 t2i/i2i manifests，声明 Qwen-Image 2.1 UNet/CLIP/VAE | `manifest_verified`；活动 ComfyUI 文件和节点 **未确认** | `/object_info`、模型文件清单、最小图执行、输出解码、manifest hash |
| MiniMax H3 | 仓库存在 Ref2VA/I2VA/FL2VA manifests，声明 H3 视频/音频 VAE、Qwen3-VL CLIP 和所需自定义节点 | `manifest_verified`；活动 ComfyUI 文件和节点 **未确认** | 所有 `requiresNodes`、模型文件、音视频输出、时长/分辨率边界和显存实测 |

目标脚本 `scripts/audit-local-stack.mjs` 生成机器可读报告，至少包含：

```text
schemaVersion
verifiedAt
chat.endpointFingerprint
chat.modelIds
comfy.baseUrlFingerprint
comfy.version
comfy.objectInfoHash
workflows[].manifestHash
workflows[].requiredNodes
workflows[].requiredAssets
workflows[].runtimeStatus
```

报告不得写入 API key、Authorization header 或完整敏感 prompt。Registry 只选择 `runtime_verified` 的默认 workflow；未验证项可显示但不能自动进入生产链。

### 7.6 运行时健康快照

生产流程运行期间，每隔 N 次生成（默认 10 次）或固定时间间隔（默认 30 分钟）执行一次轻量健康快照：

```text
healthSnapshot:
  timestamp
  chat.reachable          # Qwen3.8 endpoint 可达
  chat.modelIdMatch       # 返回 model id 与预期一致
  comfy.reachable         # ComfyUI HTTP API 可达
  comfy.objectInfoHash    # 与上次验证一致则为 unchanged
  comfy.queueLength       # 当前队列长度
  gpu.memFreePercent      # 可用显存百分比
  disk.freeBytes          # 项目磁盘可用空间
  lastAttemptLatency      # 最近一次 Attempt 耗时
```

健康快照写入项目诊断读模型，不进入 Project 聚合写链。任一关键指标异常时暂停自动生成并通知用户，不静默继续产出可能损坏的结果。

## 8. Agent 工具面

当前插件注册 16 个工具。

### 8.1 生成与媒体工具

| 工具 | 职责 |
| --- | --- |
| `comfy_list_workflows` | 查询能力、档位、约束和可用性 |
| `comfy_render` | 通用 capability 渲染入口 |
| `comfy_generate_image` | `image.text2image` 的薄入口 |
| `comfy_generate_video` | r2v/i2v 视频生成薄入口 |
| `extract_frame` | 从画布视频抽取指定帧 |
| `video_upscale` | 对画布视频执行 ×2/×4 后处理超分 |
| `video_concat` | 按节点顺序拼接视频片段 |

### 8.2 画布工具

| 工具 | 职责 |
| --- | --- |
| `canvas_list_nodes` | 列出当前项目节点摘要 |
| `canvas_get_node` | 获取一个节点完整内容和参数 |
| `canvas_write_node` | 写入 text/table 等耐用产物 |
| `canvas_group_nodes` | 归组并设置清晰标题 |
| `canvas_reorder` | 调整当前展示顺序 |
| `canvas_get_state` | 读取画幅、时长、模式和分组顺序 |
| `canvas_set_state` | 持久化生产规格 |

### 8.3 资产工具

| 工具 | 职责 |
| --- | --- |
| `asset_list` | 查询跨会话资产 |
| `asset_to_canvas` | 把已登记资产物化到当前画布 |

目标重构后，工具名可保持兼容，但内部写操作必须转成领域命令。

### 8.4 目标领域工具面

现有 16 个工具保留为兼容/媒体工具，但不足以让 Agent 稳定操作短剧项目。新增工具按领域聚合注册；任何写工具都要求 `projectId + commandId + expectedRevision`，任何成功响应都返回新 `projectRevision`。Agent 不得直接指定状态字符串或修改底层 JSON。

| 工具 | 类型 | 最小输入 | 主要输出/副作用 |
| --- | --- | --- | --- |
| `studio_project_create` | 写 | title、productionSpec | 创建 Project 和项目根 |
| `studio_project_get` | 读 | projectId、projection | Project/画布/诊断 read model |
| `studio_project_update_spec` | 写 | revision、规格 patch | 校验并更新画幅、时长、内容分级等 |
| `studio_story_bible_write` | 写 | revision、结构化 story bible | 更新故事圣经并触发精确失效 |
| `studio_character_upsert` | 写 | revision、Character/CharacterState | 写角色及阶段状态；成人字段不可由 prompt 隐式推断 |
| `studio_location_upsert` | 写 | revision、Location | 写场景设定和参考资产 |
| `studio_episode_upsert` | 写 | revision、Episode | 创建/修改集并由命令推导合法状态 |
| `studio_shot_upsert` | 写 | revision、七列镜头字段 | 创建/修改镜头，返回失效集合 |
| `studio_shot_list` | 读 | projectId、episodeId、filter | 镜头队列和阻塞原因 |
| `studio_shotlist_validate` | 读 | projectId、episodeId | 连续性、时长、引用、权利和安全问题 |
| `studio_attempt_list` | 读 | projectId、shotId/status | Attempt 历史与恢复诊断 |
| `studio_attempt_cancel` | 写 | revision、attemptId | 进入 cancelling；执行器异步确认终态 |
| `studio_attempt_recover` | 写 | revision、attemptId、decision | 对 unknown/中断任务执行显式恢复 |
| `studio_review_queue` | 读 | projectId、filter | 待人工审核项及候选资产 |
| `studio_review_decide` | 写 | revision、reviewTaskId、decision、reason | 持久 ReviewDecision，驱动业务状态 |
| `studio_timeline_assemble` | 写 | revision、episodeId、approvedAssetIds | 创建不可变 Timeline revision |
| `studio_timeline_get` | 读 | projectId、timelineId/revision | 返回时间线和缺口 |
| `studio_deliverable_export` | 写 | revision、timelineRevision、preset | 创建导出任务和 Deliverable |
| `studio_deliverable_get` | 读 | projectId、deliverableId | 状态、hash、质量报告和文件引用 |
| `studio_rights_record` | 写 | revision、subject、scope、evidence | 写 RightsRecord，敏感证据只保存受控引用/hash |
| `studio_rights_list` | 读 | projectId、status/subject | 返回权利覆盖与缺口，不回显敏感原件 |

`comfy_generate_*` 在目标架构中不再直接产生“已批准画布节点”：它们内部先执行 `createGenerationAttempt`，再调用执行器，最终只登记候选 Asset。Review、Timeline、Deliverable 和 Rights 都必须通过上述领域工具操作。

## 9. ComfyUI 直接执行链路

### 9.1 配置

插件当前读取：

- `baseUrl`，默认 `http://localhost:8188`。
- `apiKey`，可选；存在时发送 Bearer token。
- `pollMs`，默认 2000 ms。
- `timeoutMs`，默认 15 分钟。
- `canvasHome`，`tab` 或 `sidebar`。

环境变量优先于配置文件，包括 `DSH_SVS_COMFY_URL`、`DSH_SVS_COMFY_KEY`、`DSH_SVS_POLL_MS` 和 `DSH_SVS_TIMEOUT_MS`。

### 9.2 图片生成

```text
Agent 调用 comfy_generate_image
  → 校验 capability/tier/画幅/prompt
  → registry 解析 Qwen-Image 2.1 manifest
  → 解析模型资产与用户覆盖
  → 将 prompt/seed/width/height 注入 graph
  → POST ComfyUI /prompt
  → 得到 prompt_id
  → 轮询 GET /history/{prompt_id}
  → 解析图片输出
  → GET /view 下载
  → File Service 原子保存
  → 创建 Asset/Canvas Node
  → 返回 node id、路径、seed、尺寸、tier
```

i2i 在提交前先解析参考节点或资产 id，并通过 `/upload/image` 上传到 ComfyUI input。

### 9.3 视频生成

```text
Agent 调用 comfy_generate_video
  → type='r2v' 或 type='i2v'
  → 校验 type 与参数组合
  → 解析 MiniMax H3 manifest
  → 解析 ref_nodes / first_frame / last_frame
  → 可选解析 continuity_from
  → 上传参考图片
  → 注入 H3 结构化 prompt、seed、length、尺寸和模型资产
  → POST /prompt
  → 轮询 /history/{prompt_id}
  → 下载视频及其 H3 原生音轨
  → 保存媒体、参数快照和血缘
  → 创建待审核 Shot Asset
```

形状约束：

- r2v 使用 `ref_nodes`，不能携带首末帧参数。
- i2v 使用 `first_frame_node`，可选 `last_frame_node`，不能携带 `ref_nodes`。
- `continuity_from` 与形状正交，但前后镜必须使用支持连续性的实现。
- 同一连续链的首遍尺寸必须一致。

### 9.4 视频音频

第一条生产链优先使用 MiniMax H3 workflow 同时生成视频、对白、环境声和音效。当 H3 音轨质量不满足要求时，启用以下备用策略：

**音频策略（`audioStrategy`）**

| 策略 | 对白 | BGM | 环境声 | 启用条件 |
| --- | --- | --- | --- | --- |
| `h3-native`（默认） | H3 内生成 | H3 内生成 | H3 内生成 | H3 音轨质量达标 |
| `tts-override` | edge-tts / GPT-SoVITS | H3 或独立 BGM | H3 | 对白需要精细口型/情绪控制 |
| `full-mix` | 独立 TTS | MusicGen / 素材库 | H3 或独立采集 | H3 音轨整体不可用 |

策略选择规则：
1. 默认 `h3-native`，每镜生成后由 VLM 或人工评估音轨质量。
2. 若对白清晰度或情绪匹配低于阈值，自动建议切换到 `tts-override`，需用户确认。
3. `full-mix` 仅在用户显式选择时启用。
4. 策略变更记录在 ProductionSpec 中，影响后续所有未生成镜头。

**音轨模式**

- `dialogue-led`：镜头 prompt 指定唯一说话人、对白、字幕和非说话人闭嘴。
- `silent`：当前 Skill 语义是无对白、无字幕、全员闭嘴，但可保留环境声/SFX。
- 如果用户要求真正无音轨，必须在最终导出阶段显式执行移除音轨；不能把 `silent` 错报为无音轨文件。

**独立 TTS/BGM 合成时的处理**

- 独立音轨与 H3 视频的时间对齐在拼接阶段完成，使用 FFmpeg 混流。
- 独立 TTS 产出的对白音轨作为派生 Asset 记录，保留与原 H3 音轨的替换血缘。
- BGM 作为 Episode 级别 Asset，不与单镜绑定。

### 9.5 拼接

`video_concat` 优先检测本机 FFmpeg：

1. 尝试 stream copy，避免重复编码。
2. copy 不兼容时回退重编码。
3. 没有 FFmpeg 时使用 ComfyUI 拼接图。
4. 拼接默认硬切；溶解或复杂转场必须作为独立转场镜提前生成。

## 10. Project Domain

### 10.1 一致性边界

一个 Project 是最小权威聚合。单机版不需要跨项目事务。

```text
Project
  ├─ ProductionSpec
  ├─ StoryBible
  ├─ Characters[]
  │    └─ CharacterStates[]
  ├─ Locations[]
  ├─ Episodes[]
  │    └─ Shots[]
  ├─ GenerationAttempts[]
  ├─ Assets[]
  ├─ ReviewTasks[] / ReviewDecisions[]
  ├─ Timelines[]
  ├─ Deliverables[]
  ├─ RightsRecords[]
  └─ Outbox[]
```

### 10.2 核心实体职责

| 实体 | 职责 |
| --- | --- |
| `Project` | 稳定身份、标题、内容分级、revision 和生命周期 |
| `ProductionSpec` | 画幅、时长、音频模式、音频策略（`audioStrategy`）、生成档位、交付画质 |
| `StoryBible` | 世界观、风格、禁用项和连续性规则 |
| `Character` | 稳定角色身份、成年确认、视觉与声线锚点 |
| `CharacterState` | 服装、伤势、年龄阶段、携带物和适用镜头范围 |
| `Location` | 空间布局、时间、光位、道具和连续性地标 |
| `Episode` | 故事大纲、剧本、场景序列和制作状态 |
| `Shot` | 时长、镜头语言、可选 `cameraSpec`（景别/运镜/焦距）、引用、续接、期望输出和批准素材 |
| `GenerationAttempt` | 幂等键、manifest 版本、参数快照、prompt id 和状态 |
| `Asset` | 媒体 hash、逻辑 key、来源、派生关系和审核状态 |
| `ReviewTask` | 某个候选产物需要检查的项目和检查清单；支持 `manual`（人工）和 `automated_vlm`（VLM 自动检查）两种类型 |
| `ReviewDecision` | 通过/驳回、理由、操作者和时间 |
| `Timeline` | 已批准镜头的有序版本，不直接引用“最新文件名” |
| `Deliverable` | timeline revision、编码参数、成片 hash、质量报告和可选 NLE 导出预设（`jianying-draft` / `fcpxml` / `davinci-edl`） |
| `RightsRecord` | 来源、许可证、肖像/声音授权、允许范围和撤销状态 |

### 10.3 Revision 与命令

每次写命令至少携带：

```text
projectId
expectedRevision
commandId
actor
timestamp
payload
```

领域服务通过 Harness Domain Storage 的表 `update` 修改 Project；该串行写链只按进程内保证设计，跨进程由项目级单写者租约约束。revision 不匹配时显式返回冲突，不做最后写入者覆盖。

### 10.4 Project 聚合 JSON Schema

Domain Storage 以 `projectId` 为 key、整个 Project 为 value 存储。以下是聚合根的完整结构定义（TypeScript 记法，实际以 JSON Schema 校验）：

```typescript
/** Domain Storage key = projectId, value = Project */
interface Project {
  id: string                          // nanoid, 稳定身份
  schemaVersion: 2                    // 迁移器检查
  revision: number                    // 每次 update +1, CAS 乐观并发
  title: string
  contentRating: 'general' | 'mature' | 'adult'
  status: 'active' | 'archived' | 'deleted'
  createdAt: string                   // ISO 8601
  createdBy: string
  updatedAt: string

  productionSpec: ProductionSpec
  storyBible: StoryBible | null

  characters:       Record<string, Character>
  characterStates:  Record<string, CharacterState>
  locations:        Record<string, Location>
  episodes:         Record<string, Episode>
  shots:            Record<string, Shot>
  attempts:         Record<string, GenerationAttempt>
  assets:           Record<string, Asset>
  reviewTasks:      Record<string, ReviewTask>
  reviewDecisions:  Record<string, ReviewDecision>
  timelines:        Record<string, Timeline>
  deliverables:     Record<string, Deliverable>
  rightsRecords:    Record<string, RightsRecord>
  outbox:           Record<string, OutboxEvent>

  commandIndex:     Record<string, CommandResult>  // commandId → 幂等结果
  lease: WriterLease | null
}

interface ProductionSpec {
  aspectRatio: string                 // '16:9' | '9:16' | '1:1'
  targetDuration: string              // '30s' | '60s' | '90s'
  audioMode: 'silent' | 'dialogue-led' | 'narration-led'
  audioStrategy: 'h3-native' | 'tts-override' | 'full-mix'
  tier: 'fast' | 'balanced' | 'quality'
  deliveryQuality: 'draft' | 'preview' | 'final'
  updatedAt: string
}

interface StoryBible {
  worldRules: string
  style: string
  prohibitions: string[]
  continuityRules: string[]
  emotionAnchors: string[]
  audioSpine: string | null
  updatedAt: string
}

interface Character {
  id: string
  name: string
  adultConfirmed: boolean             // false 时不得进入成人生产链
  visualAnchorAssetId: string | null  // 锚点角色卡 Asset
  voiceAnchorDesc: string | null
  description: string
  createdAt: string
  updatedAt: string
}

interface CharacterState {
  id: string
  characterId: string
  label: string                       // '默认' | '战损' | '礼服' 等
  costume: string
  injuries: string | null
  ageStage: string
  carriedItems: string[]
  emotion: string | null
  applicableEpisodes: string[]        // 空 = 全局
  updatedAt: string
}

interface Location {
  id: string
  name: string
  layout: string
  timeOfDay: string
  lighting: string
  props: string[]
  continuityLandmarks: string[]
  anchorAssetId: string | null
  updatedAt: string
}

interface Episode {
  id: string
  order: number
  title: string
  outline: string | null
  script: string | null
  status: EpisodeStatus               // §11.1 状态机
  sceneSequence: string[]             // shot ids in order
  updatedAt: string
}

interface Shot {
  id: string
  episodeId: string
  order: number
  durationFrames: number              // 24fps
  cameraSpec: CameraSpec | null       // 可选镜头语言
  shotDescription: string             // 每秒镜头描述
  audioDialogue: string | null        // 对白文本
  audioNotes: string | null           // 音频备注
  hookType: string | null             // 'visual' | 'audio' | 'cut' | null
  continuityFrom: string | null       // 前一镜 shotId
  referenceAssetIds: string[]         // 角色卡/场景卡 asset ids
  firstFrameAssetId: string | null
  lastFrameAssetId: string | null
  approvedAssetId: string | null      // 当前批准的 Asset
  status: ShotStatus                  // §11.2 状态机
  updatedAt: string
}

interface CameraSpec {
  shotSize: 'extreme-close' | 'close' | 'medium' | 'full' | 'wide' | 'extreme-wide'
  movement: 'static' | 'push' | 'pull' | 'pan' | 'tilt' | 'dolly' | 'track' | 'crane'
  focalIntent: string | null          // '浅景深' | '全景深' 等
}

interface GenerationAttempt {
  id: string
  shotId: string
  idempotencyKey: string              // §15.1 计算方式
  capability: string                  // 'video.reference2video' 等
  tier: string
  manifestId: string
  manifestVersion: string
  paramsSnapshot: Record<string, unknown>  // 完整参数快照
  promptHash: string
  comfyPromptId: string | null        // ComfyUI 返回的 prompt_id
  status: AttemptStatus               // §11.3 状态机
  candidateAssetId: string | null     // 成功后产生的候选 Asset
  failureReason: string | null
  createdAt: string
  updatedAt: string
}

interface Asset {
  id: string
  type: 'character_card' | 'scene_card' | 'shot_video' | 'shot_audio'
       | 'upscaled_video' | 'tts_audio' | 'bgm_audio' | 'concat_video'
       | 'deliverable_video' | 'source_text' | 'storyboard'
  logicalKey: string                  // 'characters/{charId}/card' 等
  fileHash: string                    // sha256
  mimeType: string
  fileSize: number
  width: number | null
  height: number | null
  durationMs: number | null
  derivedFrom: string[]               // 上游 asset ids（血缘）
  attemptId: string | null            // 生成它的 Attempt
  reviewStatus: 'candidate' | 'approved' | 'rejected' | 'invalidated'
  createdAt: string
}

interface ReviewTask {
  id: string
  targetType: 'asset' | 'episode' | 'shot' | 'timeline' | 'deliverable'
  targetId: string
  checkType: 'manual' | 'automated_vlm'
  checklist: string[]                 // 人工检查项
  automatedCheck: AutomatedCheckResult | null
  status: 'pending' | 'in_progress' | 'completed'
  createdAt: string
}

interface AutomatedCheckResult {
  modelId: string                     // 执行 VLM 检查的模型
  checkItems: Record<string, CheckItemResult>
  confidence: number                  // 0-1
  threshold: number                   // 默认 0.85
  passed: boolean
  failedItems: string[]
  executedAt: string
}

interface CheckItemResult {
  passed: boolean
  confidence: number
  detail: string | null
}

interface ReviewDecision {
  id: string
  reviewTaskId: string
  decision: 'approved' | 'rejected'
  reason: string
  actor: string                       // 'user' | 'system'
  annotations: string[]
  createdAt: string
}

interface Timeline {
  id: string
  revision: number
  episodeId: string
  segments: TimelineSegment[]
  status: 'draft' | 'validated' | 'frozen' | 'invalidated' | 'superseded'
  createdAt: string
  frozenAt: string | null
}

interface TimelineSegment {
  shotId: string
  assetId: string                     // 必须是 approved Asset
  startFrame: number
  endFrame: number
  audioOverrideAssetId: string | null // tts-override 时的替换音轨
}

interface Deliverable {
  id: string
  timelineId: string
  timelineRevision: number
  encodingParams: Record<string, unknown>
  nlePreset: 'none' | 'jianying-draft' | 'fcpxml' | 'davinci-edl'
  fileHash: string | null
  qualityReport: Record<string, unknown> | null
  contentRating: string
  sidecarManifest: Record<string, unknown> | null
  status: DeliverableStatus           // §11.9 状态机
  createdAt: string
  deliveredAt: string | null
}

interface RightsRecord {
  id: string
  subjectType: 'character' | 'reference_photo' | 'voice' | 'brand' | 'music'
  subjectId: string
  adultAssertion: boolean
  verificationMethod: string
  verifiedAt: string
  verifier: string
  consentScope: string[]
  allowedUses: string[]
  channels: string[]
  territory: string
  licenseSource: string | null
  termsHash: string | null
  effectiveAt: string
  expiresAt: string | null
  revokedAt: string | null
  evidenceLogicalKey: string | null
  evidenceSha256: string | null
  createdAt: string
  supersedes: string | null
}

interface OutboxEvent {
  id: string
  type: string                        // §15.6.1 事件目录
  payload: Record<string, unknown>
  status: 'pending' | 'processing' | 'delivered' | 'retry_wait' | 'dead'
  retryCount: number
  maxRetries: number
  lastError: string | null
  externalRef: string | null          // 外部系统返回的标识
  createdAt: string
  processedAt: string | null
}

interface CommandResult {
  commandId: string
  payloadHash: string                 // 同 id 不同 payload 拒绝
  result: 'ok' | 'conflict'
  revision: number                    // 执行后的 revision
  timestamp: string
}

interface WriterLease {
  ownerPid: number
  ownerHost: string
  ownerProfile: string
  startedAt: string
  heartbeatAt: string
  leaseVersion: number
}
```

**聚合大小约束**：单个 Project 的 JSON 序列化体积不应超过 **10 MB**。阶段 0 的 Domain Storage probe 必须验证后端对单条 record value 的实际大小限制。对于超过 100 集的超长项目，考虑拆分为多个 Project 而非扩大单聚合。

**实体 key 策略**：所有 `Record<string, T>` 的 key 均为实体 `id`（nanoid）。查询使用内存遍历（单机场景数据量有限），不建索引表。

### 10.5 领域命令完整规格

每条命令的定义包含：输入 payload、前置条件、状态转换和产出的 Outbox 事件。

#### `createProject`

```text
payload:
  title: string
  contentRating: 'general' | 'mature' | 'adult'
  productionSpec: ProductionSpec

preconditions:
  - commandId 在全局无冲突（跨 project 的 id 唯一性由调用方保证）

transitions:
  - 创建 Project, status='active', revision=1

outbox:
  - project.created { projectId }
```

#### `updateProductionSpec`

```text
payload:
  aspectRatio?: string
  targetDuration?: string
  audioMode?: string
  audioStrategy?: string
  tier?: string
  deliveryQuality?: string

preconditions:
  - Project.status = 'active'

transitions:
  - 合并更新 productionSpec 字段
  - 若 audioStrategy 变更：标记所有未生成 Shot 的 spec 已变化

outbox:
  - spec.updated { projectId, changedFields[] }
```

#### `upsertStoryBible`

```text
payload:
  worldRules?: string
  style?: string
  prohibitions?: string[]
  continuityRules?: string[]
  emotionAnchors?: string[]
  audioSpine?: string

preconditions:
  - Project.status = 'active'

transitions:
  - 创建或合并更新 storyBible

outbox:
  - storybible.updated { projectId }
```

#### `upsertCharacter`

```text
payload:
  id?: string                      // 无 id = 新建, 有 id = 更新
  name: string
  adultConfirmed: boolean
  visualAnchorAssetId?: string
  voiceAnchorDesc?: string
  description?: string

preconditions:
  - Project.status = 'active'
  - 若 contentRating='adult', adultConfirmed 必须为 true
  - 若指定 visualAnchorAssetId, 该 Asset 必须存在且 reviewStatus='approved'

transitions:
  - 创建或更新 Character
  - 若更新了 visualAnchorAssetId（锚点变更）→ 触发 invalidateDependents

outbox:
  - character.upserted { projectId, characterId, anchorChanged: boolean }
```

#### `upsertCharacterState`

```text
payload:
  id?: string
  characterId: string
  label: string
  costume: string
  injuries?: string
  ageStage: string
  carriedItems?: string[]
  emotion?: string
  applicableEpisodes?: string[]

preconditions:
  - Character 存在
  - Project.status = 'active'

transitions:
  - 创建或更新 CharacterState
  - 若更新已有 state → 触发 invalidateDependents（所有引用此 state 的 Shot）

outbox:
  - characterState.upserted { projectId, characterId, stateId }
```

#### `upsertLocation`

```text
payload:
  id?: string
  name: string
  layout: string
  timeOfDay: string
  lighting: string
  props?: string[]
  continuityLandmarks?: string[]

preconditions:
  - Project.status = 'active'

transitions:
  - 创建或更新 Location
  - 若更新 → 触发 invalidateDependents（引用此 Location 的 Shot）

outbox:
  - location.upserted { projectId, locationId }
```

#### `upsertEpisode`

```text
payload:
  id?: string
  order: number
  title: string
  outline?: string
  script?: string
  sceneSequence?: string[]

preconditions:
  - Project.status = 'active'
  - 若从 draft 之外的状态修改 outline/script → Episode 必须先回到可编辑状态

transitions:
  - 创建: Episode status='draft'
  - 更新: 若修改了 outline → status 回退到 'draft'（若当前在 'planning' 之后）
  - 若修改了 sceneSequence → 触发 invalidateDependents

outbox:
  - episode.upserted { projectId, episodeId }
```

#### `upsertShot`

```text
payload:
  id?: string
  episodeId: string
  order: number
  durationFrames: number
  cameraSpec?: CameraSpec
  shotDescription: string
  audioDialogue?: string
  audioNotes?: string
  hookType?: string
  continuityFrom?: string            // 前一镜 shotId
  referenceAssetIds?: string[]
  firstFrameAssetId?: string
  lastFrameAssetId?: string

preconditions:
  - Episode 存在
  - Project.status = 'active'
  - 若指定 continuityFrom, 该 Shot 必须存在
  - 若指定 referenceAssetIds, 每个 Asset 必须存在且 approved
  - referenceAssetIds 和 firstFrameAssetId 不同时为非空（形状互斥）

transitions:
  - 创建: Shot status='planned'
  - 更新: 若修改了描述/参考/续接 → status 回退到 'planned'
  - 若 status 在 approved 之后 → 触发 invalidateDependents

outbox:
  - shot.upserted { projectId, shotId, episodeId }
```

#### `createGenerationAttempt`

```text
payload:
  shotId: string
  capability: string
  tier: string
  manifestId: string
  manifestVersion: string
  paramsSnapshot: Record<string, unknown>
  promptHash: string
  seed: number
  referenceAssetHashes: string[]

preconditions:
  - Shot.status = 'ready'
  - 幂等键计算后查重：已有成功 Attempt → 返回已有结果; 已有活动 Attempt → 返回其状态
  - 若 contentRating='adult': 所有引用 Character 的 adultConfirmed=true
  - 所有引用的 Asset reviewStatus='approved'
  - 相关 RightsRecord 有效（未过期、未撤销、scope 覆盖）

transitions:
  - 创建 GenerationAttempt status='created'
  - Shot status → 'generating'

outbox:
  - attempt.created { projectId, attemptId, shotId, idempotencyKey }
```

#### `markAttemptSubmitted`

```text
payload:
  attemptId: string
  comfyPromptId: string | null       // null = submission_unknown

preconditions:
  - Attempt.status = 'created' 或 'submitting'

transitions:
  - 有 promptId → status='queued', 记录 comfyPromptId
  - 无 promptId → status='submission_unknown'

outbox:
  - attempt.submitted { projectId, attemptId, comfyPromptId }
```

#### `completeGenerationAttempt`

```text
payload:
  attemptId: string
  assetData:
    fileHash: string
    mimeType: string
    fileSize: number
    width: number
    height: number
    durationMs: number | null
    logicalKey: string

preconditions:
  - Attempt.status in ['queued', 'running', 'downloading']

transitions:
  - Attempt status → 'succeeded'
  - 创建 Asset, type 根据 capability 推导, reviewStatus='candidate'
  - Attempt.candidateAssetId = 新 Asset id
  - Shot status → 'review'

outbox:
  - attempt.completed { projectId, attemptId, assetId }
  - reviewTask.needed { projectId, assetId, shotId }
```

#### `failGenerationAttempt`

```text
payload:
  attemptId: string
  reason: string

preconditions:
  - Attempt.status in ['created','submitting','queued','running',
    'downloading','submission_unknown']

transitions:
  - Attempt status → 'failed'
  - Shot status → 'ready'（允许重新生成）

outbox:
  - attempt.failed { projectId, attemptId, reason }
```

#### `createReviewTask`

```text
payload:
  targetType: 'asset' | 'episode' | 'shot' | 'timeline' | 'deliverable'
  targetId: string
  checkType: 'manual' | 'automated_vlm'
  checklist: string[]

preconditions:
  - 目标实体存在
  - 若 targetType='asset': Asset.reviewStatus='candidate'

transitions:
  - 创建 ReviewTask status='pending'

outbox:
  - review.taskCreated { projectId, reviewTaskId, targetType, targetId }
```

#### `recordAutomatedCheck`

```text
payload:
  reviewTaskId: string
  modelId: string
  checkItems: Record<string, CheckItemResult>
  confidence: number
  threshold: number

preconditions:
  - ReviewTask 存在且 checkType='automated_vlm'
  - ReviewTask.status = 'pending' 或 'in_progress'

transitions:
  - 写入 ReviewTask.automatedCheck
  - ReviewTask.status → 'in_progress'
  - 若 confidence >= threshold → 创建后续人工 ReviewTask 标记为"推荐通过"

outbox:
  - review.automatedCheckCompleted { projectId, reviewTaskId, passed }
```

#### `recordReviewDecision`

```text
payload:
  reviewTaskId: string
  decision: 'approved' | 'rejected'
  reason: string
  actor: string
  annotations?: string[]

preconditions:
  - ReviewTask 存在且 status != 'completed'

transitions:
  - 创建 ReviewDecision
  - ReviewTask.status → 'completed'
  - 若 decision='approved' 且 targetType='asset':
    - Asset.reviewStatus → 'approved'
  - 若 decision='rejected':
    - Asset.reviewStatus → 'rejected'
    - Shot.status → 'ready'（允许重新生成）

outbox:
  - review.decided { projectId, reviewTaskId, decision }
```

#### `approveShotAsset`

```text
payload:
  shotId: string
  assetId: string

preconditions:
  - Asset.reviewStatus = 'approved'
  - Asset.attemptId 对应的 Attempt 属于该 Shot
  - Shot.status = 'review'

transitions:
  - Shot.approvedAssetId = assetId
  - Shot.status → 'approved'

outbox:
  - shot.assetApproved { projectId, shotId, assetId }
```

#### `invalidateDependents`

```text
payload:
  sourceType: 'character' | 'characterState' | 'location' | 'shot' | 'asset'
  sourceId: string

preconditions:
  - 源实体存在

transitions:
  - 广度优先遍历依赖图（§14 规则表）
  - 对每个受影响的 Asset: reviewStatus → 'invalidated'
  - 对每个受影响的 Shot: status → 'invalidated' → 'ready'（若当前在 approved 之后）
  - 对每个受影响的 Timeline: status → 'invalidated'
  - 记录失效集合到命令结果

outbox:
  - lineage.invalidated { projectId, sourceType, sourceId, affectedIds[] }
```

#### `assembleTimeline`

```text
payload:
  episodeId: string
  segments: { shotId: string, assetId: string, audioOverrideAssetId?: string }[]

preconditions:
  - Episode 存在
  - 每个 segment 的 Shot.status = 'approved'
  - 每个 segment 的 Asset.reviewStatus = 'approved'
  - 每个 Asset 的分辨率/画质一致
  - 若 audioStrategy != 'h3-native': audioOverrideAssetId 必须存在且 approved

transitions:
  - 创建 Timeline, status='draft', revision=1
  - 或在已有 draft Timeline 上递增 revision
  - 相关 Shot.status → 'assembled'

outbox:
  - timeline.assembled { projectId, timelineId, episodeId }
```

#### `recordDeliverable`

```text
payload:
  timelineId: string
  encodingParams: Record<string, unknown>
  nlePreset: 'none' | 'jianying-draft' | 'fcpxml' | 'davinci-edl'
  fileHash: string
  qualityReport: Record<string, unknown>
  contentRating: string
  sidecarManifest: Record<string, unknown>

preconditions:
  - Timeline.status = 'frozen'
  - 若 contentRating='adult': 交付前检查全部通过（§16.3）
  - fileHash 对应文件已通过 File Service 写入

transitions:
  - 创建 Deliverable, status='ready'

outbox:
  - deliverable.ready { projectId, deliverableId, timelineId }
```

#### `recordRights`

```text
payload:
  subjectType: 'character' | 'reference_photo' | 'voice' | 'brand' | 'music'
  subjectId: string
  adultAssertion: boolean
  verificationMethod: string
  consentScope: string[]
  allowedUses: string[]
  channels: string[]
  territory: string
  licenseSource?: string
  termsHash?: string
  effectiveAt: string
  expiresAt?: string
  evidenceLogicalKey?: string
  evidenceSha256?: string
  supersedes?: string

preconditions:
  - subject 实体存在
  - 若 supersedes 指定，旧 RightsRecord 必须存在

transitions:
  - 创建 RightsRecord
  - 若 supersedes 指定，旧记录不删除但标记被取代

outbox:
  - rights.recorded { projectId, rightsId, subjectType, subjectId }
```

## 11. 状态机

### 11.1 Episode

```text
draft
  → planning
  → assets
  → shotlist
  → storyboard
  → rendering
  → assembly
  → review
  → delivered

任意生产态 → blocked
blocked → 原生产态
未交付态 → cancelled
```

### 11.2 Shot

```text
planned
  → ready
  → generating
  → review
  → approved
  → assembled

review → rejected → ready
approved → invalidated → ready
任意非终态 → blocked
```

### 11.3 GenerationAttempt

```text
created
  → submitting
  → queued
  → running
  → downloading
  → succeeded

submitting → submission_unknown
active → cancelling → cancelled
active → failed
```

Attempt 成功不等于 Shot 批准；成功只产生候选 Asset，必须经过 ReviewDecision。

### 11.4 Review 与 Harness Approval

```text
领域命令创建 ReviewTask
  → Harness ask/approval 收集用户选择
  → 插件把响应写成 ReviewDecision
  → 状态机进入 approved / rejected / blocked
```

Approval 是交互机制，ReviewDecision 才是业务真相。

### 11.5 Project

```text
draft → active → archived
draft/active → blocked → 原状态
archived → active
draft/active/archived → deleting → deleted
```

`deleted` 只表示领域记录完成删除流程；进入该状态前必须生成删除清单、处理引用并完成可恢复的文件移入 Trash。不得用删除 Project 来级联硬删 Rights 证据或已导出的归档包。

### 11.6 Asset

```text
pending → ready → in_review → approved
in_review → rejected
ready/approved → invalidated
rejected/invalidated → trashed → deleted
```

`approved` 只允许由 ReviewDecision 产生；`invalidated` 保留历史和血缘但不能进入新 Timeline。源素材、current Timeline 引用、有效 Deliverable 引用和 Rights 证据禁止自动进入 `trashed`。

### 11.7 ReviewTask

```text
open → awaiting_human → decided
open/awaiting_human → superseded
open/awaiting_human → cancelled
```

每个 `decided` 任务必须关联不可变 ReviewDecision；上游 revision 改变时旧任务进入 `superseded`，旧决定保留但不再对新 revision 生效。

### 11.8 Timeline

```text
draft → validated → frozen
draft/validated → invalidated
frozen → superseded
```

Timeline revision 一旦 `frozen` 不原地修改。镜头版本变化后创建新 revision，旧 revision 只有在所有 Asset 均仍有效时才可重复导出。

### 11.9 Deliverable

```text
planned → exporting → ready → delivered
exporting → failed → planned
ready/delivered → superseded
planned/failed → cancelled
```

`delivered` 表示已通过某个 delivery adapter 完成送达，不等于版权或内容合规自动成立；每个版本保存 Timeline revision、编码参数、hash、分级、provenance 和质量报告。

NLE 导出预设（可选）：Deliverable 可携带 `nlePreset` 字段，值为 `jianying-draft`、`fcpxml` 或 `davinci-edl`。导出时根据预设将 Timeline 转换为对应 NLE 的工程文件格式，媒体文件使用相对路径引用，方便用户在剪映/Final Cut Pro/DaVinci Resolve 中二次编辑。

### 11.10 OutboxEvent

```text
pending → processing → delivered
processing → retry_wait → processing
processing/retry_wait → dead
```

Outbox 不是独立数据库：领域状态变化与 OutboxEvent 在同一次 Project `update` 中提交。一个进程内 dispatcher 按 `eventId` 幂等执行文件发布、ComfyUI 后续动作和 UI 通知；重试超过策略阈值进入 `dead` 并显示给用户，绝不静默丢弃。

### 11.11 RightsRecord

```text
draft → verified → active
active → expired
draft/verified/active → revoked
```

只有 `active` 且 scope 覆盖目标用途的记录才能通过生成/交付硬门。`expired/revoked` 立即阻止新的生成和交付，并使相关当前资产进入合规阻塞；历史记录不得覆写。

## 12. 存储设计

### 12.1 禁止恢复历史固定目录

已经删除的 `~/.dsh/storages/elysium` 不属于目标架构。代码不得恢复、扫描、迁移到或作为 fallback 创建该目录。

### 12.2 结构化状态

Project 聚合使用 Harness Domain Storage。目标要求：

- schema version 不匹配时拒绝静默打开。
- 写入持久化成功后才更新内存。
- 单 Project 的命令原子更新。
- 损坏数据不得伪装成空项目。
- 备份与迁移失败保留旧版本。

### 12.3 媒体文件

File Service 的根目录由宿主工作区解析或用户显式配置，不写死用户主目录。

逻辑布局：

```text
<resolved-project-root>/
  media/
    source/
    generated/
    derived/
  exports/
  cache/
  tmp/
```

Domain 中只保存：

```text
assetId
logicalKey
sha256
mimeType
size
width/height/duration/fps
lineage
```

绝对路径不是 Asset 身份。File Service 负责把 logical key 解析为当前机器的绝对路径。

### 12.4 当前数据迁移

当前实现仍使用：

- `<workspace>/canvas/<sessionId>/project.json`
- `<workspace>/.dsh-assets/library.json`

迁移工具必须由用户显式指定旧 workspace：

1. 只读加载旧项目。
2. 校验 JSON 和媒体文件。
3. 转换为 Project/Asset/Review/Timeline。
4. 比对节点参数、血缘、泳道、分组、顺序、批准版本和送达状态。
5. 输出迁移报告。
6. 不自动删除旧文件。

## 13. 完整短剧生产流程

### Step -1：长文本输入预处理（可选）

当用户提供小说、剧本或长篇故事文本作为创作输入时：

1. 接收长文本（支持粘贴或文件上传）。
2. Qwen3.8 执行结构化压缩：提取核心冲突、主要角色、关键场景和情节转折点。
3. 压缩比目标：原文 → 短剧适配摘要，保留人物关系图谱和情感弧线。
4. 输出结构化的 Episode 大纲候选，标注原文对应段落（便于溯源）。
5. 用户确认/修改摘要后进入 Step 0。
6. 原文作为 Asset（类型 `source_text`）保存在 Project 中，建立与生成内容的血缘关系。

本步骤不是必须的——用户也可以从零开始创作，直接进入 Step 0。

#### 长篇召回边界

跨会话记忆、Markdown 索引或语义检索只能作为 Qwen3.8 的**候选上下文层**，不能成为项目事实来源。允许被索引的内容限于已经提交的 StoryBible、CharacterState、Episode 摘要和带血缘的 source_text；每条召回结果必须携带 `projectId / sourceType / sourceId / sourceRevision`，模型引用过期 revision 时不得据此提交领域命令。

关闭或卸载召回组件后，Project 仍必须能仅凭 Domain Storage、File Service 和审计记录完整打开、恢复、审核与交付。自动蒸馏出的角色关系、剧情结论或偏好在用户确认并执行领域命令前都只是候选信息，禁止反向覆盖 StoryBible、角色状态、镜头状态、ReviewDecision 或 revision。

### Step 0：接收需求与规格确认

1. Qwen3.8 识别完整短剧意图并加载 `3d-animation-short-generator`。
2. `asset_list` 查询可复用角色、场景和片段。
3. Harness 选项卡确认画幅、总时长、音频模式、档位和交付画质。
4. `canvas_set_state` 当前兼容工具转成 `updateProductionSpec`。
5. 创建或打开稳定 Project，不再用 sessionId 作为 projectId。

### Step 1：项目简报

- 写入 What-if、情绪前提、目标观众感受和交付计划。
- 成人内容额外写入分级、角色成年约束和禁止项。
- 用户批准后形成 ReviewDecision。

### Step 2：故事大纲

- 生成 Want/Need/缺陷、世界规则、8 拍故事骨架、情绪锚点和音频脊柱。
- 运行故事守门规则。
- 通过后推进 Episode 状态。

### Step 3：角色卡

1. 查找可复用 Character Asset。
2. 没有命中时调用 Qwen-Image 2.1 文生图。
3. 卡片必须是单视图正面全身、纯背景、零文字。
4. 记录 seed、manifest 版本和 prompt hash。
5. AI/VLM 自检后再请求人工锁定。
6. 重做角色状态时失效所有引用旧状态的下游镜头。

### Step 4：场景卡

1. 调用 Qwen-Image 2.1 生成无人场景。
2. 保存固定地标、光位、时间和道具状态。
3. 自检是否混入人物、文字或错误地标。
4. 人工锁定后才能进入镜头表。

### Step 5：七列镜头表

镜头表必须包含：

```text
镜头编号与时长
镜头语言（景别/运镜/焦距）
连续性衔接
续接
参考锚点
Hook 类型
每秒镜头描述
音频与对白轨
```

其中"镜头语言"列对应 Shot 的 `cameraSpec` 字段，记录景别（特写/中景/全景/远景）、运镜方式（固定/推/拉/摇/移/跟）和焦距意图。这些信息直接映射到 ComfyUI workflow 的 camera prompt 参数，确保生成画面符合视觉叙事设计。

每一行映射成一个 Shot，而不是只保存 Markdown 表格。

### Step 5.5：镜头表自检

检查 Hook 密度、单镜时长、角色数量、空间锚点、人物/道具状态、景别、对白字幕、转场帧、续接链闭合和续接可行性。失败项先修改 Shot，再重新运行自检。

### Step 6：分镜

- 默认生成一份文本分镜文档。
- 可选生成多宫格铅笔分镜图。
- 分镜是 Shot 的渲染说明，不替代 Shot 领域对象。
- 用户批准后，Shot 进入 `ready`。

### Step 7：逐镜生成

每个镜头严格串行执行：

```text
创建 Attempt(created)
  → 解析 H3 capability/tier
  → 保存参数快照与幂等键
  → 提交 ComfyUI
  → 保存 prompt_id
  → 轮询状态
  → 下载并 hash 媒体
  → 创建候选 Asset
  → 抽首/中/末关键帧
  → VLM 结构化自检（recordAutomatedCheck）
  → 创建 ReviewTask（含自检报告）
  → 用户批准或驳回
  → 批准后才生成下一镜
```

任一镜头重渲后，从该镜开始的 `continuity_from` 下游必须标记 invalidated，并按顺序重渲。

**VLM 结构化自检规范**

每镜生成后的 VLM 自检通过 `recordAutomatedCheck` 命令记录，包含以下结构化字段：

```text
automatedCheck:
  modelId             # 执行检查的 VLM 模型（如 Qwen3-VL）
  checkItems:
    - characterCount  # 画面人物数量是否与 Shot 描述一致
    - characterId     # 人物身份是否匹配角色卡
    - costumeMatch    # 服装是否与 CharacterState 一致
    - locationMatch   # 场景是否与 Location 描述一致
    - textInFrame     # 画面是否混入非预期文字
    - continuity      # 与上一镜的视觉连续性
    - composition     # 构图是否符合 cameraSpec
    - adultCompliance # 成人内容合规性（角色成年确认）
  confidence          # 整体置信度 0-1
  threshold           # 自动通过阈值（默认 0.85）
  passed              # confidence >= threshold
  failedItems[]       # 未通过的检查项列表
```

自检 `passed=true` 时仍需创建人工 ReviewTask，但可以标记为"推荐通过"以加速人工审核。自检 `passed=false` 时，在 ReviewTask 中高亮失败项供人工决策。

**VLM 执行路径**

VLM 自检通过聊天网关的 OpenAI 兼容接口执行，而非 ComfyUI：

```text
VLM 自检路径
插件
  → 抽取候选 Asset 关键帧（首/中/末）
  → 构造 multimodal chat 请求（system prompt = 检查策略 + checkItems，user = 关键帧图片）
  → 聊天网关 OpenAI-compatible endpoint
  → Qwen3-VL（或配置中指定的 VL 模型）
  → 解析结构化 JSON 响应 → automatedCheck schema
```

模型要求：聊天网关必须配置一个支持视觉输入的模型（如 Qwen3-VL）。`VisualInspectorPort` 的默认 adapter 即为 `ChatGatewayVLMAdapter`，调用时传入 `modelId`（从 `healthSnapshot.vlmModelId` 或配置获取）。

VLM 工具通过 `VisualInspectorPort` 接入，内置模型或第三方视觉插件都只是可替换 adapter。adapter 必须返回同一份 `automatedCheck` schema，并额外记录 `providerId / adapterVersion / modelVersion / inputAssetHashes / promptOrPolicyHash / executedAt`；原始证据图、裁剪区域或差异热图登记为 ReviewTask 的证据 Asset。工具自然语言回答、插件内部缓存和聊天附件不能直接形成 ReviewDecision。

**降级策略：VLM 不可用时的元数据启发式检查**

当 VLM 模型不可用（网关未配置 VL 模型、调用超时或返回错误）时，自检降级为元数据启发式检查：

| 检查项 | 启发式方法 | 置信度上限 |
| --- | --- | --- |
| characterCount | 解析 Shot prompt 中人物数量 vs 生成参数 | 0.6 |
| costumeMatch | 对比 CharacterState hash 与 Attempt 输入参数 | 0.5 |
| locationMatch | 对比 Location hash 与 Attempt 输入参数 | 0.5 |
| textInFrame | 不可检测，标记 `skipped` | — |
| continuity | 对比前镜 seed/prompt 相似度 | 0.4 |
| composition | 对比 cameraSpec 参数与 workflow 实际参数 | 0.5 |
| adultCompliance | 检查 Character.ageVerification 字段完整性 | 0.7 |

启发式检查的 `confidence` 不得超过 0.7，`threshold` 自动提升为 0.95（即必然 `passed=false`），强制进入人工审核。`automatedCheck.providerId` 标记为 `metadata-heuristic`，确保审核者知晓检查精度有限。

视觉检测失败、超时或不可用时，Attempt 已生成的候选 Asset 保持可见，ReviewTask 转为 `awaiting_human`；不得静默按通过处理，也不得因为更换视觉插件而改变 Shot、Asset、Review 和 Timeline 的领域语义。

### Step 8：拼接与交付

1. Timeline 只引用每个 Shot 当前批准的 Asset。
2. 选择超分时，先产生派生 Asset，再进入 Timeline。
3. 若 `audioStrategy` 为 `tts-override` 或 `full-mix`，在拼接前将独立音轨与视频混流。
4. `video_concat` 按 Timeline 顺序拼接。
5. 真正静音项目在导出阶段移除音轨。
6. 创建 Deliverable，保存 timeline revision、编码参数、hash 和质量报告。
7. 若用户选择了 NLE 导出预设，同时生成对应格式的工程文件（`jianying-draft` / `fcpxml` / `davinci-edl`），媒体使用相对路径引用。
8. 通过 Harness Deliverables 或当前渠道适配器交付。

## 14. 血缘与失效传播

每个 Asset 保存有向依赖：

```text
角色卡 ─┐
场景卡 ─┼→ 视频 Attempt → 镜头 Asset → 超分 Asset ─┐
上一镜 ─┘                                           ├→ Timeline → Deliverable
首末帧 ─────────────────────────────────────────────┘
```

失效规则：

- CharacterState 修改：失效所有引用镜头及其下游。
- Location 修改：失效引用场景和空间锚点的镜头。
- Shot 计划修改：失效该镜分镜、Attempt、批准素材和后续 Timeline。
- 链上镜头重渲：失效所有连续下游镜头。
- 单镜超分变化：失效引用旧派生素材的 Timeline。
- Timeline 变化：旧 Deliverable 保留但不再是 current。

**正式失效传播规则表**

`invalidateDependents` 命令根据以下规则表执行遍历。每行表示一条传播规则，触发源修改后沿箭头方向逐级失效：

| # | 触发源实体 | 触发条件 | 直接受影响实体 | 遍历方向 | 失效动作 |
| --- | --- | --- | --- | --- | --- |
| R1 | Character | 任意字段修改 | CharacterState（同 characterId） | Character → CharacterState → R2 | CharacterState.status → `invalidated` |
| R2 | CharacterState | status → `invalidated` 或内容修改 | Shot（`characterIds` 含该 characterId） | CharacterState → Shot → R4 | Shot 标记 `plan_dirty` |
| R3 | Location | 任意字段修改 | Shot（`locationId` 引用该 Location） | Location → Shot → R4 | Shot 标记 `plan_dirty` |
| R4 | Shot | `plan_dirty` 或计划字段修改 | GenerationAttempt（同 shotId，状态非 terminal） | Shot → Attempt | 活跃 Attempt 标记 `cancelled` |
| R5 | Shot | 批准 Asset 变更（重渲/替换） | Shot（`continuityFrom` 指向当前 Shot） | Shot → 下游 Shot → R4（递归） | 下游 Shot 标记 `plan_dirty`，连锁失效 |
| R6 | Asset | 派生源 Asset 失效 | Asset（`derivedFrom` 指向该 Asset） | Asset → 派生 Asset | 派生 Asset.status → `invalidated` |
| R7 | Asset | 批准 Asset 失效或替换 | Timeline（segments 引用该 Asset） | Asset → Timeline → R8 | Timeline.status → `dirty` |
| R8 | Timeline | status → `dirty` 或 revision 变更 | Deliverable（引用该 Timeline） | Timeline → Deliverable | Deliverable.status 保持但标记 `superseded`（不再 current） |
| R9 | StoryBible | 任意修改 | Episode（全部） | StoryBible → Episode → 各 Shot → R4 | 所有 Episode 标记需要重新审查 |
| R10 | Episode | 结构修改（场景增删、顺序调整） | Shot（属于该 Episode） | Episode → Shot → R4 | 受影响 Shot 标记 `plan_dirty` |

**遍历算法**：`invalidateDependents(entityType, entityId)` 按上表匹配触发源，收集直接受影响实体，对每个受影响实体递归检查是否触发后续规则（如 R2→R4→R5），直到无新实体被标记。所有变更在同一次 `Project.update` 中原子提交，并为每个被失效实体产生 `dependents_invalidated` OutboxEvent。

**循环保护**：遍历维护 `visited: Set<string>`（`entityType:entityId`），已访问实体不重复处理。由于依赖图是 DAG（Shot 的 `continuityFrom` 不允许成环），正常情况下不会出现循环；若检测到环（防御性），记录警告并中止该分支遍历。

失效不删除历史媒体；历史版本用于比较、恢复和审计。

## 15. 单机可靠性与恢复

### 15.1 幂等

Attempt 幂等键由稳定字段计算：

```text
projectId
shotId
shotRevision
capability
tier
manifestVersion
promptHash
referenceAssetHashes
seed
length
resolution
```

相同幂等键已有成功结果时复用；已有活动 Attempt 时返回其状态，不重复提交。

### 15.2 提交前落状态

禁止“ComfyUI 成功后才写节点”。正确顺序：

1. 持久化 Attempt(created)。
2. 改为 submitting。
3. 调用 `/prompt`。
4. 得到 prompt id 后立即持久化 queued。

响应丢失时进入 `submission_unknown`，不得盲目重试。只有能够从 ComfyUI history 或已知 client token 唯一核对时才恢复，否则请求用户确认是否重新提交。

### 15.3 启动恢复扫描

插件启动或打开 Project 时扫描非终态 Attempt：

- 有 prompt id：查询 ComfyUI history，继续轮询或下载。
- 没有 prompt id 且为 created：可以安全重新提交。
- submitting/submission_unknown 且无可核对标识：暂停并提示用户。
- downloading：检查临时文件和 hash，重新下载或原子发布。
- succeeded 但 Asset 未登记：根据输出记录补登记，不重复生成。

### 15.4 文件原子性

- 下载先写 `tmp/`。
- 完成后计算 hash。
- 校验媒体可读性。
- 同文件系统原子 rename 到 `media/`。
- 最后提交 Asset 记录。
- 任一失败保留旧版本，不产生半成品 current Asset。

### 15.5 单写者、锁与 revision

Domain Storage 的串行写链只能视为**进程内保证**，不能推导出 web/desktop 两个进程同时写同一 Project 仍然安全。目标实现采用项目级单写者租约：

```text
projectId
ownerPid
ownerHost
ownerProfile
startedAt
heartbeatAt
leaseVersion
```

- 打开项目先原子创建租约；失败者只能只读打开。
- 持有者周期更新 heartbeat；正常关闭主动释放。
- 只有确认 PID 已不存在且超过超时，才能自动回收同机租约。
- 主机/PID 状态无法确认时必须请求用户确认，不按时间单独抢锁。
- 即使持有租约，所有命令仍检查 `expectedRevision`，避免陈旧 UI 覆盖新状态。
- `commandId` 在 Project 内保留幂等结果索引；同 id 同 payload 返回原结果，同 id 不同 payload 拒绝。

### 15.6 Outbox 与副作用边界

一次领域命令只能原子改变 Project 状态和追加 OutboxEvent，不能宣称同时原子完成 JSON、媒体文件、ComfyUI 和外部发送。执行顺序为：

1. Project `update` 写业务意图与 `pending` outbox。
2. dispatcher 获取单写者租约，把事件标记为 `processing`。
3. 以 `eventId` 作为副作用幂等键执行。
4. 保存外部标识、文件 hash 或发送回执。
5. 第二次 Project `update` 标记 `delivered`；失败进入 `retry_wait/dead`。

文件发布采用 staging + hash + 原子 rename。若文件已发布但状态提交失败，恢复扫描以 `eventId/hash` 对账，不重复生成或发送。

**Outbox 事件类型汇总目录**

以下为所有领域命令产生的 OutboxEvent 类型汇总（详细定义见 §10.5 各命令规格）：

| 事件类型 | 产生命令 | payload 关键字段 | dispatcher 副作用 |
| --- | --- | --- | --- |
| `project_created` | createProject | projectId, title, contentRating | 创建项目目录结构、初始化 File Service 布局 |
| `production_spec_updated` | updateProductionSpec | projectId, changedFields | 无外部副作用；触发 UI 刷新 |
| `story_bible_updated` | upsertStoryBible | projectId | 无外部副作用 |
| `character_upserted` | upsertCharacter | projectId, characterId | 无外部副作用 |
| `character_state_upserted` | upsertCharacterState | projectId, characterId, stateId | 若有参考图 → 文件落盘 |
| `location_upserted` | upsertLocation | projectId, locationId | 若有参考图 → 文件落盘 |
| `episode_upserted` | upsertEpisode | projectId, episodeId | 无外部副作用 |
| `shot_upserted` | upsertShot | projectId, shotId | 无外部副作用 |
| `attempt_created` | createGenerationAttempt | projectId, attemptId, idempotencyKey | 无外部副作用（仅状态预留） |
| `attempt_submitted` | markAttemptSubmitted | projectId, attemptId, promptId | 无外部副作用（ComfyUI 已在命令前提交） |
| `attempt_completed` | completeGenerationAttempt | projectId, attemptId, assetId | 媒体文件从 staging → 正式位置原子 rename |
| `attempt_failed` | failGenerationAttempt | projectId, attemptId, errorCode | 清理 staging 临时文件 |
| `review_task_created` | createReviewTask | projectId, reviewTaskId, type | `automated_vlm` 类型 → 触发 VLM 自检调用 |
| `automated_check_recorded` | recordAutomatedCheck | projectId, reviewTaskId | 无外部副作用 |
| `review_decision_recorded` | recordReviewDecision | projectId, decisionId, verdict | 若 `approved` → 触发下游流程继续 |
| `shot_asset_approved` | approveShotAsset | projectId, shotId, assetId | 无外部副作用 |
| `dependents_invalidated` | invalidateDependents | projectId, sourceEntity, affectedEntities[] | 批量标记失效（详见 §14 传播规则表） |
| `timeline_assembled` | assembleTimeline | projectId, timelineId | 无外部副作用 |
| `deliverable_recorded` | recordDeliverable | projectId, deliverableId | 文件导出 / NLE 工程文件生成 |
| `rights_recorded` | recordRights | projectId, rightsRecordId | 无外部副作用 |

**dispatcher 处理规则**：
- 每个事件至多重试 3 次（指数退避：1s → 4s → 16s），超过后标记 `dead`。
- `dead` 事件保留在 outbox 中，启动恢复扫描时再次尝试或报告给用户。
- 同一 `eventId` 的副作用必须幂等：文件 rename 以 hash 校验，已存在则跳过。
- dispatcher 按 `createdAt` 顺序处理，保证因果序。

### 15.7 备份、损坏与恢复点

- 每次 schema migration 前创建 Project 快照和 manifest 校验和。
- 保留最近 N 个状态快照和每日恢复点；N/天数为用户配置，不写死在领域代码。
- 启动时校验 schema、Project hash、引用资产是否存在；损坏时进入只读修复模式。
- “空项目”不能作为读取失败的 fallback。
- 恢复操作本身写 AuditEvent，并生成新的 revision，不覆盖证据链。

## 16. 安全与本地信任边界

### 16.1 网络

- ComfyUI 优先绑定 `127.0.0.1`。
- 远程 ComfyUI 必须在受信任网络或 HTTPS 反向代理后，并配置 API key。
- 插件媒体路由继续执行相对路径、resolve、目录内检查、realpath 和二次目录内检查。
- iframe API 使用 `x-dsh-svs-token`，媒体 URL 使用短期或会话 token。

### 16.2 密钥

- 聊天网关密钥归 Harness Credentials/模型配置，不写入 Project。
- ComfyUI API key 属于宿主配置，不写进 workflow、节点参数或交付 manifest。
- 日志必须脱敏 Authorization header、prompt 中的隐私数据和本地绝对路径。

### 16.3 成人内容治理

生成前检查：

- 所有相关 Character 已记录 `adultConfirmed=true`。
- 真人参考已绑定 RightsRecord。
- 内容分级和禁止项已确认。

交付前检查：

- 每个最终 Asset 的来源和派生链完整。
- 不存在年龄不明角色。
- 不存在未授权真人肖像或声音。
- ReviewDecision 已完成。
- Deliverable 记录内容分级和必要声明。

#### 权利与年龄证据最小字段

```text
recordId / subjectType / subjectId
adultAssertion / verificationMethod / verifiedAt / verifier
consentScope / allowedUses / channels / territory
licenseSource / licenseReference / termsHash
effectiveAt / expiresAt / revokedAt
evidenceLogicalKey / evidenceSha256
createdAt / createdBy / supersedes
```

- 对真人、参考照片、声音克隆和品牌素材分别建 RightsRecord，不用一个布尔值代替许可范围。
- 原始身份证件等高敏材料默认不进入 Project；如当地规则或创作者流程确需保留，只保存加密文件的受控 logical key、脱敏摘要和 hash。
- scope 必须覆盖生成、编辑、声音合成、分发渠道和商业用途；到期、撤销或范围不足均 fail-closed。
- 具体司法辖区的年龄验证、记录保存、标签和分发要求属于**未确认的法律要求**，上线前必须由用户依据创作地与发布地核实。本文不构成法律意见。

#### 交付标识与溯源

每个 Deliverable 旁生成不可分离的 sidecar manifest，记录内容分级、模型/workflow 版本、源资产 hash、Timeline revision、Rights 覆盖摘要和审核决定。可见水印、不可见水印及容器 metadata 由发行 preset 配置；目标平台要求水印时不可关闭。移除水印只生成新 Deliverable，不修改旧交付记录。

#### 防篡改审计的真实边界

本地 `audit.ndjson` 采用追加写与 hash chain：每条包含 `seq/prevHash/eventHash/timestamp/actor/action/target/revision`。定期生成签名 checkpoint，并随归档包导出。该方案能发现链条被修改或截断，但机器所有者仍可删除整个日志或密钥，因此它是 **tamper-evident**，不是法律意义的 WORM/不可篡改存储；不得在 UI 或审核材料中夸大。

## 17. 本地可观测与诊断

不部署分布式观测栈。插件输出结构化事件，并在项目诊断页展示。

每条事件至少包含：

```text
timestamp
level
event
projectId
episodeId
shotId
attemptId
promptId
assetId
durationMs
status
errorCode
```

核心指标：

- 图片/视频生成耗时。
- 各档位成功率。
- ComfyUI 排队和执行时间。
- 重试、取消和恢复次数。
- 角色/场景一致性驳回率。
- 单镜首次通过率。
- 总成片耗时。
- 媒体磁盘占用。
- 无法恢复的 Attempt 数量。

日志只用于诊断，Project Domain 才是恢复真相。

### 17.1 磁盘预算、引用计数与 GC

媒体增长是单机产品的硬约束。File Service 启动、生成前、导出前均检查项目预算和文件系统剩余空间。建议默认告警水位为 70%/85%/95%，但最终值由配置决定；达到 critical 后阻止非必要生成和缓存扩张，仍允许导出、归档、清理和恢复。

引用计数不写成可漂移的手工整数，而是定期从以下权威引用重算：Project 当前实体、所有未终结 ReviewTask、current/frozen Timeline、有效 Deliverable、RightsRecord 和显式 pin。清理分级如下：

| 类别 | 自动策略 |
| --- | --- |
| `tmp/` 中已过期且无活动 Attempt 的文件 | 可按 TTL 自动删除 |
| 可重建 cache、预览图、代理文件 | 按 LRU 自动删除 |
| rejected/invalidated 且引用数为 0 的生成资产 | 超过宽限期后移入项目 Trash，不直接硬删 |
| source、approved current、Timeline、Deliverable、Rights 证据 | 禁止自动删除 |
| orphan | 首次扫描只报告；用户确认后移入 Trash |

Trash 默认保留期建议 30 天但必须可配置；硬删前再次重算引用并写审计事件。删除 Project 前先提供 `archive`：打包状态、媒体、workflow/manifests、Rights 摘要、audit checkpoint 和总校验清单。归档校验成功后才能进入删除流程。导入归档必须验证全部 hash，不能把缺失文件静默视为成功。

## 18. UI 与画布

第一阶段保持现有 UI 外观和交互，不允许继续保留旧写路径：

- `canvasHome=tab`：画布作为会话视图。
- `canvasHome=sidebar`：画布作为右侧栏。
- 两种位置只注册一个实例。
- 主线、检查帧、废弃三条泳道继续保留。
- 编辑、替换、AI 重做、废弃、恢复、入库、分组和排序继续保留。

阶段 1 即引入兼容适配器，避免“UI 暂不改变”与“所有写入必须经过领域命令”冲突：

```text
迁移前：UI → HTTP → 直接改 project.json
阶段 1：UI → 原 HTTP route → LegacyCanvasCommandAdapter
      → Domain Command → Project update → legacy-shaped Read Model → UI
最终：UI → 新领域 API → Domain Command → Project update → Read Model → UI
```

切换时只允许一次性导入，不做双写：选定 Project 成功迁移后，旧 `project.json` 和 `.dsh-assets/library.json` 变为只读迁移源/备份。兼容 adapter 把旧请求翻译为领域命令；任何无法无损翻译的动作必须显式报错，不能旁路写旧文件。

### 18.1 第三方 UI 与工作流扩展边界

Harness 侧栏、回复内交互组件或其他画布插件可以消费 read model，也可以把用户操作转换为公开领域命令，但不得直接读写 Project 存储、旧 `project.json`、资产索引或 ComfyUI 队列。当前画布仍是本产品的审核工作台，不因安装通用 UI 插件而增加第二套节点真值、任务状态或审批记录。

第三方 ComfyUI bridge、浏览器自动化、文件监听和可视化工作流同样不进入主执行链：已有 manifest registry、AttemptRunner、网关状态与 outbox 分别拥有能力解析、任务提交、恢复和副作用交付。只有目标服务确实没有 API，且 adapter 通过幂等、取消、超时、恢复和结果绑定测试时，才允许在对应 Port 后增加降级实现。

## 19. 模块重构建议

| 目标文件 | 职责 |
| --- | --- |
| `lib/domain/spec.js` | Project 聚合 schema 与版本 |
| `lib/domain/service.js` | Domain Storage 打开、命令提交和 revision 冲突 |
| `lib/domain/state-machines.js` | Episode、Shot、Attempt 状态转换 |
| `lib/domain/lease.js` | Project 单写者租约、heartbeat 和安全回收 |
| `lib/domain/outbox.js` | 与 Project 同步提交的副作用事件和 dispatcher |
| `lib/domain/policies.js` | 生成前、审核前、拼接前和交付前规则 |
| `lib/domain/invalidation.js` | 血缘遍历和下游失效集合 |
| `lib/domain/read-models.js` | 画布、审核队列、镜头队列和诊断投影 |
| `lib/domain/commands/*.js` | 唯一业务写入口 |
| `lib/storage/locator.js` | 从宿主或显式配置解析本地项目文件根 |
| `lib/storage/layout.js` | 相对逻辑布局 |
| `lib/storage/files.js` | 唯一二进制文件入口和原子发布 |
| `lib/storage/gc.js` | 磁盘预算、引用重算、LRU、Trash 和归档 |
| `lib/storage/migrations.js` | 旧画布与资产库迁移 |
| `lib/capabilities/registry.js` | 加载、合并、查询 manifest |
| `lib/capabilities/validation.js` | capability 与 workflow 约束校验 |
| `lib/comfy/client.js` | `/prompt`、`/history`、`/view`、`/upload/image` |
| `lib/media/generation.js` | Attempt 到媒体 Asset 的执行编排 |
| `lib/media/recovery.js` | 非终态 Attempt 恢复扫描 |
| `lib/media/lineage.js` | 媒体派生关系 |
| `lib/review/service.js` | ReviewTask、Harness Approval 和 ReviewDecision 桥接 |
| `lib/rights/service.js` | 年龄、同意、许可证和撤销记录及硬门 |
| `lib/timeline/model.js` | 不可变 Timeline revision |
| `lib/delivery/export.js` | 拼接、静音、编码和交付记录 |
| `lib/diagnostics/events.js` | 本地结构化事件和脱敏 |
| `lib/diagnostics/audit.js` | hash-chain 审计、checkpoint 和校验 |
| `lib/compat/legacy-canvas-adapter.js` | 旧 HTTP/画布请求到领域命令的临时翻译层 |

重构过程中 `lib/index.js` 逐步退化成装配层：创建服务、注册路由、注册工具、挂接监听器，不继续承载领域和 ComfyUI 细节。

## 20. 实施顺序

### 阶段 0：冻结当前行为

- 建工具、路由、画布动作、Skill 和脚本能力账本。
- 为重做、替换、废弃、恢复、资产物化、逐镜确认、拼接和送达建立特征测试。
- 保存一份完整小狐狸项目金样。
- 运行 `audit-local-stack`，固定 Harness 包版本、聊天 model id、ComfyUI 节点/模型、manifest hash 和 `verifiedAt`；未通过项不得标成 runtime verified。

**阶段 0 量化测试基线**（参考《调研-Harness网关与短剧数据底座》§4.1 现有生产能力清单）：

| 测试类别 | 最低用例数 | 覆盖范围 |
| --- | --- | --- |
| 工具注册与调用 | ≥16（每个现有工具至少 1 条） | 所有已注册工具的基本调用链 |
| 画布状态读写 | ≥8 | canvas_set_state / canvas_get_state 全部动作类型 |
| Skill 加载与卸载 | ≥3 | 3d-animation-short-generator 加载、参数传递、卸载 |
| 单镜生成端到端 | ≥4（t2i×1, i2i×1, r2v×1, i2v×1） | 四种生成形状各一条完整链路 |
| 重做/替换/废弃 | ≥6（每种操作×2 场景） | 正常重做、跨镜重做、替换后续接、废弃回退 |
| 资产物化与引用 | ≥4 | 角色卡锁定、场景卡锁定、镜头批准、引用完整性 |
| 拼接与送达 | ≥3 | FFmpeg stream copy、重编码回退、ComfyUI 拼接 |
| 崩溃恢复 | ≥3 | queued/running/downloading 三阶段中断后恢复 |
| 金样回归 | 1（完整 30 秒短剧） | 从创意到交付的全流程 |

**Domain Storage 运行时探测规格**

在阶段 0 必须完成以下 Domain Storage 探测，结果写入 `audit-local-stack` 报告：

| 探测项 | 方法 | 通过标准 | 失败处置 |
| --- | --- | --- | --- |
| 单值大小上限 | 写入 1 KB → 64 KB → 256 KB → 1 MB → 4 MB 递增 JSON 值，记录首次失败的阈值 | 确认 Project 聚合 ≤ 阈值的 80%；若阈值 < 1 MB 则架构不可行 | 中止迁移，输出实际上限；>1 MB 但接近上限时启用 JSON 压缩或分片策略 |
| 原子 read-modify-write | 两个并发 `KvTable.update` 写同一 key，验证 serial write chain 是否保证一个成功一个被拒 | 不得出现静默覆盖（lost update） | 若出现 lost update，必须在插件层加版本号 CAS |
| revision 单调递增 | 连续 10 次 update，验证 revision 严格单调递增 | 无跳跃、无回退 | 若 revision 语义不符预期，插件自维护 revision |
| schema version 不匹配 | 写入 `schemaVersion: 2` 的记录，以 `schemaVersion: 1` 的旧代码读取 | 旧代码可读取但触发迁移路径，不 crash | 若 crash，添加 schema 版本守卫 |
| crash recovery 完整性 | 在 `update` 回调中 `process.exit(1)` 模拟崩溃，重启后读取 | 值为上次成功提交的状态，不为空或损坏 | 若损坏，启用 write-ahead snapshot |
| 空 domain 首次读取 | 未初始化的 domain 读取 | 返回 `undefined` 或空对象，不 throw | 若 throw，包装为 `ProjectNotFound` |

探测脚本命名为 `scripts/probe-domain-storage.js`，输出结构化 JSON 报告。

阶段 0 退出标准：上表全部用例通过，Domain Storage 探测全部通过，且 `audit-local-stack` 报告无 `runtime_verified` 缺失。

### 阶段 1：文件入口与 Project Domain

- 建 locator、File Service 和逻辑布局。
- 建完整 Project 聚合骨架、revision、单写者租约、commandId 幂等和领域命令。
- 原 HTTP route 立即接入 `LegacyCanvasCommandAdapter`；UI 外观不变，但停止直接写 `project.json`。
- 迁移后的旧文件只读；不做新旧数据双写。

**LegacyCanvasCommandAdapter 路由映射表**

以下表格定义了现有 HTTP 路由 / 工具调用到领域命令的完整映射。Adapter 收到旧请求后，将参数翻译为领域命令 payload，通过 `Project.update` 写入 Domain Storage。

| 现有入口 | 方法 | 映射的领域命令 | 参数翻译说明 |
| --- | --- | --- | --- |
| `/canvas` (GET) | GET | 读模型查询（无命令） | 整个 Project 聚合 → 旧 `{settings, nodes}` 格式转换 |
| `/canvas/node` (POST) | POST | `upsertShot` / `upsertCharacter` / `upsertLocation` | 按 `body.group` 分流：角色组 → `upsertCharacter`，场景组 → `upsertLocation`，镜头组 → `upsertShot`；`body.params` 映射至对应实体字段 |
| `/canvas/group` (POST) | POST | 批量 `upsertShot`（更新 group 字段） | `body.nodeIds` 逐个映射为 Shot/Character/Location 的 group 更新 |
| `/canvas/reorder` (POST) | POST | `upsertEpisode`（更新 shotOrder） | `body.nodeIds` 顺序 → Episode 的 `shotOrder` 数组 |
| `/canvas/node` (DELETE) | DELETE | `upsertShot` (status → `deleted`) | 不物理删除，标记删除；触发 `invalidateDependents` |
| `/canvas/upload` (POST) | POST | `upsertCharacterState` / `upsertLocation` | 上传的参考图 → CharacterState 或 Location 的参考 Asset |
| `/assets` (GET) | GET | 读模型查询（无命令） | Asset 库 → 旧格式 `{assets: [...]}` |
| `/assets` (POST) | POST | `approveShotAsset` + `createReviewTask` | 画布节点入库 → 创建 Asset + ReviewTask（自动批准） |
| `/assets` (DELETE) | DELETE | `upsertShot` (解除 Asset 引用) | 资产删除 → 解除引用，Asset 标记 `archived` |
| `/assets/to-canvas` (POST) | POST | 读模型查询（无命令） | 资产物化到画布为纯 UI 操作，不改变领域状态 |
| `/canvas/node/replace-image` (POST) | POST | `createGenerationAttempt` → `completeGenerationAttempt` | 本地替换图 → 新 Attempt（source: `manual-upload`），立即完成 |
| `/generate/image` (POST) | POST | `createGenerationAttempt` → `markAttemptSubmitted` | `body.prompt` → Attempt payload；ComfyUI 提交后写 `promptId` |
| `/generate/video` (POST) | POST | `createGenerationAttempt` → `markAttemptSubmitted` | `body.type` → capability 映射；其余同图片生成 |
| `canvas_get_state` (Tool) | Tool | 读模型查询（无命令） | `project.settings` → `ProductionSpec` 字段子集 |
| `canvas_set_state` (Tool) | Tool | `updateProductionSpec` | `aspectRatio/duration/audioMode/mode` → ProductionSpec 对应字段 |
| `comfy_generate_image` (Tool) | Tool | `createGenerationAttempt` → `markAttemptSubmitted` | 同 `/generate/image` |
| `comfy_generate_video` (Tool) | Tool | `createGenerationAttempt` → `markAttemptSubmitted` | 同 `/generate/video` |

**Adapter 实现约束**：
- Adapter 是临时兼容层，每个被适配的路由必须有对应的集成测试。
- 阶段 5 统计仍走 Adapter 的路由；全部切换并通过金样后才删除 Adapter。
- Adapter 不得绕过领域命令直接写 Domain Storage。
- 旧 `project.json` 读写函数 (`loadProject/saveProject`) 在 Adapter 中仅用于迁移读取，不用于新写入。

### 阶段 2：Attempt 与恢复

- 生成前创建 Attempt。
- 持久化 prompt id。
- 完成启动恢复扫描。
- 对所有中断点做故障注入。
- 落地 Project 内 OutboxEvent 与单进程 dispatcher，对“副作用成功、状态提交失败”做对账恢复。

### 阶段 3：Asset、Review 和血缘

- 候选媒体与批准媒体分离。
- 人工选择落 ReviewDecision。
- 上游修改自动失效下游。
- 实现 RightsRecord、年龄/许可硬门和 hash-chain 审计。

### 阶段 4：Timeline 与 Deliverable

- Timeline 只使用批准 Asset。
- 拼接、超分和静音全部成为派生 Asset。
- 交付保存 revision、hash 和质量报告。
- 实现磁盘预算、引用重算、Trash、归档和恢复校验。

### 阶段 5：批量迁移与兼容层收口

- 显式选择旧 workspace。
- 迁移 `project.json` 和 `.dsh-assets`。
- 对比全部参数、血缘、泳道、顺序、批准和送达状态。
- 验证后保留旧数据，用户自行决定何时删除。
- 统计仍走兼容 adapter 的路由；全部切换并通过金样后才删除 adapter。

### 阶段 6：最后调整 UI

- UI 改读 read model。
- 所有操作改发领域命令。
- 增加 Attempt、恢复、磁盘和血缘诊断。
- 增加 Review、Rights、Deliverable、Outbox dead-letter 和审计链校验页。

## 21. 验证矩阵

### 21.1 纯逻辑测试

- manifest schema 和 graph 编译。
- capability/tier/shape 参数组合。
- 状态机合法与非法转换。
- revision 冲突。
- 幂等键稳定性。
- 血缘失效集合。
- Timeline 只接受 approved Asset。
- 成人确认和 RightsRecord 硬门。
- Project、Asset、ReviewTask、Timeline、Deliverable、OutboxEvent、RightsRecord 全部状态机。
- 同一 commandId 重放与 payload 冲突。
- outbox 重试、dead-letter 和副作用对账。
- 审计 hash chain 修改、截断和 checkpoint 校验。

### 21.2 文件故障测试

- 路径逃逸。
- 只读目录。
- 磁盘空间不足。
- 下载中断。
- 临时文件损坏。
- 原子 rename 失败。
- 数据迁移失败与回滚。
- 双进程争抢租约、持有者崩溃、陈旧锁安全回收和只读降级。
- 70/85/95% 可配置水位、cache LRU、引用重算、Trash 恢复和硬删前复检。
- archive 导出/导入的逐文件 hash 校验。

### 21.3 ComfyUI 集成测试

- 不可达。
- workflow 缺节点或缺模型。
- `/prompt` 明确失败。
- 提交响应丢失。
- history 返回错误。
- 超时和取消。
- 输出缺失或媒体损坏。
- 插件/Harness 在 queued、running、downloading 阶段分别退出后恢复。

### 21.4 金样测试

固定一条 30 秒短剧，从创意到交付覆盖：

- 项目简报。
- 故事大纲。
- Qwen-Image 2.1 角色卡和场景卡。
- 七列镜头表及十项自检。
- 文本分镜。
- MiniMax H3 逐镜生成和音轨。
- 每镜抽帧、自检和人工批准。
- 连续镜头与跨场景转场。
- 超分、拼接和真正静音导出。
- Harness 重启后继续。
- 最终 Deliverable hash 和质量报告。

### 21.5 两集三分钟短剧的可重复执行演练

本节把 `2026-10-02` 的架构推演固化为回归场景。它不是一次性文档示例；每次完成数据层、执行层、审核层或 Harness 集成的重要编码后，都必须用**当时真实代码和运行服务**重新演练，并重新判断基础创作、故障恢复和 Harness 融合程度。不得用本节目标流程或 mock 通过代替实现证据。

#### 固定输入与规模假设

固定用户输入：

> 创建一部穿越短剧，只有 2 集，每集 3 分钟。

首次执行必须通过 Harness Ask User 补齐穿越方向、画幅、风格、受众、内容分级、音频策略、真人/声音/品牌权利和交付方式；未确认前不得开始付费或耗时生成。测试默认选择 9:16、24fps、H3 原生音视频、无真人参考和声音克隆、两集分别交付。镜头数由批准后的镜头表决定；容量规划按平均约 5 秒一镜估算为每集约 36 镜、总计约 72 镜，不把该数字写成领域硬限制。

#### 必须观察到的完整执行链

```text
用户输入
  → Harness Goal（本会话目标）+ Todo（当前轮进度）
  → Ask User / Approval 补齐并确认规格
  → createProject / updateProductionSpec / recordRights
  → StoryBible
  → Character / CharacterState / Location
  → Episode 01 / Episode 02
  → 剧本 ReviewTask / ReviewDecision
  → 两集 Shot 与 continuityFrom 依赖图
  → 镜头表 ReviewTask / ReviewDecision
  → 角色卡、场景卡、分镜 GenerationAttempt
  → 候选 Asset → 自动检查 → 人工 ReviewDecision
  → 逐镜 GenerationAttempt(created → submitting → queued → running)
  → ComfyUI 输出 → tmp 下载 → hash/媒体校验 → 原子发布
  → 候选视频 Asset → 首/中/末帧检查 → 人工 ReviewDecision
  → 每集不可变 Timeline revision
  → 拼接/超分/音频/字幕派生 Asset
  → Deliverable(planned → exporting → ready → delivered)
  → Harness Deliverables 展示或发送
```

三类状态必须始终分离：Harness Goal/Todo/Workflow 只表示会话执行；Project Domain 保存 Episode/Shot/Attempt/Review/Timeline 等业务真相；网关/ComfyUI 保存外部执行事实。任一层重启后，都通过稳定 id、revision 和外部任务标识重新对账，禁止从聊天文字或文件名猜测状态。

#### Harness 执行引擎利用检查

| Harness 能力 | 本场景必须承担 | 通过证据 | 禁止误用 |
| --- | --- | --- | --- |
| Agent Loop / LLM Retry | 导演 Agent 决策下一条命令；模型请求瞬时失败重试 | 会话事件与重试记录 | 代替领域命令幂等 |
| Goal / Todo | 保存本会话作品目标；显示当前轮步骤 | Goal/Todo UI 与事件 | 代替 Project、Episode 或 Shot 状态 |
| Skill | 按阶段加载编剧、镜头、图片、H3 prompt 和终检规则 | Skill 加载记录与版本 | 把 Markdown 当持久工作流状态 |
| Subagent | 小说压缩、角色提取、连续性检查等独立任务 | 固定只读输入快照和结构化输出 | 直接写项目文件或共享可变对象 |
| Workflow | 用户明确启用时执行有界、可重放的并行阶段 | workflow run id、输入/输出和终态 | 永不结束的制片守护进程 |
| Jobs | 恢复扫描、媒体探针、导出和诊断 | job id 只携带 project/attempt id | 作为 ComfyUI 或项目任务真值源 |
| Domain Storage | Project 聚合、revision、commandId 结果和恢复状态 | 持久记录及重启后读回 | 保存大型媒体字节 |
| Projection / UI Slots | 画布、镜头队列、审核队列和诊断读模型 | 可重建 projection 与 UI 截图 | 成为第二套可写真相源 |
| Ask User / Approval | 规格确认、付费生成门和人工审核交互 | 回答被转换为领域命令和 ReviewDecision | 把会话回答本身当业务记录 |
| Attachment / Deliverables | 输入参考文件与展示最终交付物 | Asset 导入记录、Deliverable 引用 | 代替血缘、Timeline 或 Deliverable 实体 |
| Compaction / Spill | 控制长会话上下文和大工具输出 | compact/spill 后仍能从 Project 继续 | 作为崩溃恢复来源 |
| Settings / Credentials | 模型、网关和密钥引用 | 配置来源审计；Project 内无 secret | 保存项目生产状态 |

#### 必须注入的中断与人工返工

每次完整复验至少覆盖以下故障；所有用例均需记录中断前 revision、Attempt/Review 状态、恢复动作、恢复后 revision、是否重复提交以及最终 Deliverable hash：

1. LLM 在生成剧本途中断网，确认 Harness 重试或恢复后不产生半条领域命令。
2. 工具提交成功但 Agent 未收到响应，以相同 `commandId` 重放并返回原结果。
3. `/prompt` 调用前断网，Attempt 保持 `created`，恢复后只提交一次。
4. ComfyUI 已接收请求但响应丢失，Attempt 进入 `submission_unknown`；无法唯一核对时暂停人工确认，禁止盲目重提。
5. 已持久化 `promptId` 后终止 Harness/插件进程，重启扫描从 history 继续。
6. 在 `queued`、`running`、`downloading` 各中断一次，恢复后不重复生成且不发布半文件。
7. 剧本审核驳回，修改 Episode 后对应 Shot/Asset/Timeline 下游显式失效。
8. 角色卡、分镜图和任一中段视频分别驳回；旧候选保留，新 Attempt 替换，连续链按依赖顺序重建。
9. VLM 检查失败或不可用，ReviewTask 转 `awaiting_human`，不得自动通过。
10. 用户离开或 Approval 无 answerer，Agent turn 正常结束；从画布审核队列或新会话继续。
11. 两个进程同时打开 Project，只有租约持有者可写；陈旧 revision 明确冲突。
12. 下载损坏、原子 rename 失败和磁盘达到 critical 水位，不产生 current Asset，仍允许清理、归档和恢复。
13. 拼接或送达失败，Timeline 和已生成媒体保持有效，Outbox 重试或进入可见 dead-letter。
14. Project 记录损坏时进入只读修复，禁止回退成空项目。

#### 当前实现基线（2026-10-02）

本次真实代码审查和 `npm run smoke` 的基线结论：

| 判断 | 当前结论 | 证据与缺口 |
| --- | --- | --- |
| 能否完成最基础 AI 短剧创作 | **有条件可以**：在 ComfyUI/模型可用、Agent 不崩溃且有人值守时，可完成简报、大纲、角色/场景卡、镜头表、图片、逐镜视频、连续性、拼接和送达 | smoke 通过；现有工具和 Skills 覆盖顺利路径；尚无两集三分钟真实金样 |
| 是否稳定完成 | **不可以宣称稳定** | 当前生成是 `comfySubmit → comfyWait → 下载 → saveProject`，提交前没有持久 Attempt；`promptId` 中断后丢失；缺少启动恢复、业务幂等、revision、租约、正式 Review/Timeline/Outbox 和故障注入闭环 |
| 是否完全融合 Harness | **未完成** | 宿主当前主要注入 `webServer/tools/systemPrompt/workspaceRegistry`，尚未把 Domain Storage、Goal/Todo、Workflow/Subagent、Jobs、Approval、Projection、Compaction/Spill 组成正式生产执行链 |

因此当前产品定义是“可运行、有人值守的短剧生成原型”，不是“可无人值守、可中断恢复的稳定生产引擎”。该结论只能由后续真实复验改变，不能仅因代码文件或接口名称出现而改写。

#### 编码完成后的真实复验与漂移判断

复验分两层：日常 CI 使用缩短片段和固定 provider double 覆盖所有状态/故障分支；版本验收必须连接实际 Harness Profile、Qwen3.8 网关、ComfyUI、Qwen-Image 2.1 和 MiniMax H3，完成本节两集三分钟场景。实际运行成本或时长不能成为省略版本验收的理由，可以由用户显式决定何时执行。

每次复验在 `docs/audits/runs/<YYYY-MM-DD>-two-episode-traversal.md` 保存人工可读报告，并保存同名 `.json` 机器证据索引。报告至少包含 commit、Harness/Profile 版本、模型/workflow/manifest hash、Project id、起止 revision、72 镜实际数量、Attempt/重试/人工驳回统计、故障注入结果、Timeline/Deliverable hash、日志与媒体证据路径，以及以下三项重新判断：

1. **基础创作**：是否从固定输入真实得到两集可播放、时长达标的 Deliverable。
2. **稳定性**：所有规定中断点是否从持久状态继续，且无重复付费提交、静默丢状态或半成品 current Asset。
3. **Harness 融合**：是否复用上表原生能力，并保持 Harness 执行状态、Project 业务状态和外部任务状态的所有权边界。

出现以下任一项即判定代码相对架构发生漂移，复验不得通过：

- 新业务写路径绕过领域命令、revision 或 commandId。
- UI、Skill、聊天、Todo、Workflow、Job、画布 JSON 或第三方插件成为第二套业务真相源。
- ComfyUI 提交、文件发布或外部送达发生在持久业务意图之前，且没有可对账标识。
- 错误被转换为空项目、默认成功、静默换模型/档位或无提示自动重提。
- Subagent 直接共享可变 Project，或插件自建 Harness 已有的 Agent runtime、任务列表、审批 transport、Workflow/Job 引擎。
- 上游修改后旧 Review、Asset、Timeline 或 Deliverable 仍被当作当前有效版本。
- 只补接口/类型/测试桩，没有真实进程重启、网络中断、人工驳回和实际媒体产物证据。

## 22. 验收标准

1. 聊天只通过 OpenAI 兼容网关访问 Qwen3.8；媒体不经过聊天网关。
2. 图片默认解析到 Qwen-Image 2.1；视频和音频默认解析到 MiniMax H3。
3. 插件通过 manifest 直接编译并提交 ComfyUI workflow。
4. Project 独立于 Harness session，换会话仍能打开同一 Project。
5. 所有业务写入经过领域命令，所有媒体写入经过 File Service。
6. 生成前存在 Attempt；插件崩溃后不靠聊天文本猜测状态。
7. 相同幂等键不会重复提交可确认的任务。
8. 候选 Asset 未经 ReviewDecision 不得进入 Timeline。
9. 上游角色、场景或链式镜头变化会显式失效下游。
10. 拼接只使用当前批准且画质一致的 Asset。
11. `silent` 与“无音轨”语义区分清楚。
12. 成人内容项目缺成年确认或权利记录时不得生成或交付。
13. 不创建或依赖已删除的历史固定存储目录。
14. 不引入 Temporal、Kafka、PostgreSQL、MinIO、Keycloak 或 Kubernetes。
15. 当前 smoke 全部通过；新增故障恢复和金样测试通过。
16. Harness 契约测试固定在已核实版本；升级后未复验不得继续写 Project。
17. Qwen3.8、Qwen-Image 2.1、MiniMax H3 只有通过运行时探测并写入 `verifiedAt + hash` 才能作为默认能力。
18. Project 同时只允许一个写进程；第二个进程明确只读，陈旧锁不会仅凭超时被抢占。
19. 领域状态与副作用通过 outbox 对账；任何 dead-letter 在 UI 可见。
20. 旧 UI 从阶段 1 起即经 compatibility adapter 发领域命令，不存在新旧双写。
21. GC 不自动删除 source、current approved、Timeline、Deliverable 或 Rights 证据；Project 删除前可验证归档。
22. Rights、年龄、许可范围、撤销、sidecar provenance 和审计链均可检查；产品不声称本地日志为 WORM。
23. `audioStrategy` 切换不丢失已生成镜头；独立 TTS/BGM 音轨作为派生 Asset 保留血缘。
24. VLM 结构化自检结果通过 `recordAutomatedCheck` 持久化，人工审核可查看自检报告。
25. 长文本输入经过结构化压缩后保留原文溯源关系。
26. NLE 导出预设生成的工程文件使用相对路径，可在对应 NLE 中直接打开。
27. 运行时健康快照异常时暂停自动生成并通知用户。
28. 任意视觉检查 adapter 均输出统一 schema、版本和输入 hash；不可用时转人工审核，不自动放行。
29. 任意长期记忆或语义检索组件都只召回带 Project revision 的已提交事实；卸载后不影响恢复和交付。
30. 第三方 UI、ComfyUI bridge、浏览器自动化或文件监听不得成为第二个项目状态、任务状态或审批状态所有者。

## 23. 明确非目标

- 多用户协同编辑。
- 租户、组织、支付、积分和计费。
- 多机 GPU 调度。
- 公共互联网服务。
- Kubernetes 部署。
- 分布式消息队列。
- 外部对象存储。
- 独立工作流编排平台。
- 独立能力注册中心服务。
- 在第一阶段重写画布 UI。
- 整体移植任何开源短剧项目。

## 24. 后续扩展门

只有出现对应事实才扩展：

- 多机执行：增加远程 Worker 和任务队列。
- 多用户：增加 Identity、Tenant、RBAC 和审计隔离。
- 海量媒体：把 FileService adapter 换成 S3/MinIO。
- 高并发元数据：把 ProjectRepository 换成 PostgreSQL。
- 长工作流恢复达不到验收：把 AttemptRunner/WorkflowPort 换成 Temporal。
- 多消费者事件：把本地 outbox publisher 接到 NATS/Redis Streams。
- 结构化索引和全文检索在已记录的长篇金样上不达标：再评估本地向量索引；没有规模、延迟、召回率和磁盘预算基准时不引入 Milvus 等独立服务。
- 当前 VLM 自检在固定角色/服装/场景/首尾帧金样上不达标：再审计外部视觉 adapter；只替换 `VisualInspectorPort`，不改变 Review 语义。

这些扩展都不得改变 Project、Shot、Attempt、Asset、Review 和 Timeline 的领域语义。

## 25. 一句话结论

本产品不是一个分布式 AI 平台，而是一个建立在 DeepSeek Harness 上的单机短剧制作工作台：Qwen3.8 负责对话和制片决策，插件用本地 manifest 直接驱动 ComfyUI 中的 Qwen-Image 2.1 与 MiniMax H3，Project Domain 保存可恢复的生产状态，画布负责展示和人工审核，File Service 保存媒体，最终在本机完成拼接与交付。
