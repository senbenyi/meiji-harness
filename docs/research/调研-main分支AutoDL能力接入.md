# main 分支 AutoDL 能力接入调研

## 结论

- AC-1 — 已确认 — 当前 `runpod` 分支仅预留空的 `providers/autodl`，加载后会报告 AutoDL 不可用；需要实现完整 provider 契约和服务器声明。
- AC-2 — 已确认 — `main` 的 ComfyUI 连接、原子任务、任务恢复和媒体 URL 基础能力大部分已进入当前公共层，可复用，不应从旧目录整包复制。
- AC-3 — 已确认 — `main` 的 RealVisXL/SDXL 文生图、参考图、角色视图和三视图拼接工作流及模板未进入当前分支；当前自有 ComfyUI provider 没有 `generateImage`，图片会回退到三方渠道。
- AC-4 — 已确认 — `main` 的 MiniMax H3 文生视频、图生视频、单/多镜头、续接、参考音视频、复用视频和合片工作流未完整进入 AutoDL；当前 Runpod 的五种 H3 模式只保留了部分 H3 图构建，不能替代 AutoDL 的完整能力接入。
- AC-5 — 未确认 — 用户确认两台 AutoDL 服务器均正常，且 `main` 已完整运行；当前只核验到 Qwen 服务器，现有本机 `veo-comfyui` 别名仍指向已失效的 RunPod 容器，尚未用第二台 AutoDL 的实际连接做当前运行核验。
- AC-6 — 未验收 — 切换 AutoDL 后的真实文生图、MiniMax H3 文生视频、MiniMax H3 图生视频、工作流恢复和浏览器媒体访问尚未部署或运行。
- AC-7 — 已确认 — 两台 AutoDL 职责分离：Qwen 服务器继续提供聊天/反推，ComfyUI 服务器继续提供 RealVisXL/SDXL 和 MiniMax H3；本任务迁移代码与配置接入，不在 Qwen 服务器重建 H3。

## 规格

- 目标：把 `main` 分支旧工程中仍需要的 AutoDL 创作能力适配到当前 `runpod` 项目分支的 `dsh-elysium/src/servers/providers/autodl`，配置切换到 AutoDL 后，文生图、文生视频及工作流可端到端运行。
- 非目标：
  1. 本调研阶段不修改业务代码。
  2. 本调研阶段不启动或停止远端 Qwen/ComfyUI，不下载模型，不提交 GPU 推理。
  3. 不用旧 `main` 覆盖当前分支的新业务、存储、项目、素材、UI 和多 provider 架构。
  4. 未经确认不删除 Runpod provider、旧任务兼容代码或 AutoDL 上的 Qwen 数据。
  5. 不重新选型或用 Wan2.2 替代已运行的 RealVisXL/SDXL、MiniMax H3；服务器已正常时不重复部署模型和节点。
- 验收标准：
  - AC-1：加载 provider 列表时，AutoDL 为可用；可登记、检查并切换 AutoDL 的 ComfyUI 服务。
  - AC-2：AutoDL 复用当前公共 ComfyUI 协议、任务快照、恢复、原子任务和媒体 URL 链路，且不依赖 Runpod provider 源码。
  - AC-3：选择 AutoDL 图片后，RealVisXL/SDXL 纯文生图、参考图生成/编辑、角色视图和三视图拼接可完成并返回服务器图片 URL。
  - AC-4：选择 AutoDL 视频后，MiniMax H3 文生视频和图生视频，以及 `main` 已有的单/多镜头、续接、参考、复用和合片能力可完成并返回服务器视频 URL；不得用 Wan2.2 替代 H3。
  - AC-5：使用两台 AutoDL 的实际连接完成只读健康检查；Qwen 和 ComfyUI 各自保持原服务器职责，ComfyUI 可由本机 SSH 隧道访问。
  - AC-6：配置切换 AutoDL 后，以真实服务分别完成至少一次文生图、MiniMax H3 文生视频和 MiniMax H3 图生视频；失败恢复沿用原 job/prompt，不重复提交。
  - AC-7：迁移不要求 Qwen 与 ComfyUI 同机，不改动两台服务器既有模型和运行数据；旧服务器配置只切换新任务，旧任务继续使用后端快照。

## 调用链

```text
Harness 工具
├─ workflow_generate_image
│  → resolveGenerationBackend('image')
│  → 当前自有 ComfyUI provider 无 generateImage
│  → 回退 Bailian/BytePlus，未走 AutoDL                         [AC-3 断点]
└─ workflow_generate_video
   → resolveGenerationBackend('video')
   → registry/selection 解析当前服务器
   → runtime 加载 providers/<provider>/index.js
   → provider.validatePlan / executeJob
   → 独立 worker 读取 backend 快照
   → provider.buildGraph
   → 公共 ComfyUI 提交、history 查询、任务恢复
   → 服务端 /view URL → 本机 HTTP 媒体代理/浏览器             [AC-1/2/4/6 判定点]

当前 AutoDL
└─ providers/autodl/.gitkeep
   → 无 definition.json / index.js
   → loader 报 PROVIDER_UNAVAILABLE                            [AC-1 断点]

双 AutoDL 服务器
├─ Qwen 服务器：127.0.0.1:8000 llama-server                 [已只读核验]
└─ ComfyUI 服务器：RealVisXL/SDXL + MiniMax H3             [用户确认正常；待用实际连接核验]

本机当前连接
└─ veo-comfyui 仍指向失效 RunPod，返回 container not found  [AC-5 当前配置断点]
```

## 能力映射

| `main` 能力 | 当前分支状态 | AutoDL 接入要求 |
|---|---|---|
| ComfyUI HTTP client、schema 校验、队列/history、避免重复提交 | 已迁入公共 `src/comfyui` 和 `src/harness/tasks.js` | 直接复用 |
| job 创建、后台 worker、原任务恢复、媒体 URL | 已迁入 `src/business/jobs`、`src/business/video`、HTTP 路由 | 扩展为图片和 AutoDL 视频均可执行 |
| 纯文生图 | 旧 RealVisXL/SDXL 模板已删除；当前自有 provider 不支持图片 | 在 AutoDL provider 恢复原图片 graph、执行与产物收集 |
| 参考图生成/编辑 | 旧 RealVisXL + IPAdapter 模板已删除 | 恢复 `main` 原模板与媒体绑定，不以 Qwen Image/Wan 路线替代 |
| 角色正/侧/背视图、三视图拼接 | 旧 `character.js`、姿态图和模板已删除 | 恢复工具/业务入口和模板；保持身份及最多三次尝试约束 |
| MiniMax H3 文生视频 | 当前 Runpod 支持 H3 `t2va`，AutoDL 空缺 | 将 `main` H3 文生视频能力作为 AutoDL 自有模板与契约接入，不依赖 Runpod provider |
| MiniMax H3 图生视频 | `main` 导演图含 `MiniMaxH3ImageToVideo`，当前 Runpod 有 `i2va`，但 AutoDL 空缺 | 保留首帧绑定、图片条件、音频/VAE 和输出回执，单独做真实 I2V 验收 |
| 多镜头导演编排 | 旧 director graph 已删除 | 恢复 independent/continue/reference/reuse 和每镜头素材绑定 |
| 视频复用、拼接、24→30fps 交付 | 旧 graph/compiler 已删除 | 恢复图构建和回执检查，或以等价 AutoDL 工作流实现 |
| 工作流同步与服务连接 | 当前 provider 仅 Runpod 有实现 | AutoDL 接入已运行的第二台服务器；健康时不重新部署或重启服务 |

## 证据表

| 编号 | 来源 | 支持的结论与边界 |
|---|---|---|
| E-1 | `git rev-parse`、`git log`、`git merge-base` | 当前为 `runpod@196a660`，本地 `main` 与 `origin/main` 均为 `28fcf3e`，且 `main` 是当前分支祖先；工作区调研前无未提交改动。 |
| E-2 | `git ls-tree -r main -- dsh-elysium/src/servers/providers/autodl` | `main` 没有新架构的 AutoDL provider；来源实际是旧 `dsh-elysium-tools` 单体实现。 |
| E-3 | `main:dsh-elysium-tools/src/workflows/*`、`templates/*` | `main` 包含图片生成/参考图、角色视图/拼接、单多镜头视频、续接、参考、复用、合片和任务恢复。 |
| E-4 | `dsh-elysium/src/servers/providers/autodl/.gitkeep`、`tests/runpod-contract.test.js` | 当前 AutoDL 未实现，测试明确断言其 unavailable。 |
| E-5 | `dsh-elysium/src/servers/runtime/index.js:resolveGenerationBackend`、`providers/runpod/index.js` | 自有图片要求 provider 暴露 `generateImage`；Runpod adapter 未提供，因此不能承接文生图。 |
| E-6 | `dsh-elysium/src/servers/providers/runpod/workflows/minimax-h3/*` | 当前 Runpod 工作流只覆盖新的 H3 模式/档位，不等价于 `main` 的导演、复用和合片图。 |
| E-7 | `main:app/config/harness-settings.yaml`、`main:docs/harness.md` | `main` 将 ComfyUI 与 Qwen 配置为两个独立 SSH 目标：ComfyUI 使用 `veo-comfyui:6016`，Qwen 使用 `veo-qwen38:8000`；迁移必须保留双服务器职责。 |
| E-8 | 只读 SSH：`veo-qwen38` 的监听与进程 | Qwen AutoDL 当前由 127.0.0.1:8000 提供服务；该服务器没有 ComfyUI是正常职责边界，不是部署缺陷。 |
| E-9 | 用户补充；本机 `~/.ssh/config` 与 `ssh veo-comfyui` 只读检查 | 用户确认两台 AutoDL 均正常且 `main` 已完整运行；当前本机别名只登记一个可用 AutoDL，`veo-comfyui` 仍解析到 RunPod 网关并返回 `container not found`。服务器状态与本机入口需要分别处理。 |
| E-10 | `main:dsh-elysium-tools/src/workflows/templates/workflow_generate_image*.json`、`workflow_generate_video.json`、`video-graph.js` | 文生图绑定 `RealVisXL_V5.0_fp16.safetensors`；H3 视频绑定主模型、Qwen3VL 编码器、视频/音频 VAE，并通过 `MiniMaxH3ImageToVideo` 接收图片条件。 |
| E-11 | `docs/research/调研-MiniMax-H3文章与veo-comfyui现状差异.md`、`调研-H3服务器执行流程与耗时.md` | 历史 H3 质量档在 RTX 3090 上跑通过 T2VA；主模型约 22.5GB、编码器约 15.7GB。历史 T2VA 结果不能替代 AutoDL 上的 I2V 和文生图验收。 |

## 问题

| AC | 预期 | 实际 | 状态 | 根因 | 证据 |
|---|---|---|---|---|---|
| AC-1 | AutoDL 可被发现、登记、切换 | 仅空目录，loader 判不可用 | 已确认 | provider 契约未实现 | E-4 |
| AC-2 | 复用公共链路且与 Runpod 解耦 | 公共链路已具备，测试 fixture 证明可替换；真实 AutoDL 未实现 | 已确认 | 缺真实 adapter | E-4、E-5 |
| AC-3 | AutoDL 完整文生图 | 旧 RealVisXL/SDXL 图片 graph/templates/角色工具已删除，自有图片会回退三方 | 已确认 | 重构时未迁入 provider | E-3、E-5、E-10 |
| AC-4 | AutoDL 完整 MiniMax H3 文生/图生视频与导演工作流 | H3 模板只属于 Runpod，AutoDL 没有实现；旧导演图未完整保留 | 已确认 | 旧图构建与 AutoDL provider 均缺失 | E-3、E-6、E-10 |
| AC-5 | 两台 AutoDL 现有服务通过实际连接可达 | Qwen 已核验；ComfyUI 由用户确认正常，但本机仍使用失效 RunPod 别名 | 未确认 | 当前本机缺第二台 AutoDL 的有效连接映射 | E-7、E-8、E-9 |
| AC-6 | 切换后真实端到端生成 | 尚未实施 | 未验收 | 依赖 AC-1～AC-5 | E-1～E-10 |
| AC-7 | 保持双机职责并只迁移能力 | Qwen 与 ComfyUI 原本就是两台独立 AutoDL | 已确认 | 不需要同机部署或共享显存/数据盘 | E-7、E-8、E-9 |

## 人工介入

1. 模型路线已由用户确认：恢复 `main` 的 RealVisXL/SDXL 文生图和 MiniMax H3 文生/图生视频能力，不用 Wan2.2 替代。
2. 两台 AutoDL 均由用户确认正常；实施运行验收前，需要让本机配置指向第二台 AutoDL 的实际 SSH 入口。不得输出或把连接凭据写入仓库。
3. 无需扩容 Qwen 服务器、无需让 Qwen/ComfyUI 同机运行，也无需重新部署健康的模型服务。

## 下一步

编写分阶段实施计划：先实现独立 AutoDL provider 和双服务器配置迁移，再接 RealVisXL/SDXL 文生图，再接 MiniMax H3 文生视频、图生视频和导演工作流，最后连接两台现有 AutoDL 做三类真实生成与恢复验收；健康服务不重建。
