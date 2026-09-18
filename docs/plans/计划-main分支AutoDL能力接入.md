# main 分支 AutoDL 能力接入

- 类型：新功能
- 目标：把 `main` 已完整运行的双 AutoDL 文生图、MiniMax H3 文生/图生视频及工作流能力迁入当前分支的独立 AutoDL provider，切换配置后继续使用现有两台服务器。
- 调研来源：`docs/research/调研-main分支AutoDL能力接入.md`

## 人工决策

- 模型路线已确认：RealVisXL/SDXL 文生图与 MiniMax H3 文生/图生视频，不使用 Wan2.2 替代。
- 两台 AutoDL 服务不重建、不搬到同一服务器；Qwen 与 ComfyUI 保持原职责。
- 运行验收前，本机必须具备第二台 AutoDL ComfyUI 的有效 SSH 别名或 HTTP 地址。当前 `veo-comfyui` 仍指向失效 RunPod；实际地址和凭据只写本机配置，不进入仓库。

## 执行步骤

### 阶段 1：建立独立 AutoDL provider

1. `dsh-elysium/src/servers/providers/autodl/definition.json` — 新增：声明 AutoDL 的 `comfyui` 与 `llm` 服务、MiniMax H3 workload、Qwen 模型和连接检查计划 → AC-1、AC-7。
2. `dsh-elysium/src/servers/providers/autodl/config.js` — 新增：校验双服务器的服务身份和连接参数，不包含真实主机、端口或凭据 → AC-1、AC-7。
3. `dsh-elysium/src/servers/providers/autodl/index.js` — 新增：组合 AutoDL 契约、图片能力、H3 图构建、公共连接和任务执行；不导入 Runpod provider → AC-1、AC-2。
4. `dsh-elysium/src/servers/providers/autodl/guidance.js` — 新增：向创作工具提供 AutoDL 文生图和 MiniMax H3 模式说明 → AC-3、AC-4。
5. `dsh-elysium/src/servers/providers/autodl/server.example.json` — 新增：只提供双服务器登记字段示例，不保存真实地址、SSH 身份或凭据 → AC-1、AC-7。
6. `dsh-elysium/tests/autodl-contract.test.js` — 新增：验证 provider 可发现、契约完整、双服务可校验且与 Runpod 物理解耦 → AC-1、AC-2。
7. `dsh-elysium/tests/runpod-contract.test.js`、`server-routes.test.js`、`provider-removal.test.js` — 修改：AutoDL 从 unavailable 占位改为真实可用 provider，并验证删除 Runpod 后真实 AutoDL adapter 仍可完成公共业务链 → AC-1、AC-2。

验证：运行 AutoDL 契约、provider 边界、删除 Runpod 和服务器路由测试；预期 AutoDL 可发现且源码不依赖 Runpod → AC-1、AC-2。

### 阶段 2：迁移 RealVisXL/SDXL 文生图能力

1. `dsh-elysium/src/servers/providers/autodl/workflows/image/plan.js` — 新增：迁移 `main` 的文生图、参考图、角色视图和拼接参数校验 → AC-3。
2. `dsh-elysium/src/servers/providers/autodl/workflows/image/graph.js` — 新增：迁移 RealVisXL/SDXL、IPAdapter、OpenPose 和纯拼接图构建，输出路径绑定当前 job ID → AC-3。
3. `dsh-elysium/src/servers/providers/autodl/workflows/image/execution.js`、`artifacts.js` — 新增：复用公共 ComfyUI 提交/恢复协议，写入图片任务状态并只返回服务器 URL → AC-2、AC-3、AC-6。
4. `dsh-elysium/src/servers/providers/autodl/workflows/image/templates/`、`poses/` — 新增：从 `main` 原样迁移文生图、参考图、角色正/侧/背和三视图拼接模板及姿态资产，不删减原始字段 → AC-3。
5. `dsh-elysium/src/harness/character.js`、`harness/index.js`、`utils/agent.js` — 新增/修改：恢复角色视图和三视图工具及按需发现，保持同一正面身份、视角绑定和最多三次尝试约束 → AC-3。
6. `dsh-elysium/src/harness/image.js` — 修改：AutoDL 自有图片优先走 provider 图片执行；恢复任务继续使用原 backend 快照，不回退三方重发 → AC-2、AC-3、AC-6。
7. `dsh-elysium/tests/autodl-image.test.js`、`autodl-character.test.js` — 新增：覆盖纯文生图、参考图、角色视图、三视图拼接、失败恢复和服务器 URL → AC-3、AC-6。

验证：运行图片和角色专项测试，模拟 ComfyUI 校验实际 graph、prompt identity、产物类型和恢复次数；模板逐字节/关键字段与 `main` 对照 → AC-2、AC-3。

### 阶段 3：迁移 MiniMax H3 文生与图生视频

1. `dsh-elysium/src/servers/providers/autodl/workflows/minimax-h3/plan.js` — 新增：同时校验当前五种 H3 模式与 `main` 的 independent/continue/reference/reuse 导演计划 → AC-4。
2. `dsh-elysium/src/servers/providers/autodl/workflows/minimax-h3/graph.js`、`workflow.js` — 新增：迁移 `main` 的单镜头/多镜头编译、`MiniMaxH3ImageToVideo` 图片条件、参考媒体、续接、复用、合片和交付帧率逻辑 → AC-4。
3. `dsh-elysium/src/servers/providers/autodl/workflows/minimax-h3/templates/` — 新增：保存 AutoDL 自有的 T2VA、I2VA、FL2VA、FL2VA-loop、R2VA、单镜头和导演模板，不引用 Runpod 兄弟目录 → AC-2、AC-4。
4. `dsh-elysium/src/harness/video.js` — 修改：在保留当前 `mode/profile` 参数的同时恢复 `main` 的多镜头计划入口；参数分支互斥且不静默降级 → AC-4。
5. `dsh-elysium/src/business/video/plan.js` — 修改：保留公共模式词汇，把具体 H3/导演参数校验交给 AutoDL provider → AC-2、AC-4。
6. `dsh-elysium/tests/autodl-h3-video.test.js`、`autodl-h3-director.test.js` — 新增：覆盖 T2VA、I2VA、首尾帧、参考图、多镜头续接、素材复用、音轨与合片 → AC-4。

验证：运行 H3 专项测试，逐项检查提示词、图片条件、素材绑定、输出节点、帧率和 job 路径；确认 AutoDL provider 在删除 Runpod 目录后仍能构图 → AC-2、AC-4。

### 阶段 4：接入工作流同步与任务生命周期

1. `dsh-elysium/src/servers/providers/autodl/workflows/sync.mjs` — 新增：同步/校验 AutoDL 工作流模板，不启动服务、不下载模型 → AC-4、AC-5。
2. `dsh-elysium/src/servers/providers/autodl/index.js` — 修改：按图片/视频计划分派执行器，公开 `generateImage`、同步和来源指纹能力 → AC-2、AC-3、AC-4。
3. `dsh-elysium/src/business/jobs/diagnostics.js`、`servers/runtime/loader.js` — 仅在专项测试证明必要时修改：确保 AutoDL 图片和视频模板都进入代码指纹；不硬编码 provider 名称 → AC-2、AC-6。
4. `dsh-elysium/tests/autodl-workflow-sync.test.js`、`execution-metadata.test.js`、`video-retry.test.js` — 新增/修改：验证模板同步、代码指纹、丢失提交响应、失败恢复和旧 backend 固定 → AC-2、AC-4、AC-6。

验证：运行工作流同步、执行元数据、恢复和重复提交防护测试；预期恢复只查询/接管原 prompt，不产生第二次 POST → AC-2、AC-6。

### 阶段 5：切换本机双 AutoDL 配置

1. `dsh-elysium/config/defaults.json` — 修改：补全可展示的 AutoDL 图片与视频模型名称；不写真实服务器地址 → AC-1、AC-3、AC-4。
2. `~/.dsh/storages/elysium/config/settings.json` — 运行时修改：通过现有设置存储/CAS 登记 Qwen AutoDL 与 ComfyUI AutoDL，图片和视频选择同一 ComfyUI 服务器，聊天继续选择 Qwen 服务器 → AC-1、AC-5、AC-7。
3. `~/.ssh/config` — 运行时修改：仅在用户提供或本机已有第二台 AutoDL 实际入口时，把 ComfyUI 别名指向该实例；权限保持 `0600`，不输出凭据 → AC-5、AC-7。
4. `dsh-elysium/tests/settings-store.test.js`、`servers-config.test.js`、`server-switch.test.js` — 修改：覆盖同一 provider 的双服务器登记、图片/视频共同选择和旧任务快照保持 → AC-1、AC-7。

验证：先只读检查两台服务器；再通过服务器设置执行 check/switch，确认新任务选择 AutoDL，旧任务 backend 文件不变 → AC-1、AC-5、AC-7。

### 阶段 6：构建、发布与真实端到端验收

1. `dsh-elysium/package.json`、`scripts/package-registry.mjs` — 仅在现有自动发现未包含二进制姿态资产时修改：确保 AutoDL 源码、JSON 和姿态图进入发布包 → AC-2、AC-3、AC-4。
2. `dsh-elysium/README.md`、根 `README.md` — 修改：记录双 AutoDL 职责、配置切换和验证入口，不记录真实主机或凭据 → AC-5、AC-7。
3. 执行 `pnpm test`、`pnpm build`、`pnpm package:registry` 和 Harness 测试，检查发布包中 AutoDL provider 完整且无 tests/legacy 泄漏 → AC-1～AC-7。
4. 安装发布包并重启本机 Harness；不重启健康的远端模型服务 → AC-5、AC-6。
5. 用现有两台 AutoDL 真实执行：一张纯文生图、一条 MiniMax H3 T2VA、一条以该图片作为首帧的 I2VA；分别核对 job/prompt、服务器 URL、浏览器读取和任务详情 → AC-3、AC-4、AC-6。
6. 对一个已提交任务中断本机等待后恢复，确认沿用原 prompt/job 且 POST 次数不增加 → AC-2、AC-6。

验证：三类真实生成和一次恢复全部通过，才判定“当前分支切换 AutoDL 后正常使用”；代码测试或空载检查不能替代真实生成证据 → AC-1～AC-7。

## 验收标准

- AC-1：加载 provider 列表时，AutoDL 为可用；可登记、检查并切换 AutoDL 的 ComfyUI 服务。
- AC-2：AutoDL 复用当前公共 ComfyUI 协议、任务快照、恢复、原子任务和媒体 URL 链路，且不依赖 Runpod provider 源码。
- AC-3：选择 AutoDL 图片后，RealVisXL/SDXL 纯文生图、参考图生成/编辑、角色视图和三视图拼接可完成并返回服务器图片 URL。
- AC-4：选择 AutoDL 视频后，MiniMax H3 文生视频和图生视频，以及 `main` 已有的单/多镜头、续接、参考、复用和合片能力可完成并返回服务器视频 URL；不得用 Wan2.2 替代 H3。
- AC-5：使用两台 AutoDL 的实际连接完成只读健康检查；Qwen 和 ComfyUI 各自保持原服务器职责，ComfyUI 可由本机 SSH 隧道访问。
- AC-6：配置切换 AutoDL 后，以真实服务分别完成至少一次文生图、MiniMax H3 文生视频和 MiniMax H3 图生视频；失败恢复沿用原 job/prompt，不重复提交。
- AC-7：迁移不要求 Qwen 与 ComfyUI 同机，不改动两台服务器既有模型和运行数据；旧服务器配置只切换新任务，旧任务继续使用后端快照。

## 验证结果

- 2026-09-18：AutoDL provider、RealVisXL/SDXL 图片、角色三视图、五种 H3 模式、main 导演计划和工作流同步已落地。
- `pnpm test`：181/181 通过；包含 AutoDL 模板字节校验、T2V、I2V、多镜头续接、物理删除 Runpod 和恢复防重复提交测试。
- `pnpm build`、`pnpm package:registry`：通过；Registry 包含图片姿态 PNG、图片模板、五种 H3 模板和导演模板。
- Qwen AutoDL 只读连接正常（此前本轮已核验）；私有模型运行目录已补入 RealVisXL/SDXL、MiniMax H3 和既有 qwen3.8，Harness 重启后 `/server/models` 回读及默认展示正确。ComfyUI 未完成真实核验，本机 `veo-comfyui` 仍解析为失效 RunPod，历史 AutoDL SSH 入口连接被拒绝；尚未登记或切换图片/视频服务器，也没有执行真实 T2I/T2V/I2V。
- `qwen38-local` 已改用当前 `dsh-llm-pi-ai` 支持的 `apiKeyEnv`，Harness 启动环境提供本地占位凭据；重新安装并重启后，DSH headless 经默认模型真实调用返回 `QWEN38_OK`，原 `No API key for provider: qwen38-local` 已消除。
