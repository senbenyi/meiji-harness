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

### 10.4 必须实现的领域命令

- `createProject`
- `updateProductionSpec`
- `upsertStoryBible`
- `upsertCharacter`
- `upsertCharacterState`
- `upsertLocation`
- `upsertEpisode`
- `upsertShot`
- `createGenerationAttempt`
- `markAttemptSubmitted`
- `completeGenerationAttempt`
- `failGenerationAttempt`
- `createReviewTask`
- `recordReviewDecision`
- `recordAutomatedCheck`
- `approveShotAsset`
- `invalidateDependents`
- `assembleTimeline`
- `recordDeliverable`
- `recordRights`

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

阶段 0 退出标准：上表全部用例通过，且 `audit-local-stack` 报告无 `runtime_verified` 缺失。

### 阶段 1：文件入口与 Project Domain

- 建 locator、File Service 和逻辑布局。
- 建完整 Project 聚合骨架、revision、单写者租约、commandId 幂等和领域命令。
- 原 HTTP route 立即接入 `LegacyCanvasCommandAdapter`；UI 外观不变，但停止直接写 `project.json`。
- 迁移后的旧文件只读；不做新旧数据双写。

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

这些扩展都不得改变 Project、Shot、Attempt、Asset、Review 和 Timeline 的领域语义。

## 25. 一句话结论

本产品不是一个分布式 AI 平台，而是一个建立在 DeepSeek Harness 上的单机短剧制作工作台：Qwen3.8 负责对话和制片决策，插件用本地 manifest 直接驱动 ComfyUI 中的 Qwen-Image 2.1 与 MiniMax H3，Project Domain 保存可恢复的生产状态，画布负责展示和人工审核，File Service 保存媒体，最终在本机完成拼接与交付。
