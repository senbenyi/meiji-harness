# 都市生日夜完整流程验收

## 2026-10-07 自主闭环审计与根因修复

### 计划

- [ ] 还原本次真实 Pilot 中 Codex 的全部介入，逐项标注为观察、恢复、状态推动、代码修复或产物补偿。
- [ ] 对照目标链路审计入口、Harness Workflow、持久状态、恢复入口、媒体 Worker、交付与画布，找出所有依赖聊天/Codex 生命周期的执行断点。
- [ ] 写出失败复现测试：一次运营 UI 发起后，不再调用任何内部工具也能持续执行；进程重启后由系统自行恢复；失败必须可见且可由 UI 单次重试唤醒。
- [ ] 只实施支撑 AI 短剧自主闭环所需的最小根因修复，不引入通用调度平台。
- [ ] 运行聚焦测试、完整测试与 smoke，重新安装插件并重启服务。
- [ ] 在 `http://127.0.0.1:3080/` 新建干净会话，由页面单次发起《都市生日夜》；全过程禁止 Codex 调内部 API、改状态、补数据或再次推动。
- [ ] 将运行轨迹、重启恢复、正式数据、画布和最终成片证据写入回顾，并严格给出 PASS / FAIL / BLOCKED。

### 自主验收门槛

- 运营只负责上传/选择小说并点击或发送一次生产请求；后续推进不依赖 Codex、聊天 Agent 的再次 Tool call 或 shell。
- `studio_novel_create` 返回后，执行所有权仍由 Harness/插件后台生命周期持有，直到成片或明确失败。
- 服务重启后无需新聊天唤醒；同一运行自动恢复未完成项，已完成项不重跑。
- UI 重试是唯一允许的人工恢复动作，且一次动作同时完成状态恢复与执行唤醒。
- 任何代码热修、内部工具调用、数据库/JSON 修改或人工补齐都会使该次验收作废，必须修复后从干净运行重新验证。

> 状态：架构重构已落地，真实流程验收进行中（29/31 文本节点）
> 基线：2026-10-07，`novel-to-drama-text-v1`

## 计划

- [x] 归档受污染的旧会话。
- [x] 完整移除并重新安装 `web` profile 插件，重启 Harness，验证安装包入口可加载。
- [x] 新建会话并确认唯一入口链路：加载 `elysium-generate-drama` → `studio_novel_create` → Harness Workflow。
- [x] 实测定位首个断点：`episode-plan` 两次结构化输出失败；失败后主 Agent错误地继续调用其他工具。
- [ ] 修复 `episode-plan` 动态约束：明确非空、唯一、全部 beat 覆盖及全文 `0..N` 连续覆盖要求。
- [ ] 提升 Pipeline version，确保契约变化不会复用旧任务快照。
- [ ] 修复 `studio_novel_create` 失败协议：成功或失败都结束当前轮次；失败结果保留真实 `projectId` 和可恢复状态，禁止主 Agent脱离唯一入口自行补救。
- [ ] 增加聚焦测试：真实 episode-plan 首次失败后按反馈修正；创建入口失败时终止轮次并返回恢复信息。
- [ ] 运行聚焦测试、`npm run test:all`、`npm run smoke`。
- [ ] 再次完整移除/安装插件并重启 Harness。
- [ ] 归档本次失败会话，新建干净会话；逐阶段验证故事分析、分集规划、分集剧本、资产提取、资产提示词、镜头规划、分镜图片提示词、视频提示词、持久状态和画布。

## 验收标准

- Pipeline 节点严格按依赖解锁，失败重试符合 manifest 策略。
- 不出现 `studio_project_*`、内部 `studio_novel_orchestrate` 或 shell 绕行。
- 每个角色/场景/道具具备图片提示词，每个镜头具备分镜图片提示词和视频提示词。
- Project 的任务、运行、实体、镜头和提示词状态可持久恢复。
- “创作”画布能完整渲染项目，基础流程最终进入可继续媒体生产的稳定状态。

## 回顾

## Durable Workflow 架构重构

- [x] 定义文本生产根 Run 与节点 DAG，根状态聚合所有文本阶段，禁止 bootstrap Run 提前代表完成。
- [x] 实现通用有界 `DurableDagExecutor`：单次领取一个 ready 节点，支持 checkpoint 恢复。
- [x] 将节点成功边界改为 `生成 → Schema 校验 → 业务校验 → Proposal 提交/领域物化 → 物化 checkpoint → completeProductionTask`。
- [x] 为执行器增加失败分类：invalid-output、no-structured-output、timeout、domain-commit、retryable-error、non-retryable。
- [x] 将 Pipeline manifest 编译为持久任务及 handler/validator/commit/retry/concurrency 元数据。
- [x] 统一物化幂等键：绑定 run/task，Proposal 幂等键继续绑定 pipeline/version/node/scope。
- [ ] 将 `studio_novel_create` 改为后台 enqueue-and-return，并让入口与画布只读取同一 Root Run 聚合状态。
- [x] 增加迁移兼容：Pipeline v6 建立独立 DAG，不复用旧 v1-v5 任务或副作用。
- [x] 增加领域、恢复、插件端到端测试；`npm run test:all` 162/162，`npm run smoke` 通过。
- [x] 强制重装插件并从干净会话验证《都市生日夜》至 29/31 文本节点；14 集剧本、旧 ep-04 故障点、失败恢复闭包与画布聚合通过。
- [ ] 完成 ep-13/ep-14、资产提示词、镜头与图片/视频提示词的真实流程；当前恢复仍依赖主 Agent 再次调用入口，画布重试不能自行调度文本 Workflow。

### Durable Workflow 验收标准

- 任一节点仅在正式领域数据已经物化并通过校验后标记 completed。
- 进程/会话中断后，同一入口能够只恢复未完成节点；failed 与 blocked 能按依赖重新进入 ready。
- 根 Run 只有在分析、分集、剧本、资产、资产提示词、分镜、图片提示词、视频提示词全部完成后才是 completed。
- Prompt 不再承担 source offset、usage quote、稳定 id、依赖、版本与状态转移等确定性职责。
- 画布状态与根 Run/Project 正式状态一致，不读取 Agent 文本作为完成依据。

- 已完成领域层、执行器、单一文本 Run、动态 DAG、barrier、物化门禁与画布 Run 展示。
- 自动化验证为 `npm run test:all` 163/163、`npm run smoke` 通过；web profile 安装副本关键文件 hash 与工作区一致。
- 真实项目 `20261007112033897` 的 v6 Root Run 从旧版 ep-04 稳定推进到 29/31；ep-09/ep-10 重试成功，ep-12 通过确定性已知资产恢复完成，completed 节点未重跑。
- 尚未闭环：同步 `studio_novel_create` 结束后，画布“重试任务”只恢复领域状态，无法在没有调用 Agent 上下文时重新启动文本 Workflow；这是下一步入口异步化必须解决的架构断点。

## 2026-10-07 架构复审：彻底闭环生产调度

- [x] 复核真实调用链：入口、Workflow、Worker、领域状态、画布重试及 Agent 生命周期。
- [x] 定义目标架构与职责边界：唯一 Root Run、持久 Controller、Durable Worker、领域提交门禁、统一读模型。
- [x] 明确 Prompt/Skill 与 Schema/Workflow/Domain 各自负责的约束，移除 Prompt 承担的控制面职责。
- [x] 设计崩溃恢复、幂等、并发、版本迁移和人工重试协议。
- [x] 给出分阶段迁移计划、文件级改造范围、测试矩阵和最终验收门槛。
- [x] 在本节补充复审结论和推荐实施顺序。

### 复审结论

- P0 根因是文本生产由聊天 Tool call 同步持有、媒体生产由后台 Worker 持有，形成双执行控制面；领域状态持久化但执行所有权不持久。
- `DurableDagExecutor`、Pipeline Compiler、动态 DAG、物化门禁已有正确基础，不应推倒重来；应将它们接入唯一 `ProductionWorker`。
- 目标态是一条小说到 Deliverable 的 v7 Root Run；所有文本、提示词、媒体和交付任务属于同一 Run，动态展开后再 seal。
- `studio_novel_create` 只 enqueue-and-return；后台 Worker 是唯一执行者；画布重试通过专用应用服务完成 resume + durable wake。
- Skill/Prompt 退回创作与人工交互职责；依赖、重试、幂等、状态、完成门禁全部由 Schema、Pipeline、Validator、Domain 和 Worker 保证。
- 详细设计、迁移次序和测试矩阵见 `docs/plans/2026-10-07-durable-production-architecture.md`。

> 2026-10-07 用户复核：以上目标设计过度平台化，偏离 AI 短剧核心，撤回作为实施方案；仅保留对“双执行控制面”这一现状问题的证据。

## 简化架构重新设计

- [x] 删除通用调度平台式概念，限定为 AI 短剧固定生产阶段。
- [x] 以 Harness Workflow 作为唯一多 Agent 编排器，插件不重复实现通用 DAG Scheduler。
- [x] 只保留阶段级检查点、幂等落库、失败后从首个未完成阶段恢复。
- [x] 明确 Prompt、Skill、Schema、领域状态和画布的最小职责。
- [x] 将架构文档重写为可直接实施的最小方案并记录撤回项。

### 简化方案回顾

- 架构收敛为 5 个组件：入口 Tool、Harness Workflow、Stage Runner、Project Store、Canvas Projection。
- 流程固定为 6 个短剧阶段；episode/shot 只做阶段内 fan-out，不再动态扩展通用 DAG。
- Project 只增加 `activeWorkflowId` 并保存正式业务产物；Workflow 状态、重试、恢复由 Harness 负责。
- `/schemas` 只保存输出结构契约；Skill/Prompt 只负责创作，不承担控制面职责。
- 先验证“小说分析与分集 → 分集剧本”垂直切片，再逐步接入提示词、画布、媒体和交付。

## 《都市生日夜》有限端到端验证计划

- [x] 冻结唯一真实样本、六阶段范围和明确非目标。
- [x] 为 Gate 0-6 定义机器可判定的通过条件。
- [x] 限定为一次 Happy Run 和一次 Recovery Run。
- [x] 定义每个 Gate 最多两轮根因修复和 `BLOCKED` 停止条件。
- [x] 定义自动化测试层级、真实 UI 验收与证据包结构。
- [x] 定义最终 `PASS / FAIL / BLOCKED` 判定规则。

### 验证计划回顾

- 先通过测试、smoke、安装 hash 和新 Project 隔离完成 Gate 0，再启动真实媒体生成。
- Happy Run 必须从源文一直到可读取 Deliverable；Recovery Run 只验证一次文本节点失败和一次服务重启恢复。
- 不接受“29/31”“基本通过”等中间结论；所有六阶段、恢复、画布和证据包完整才是 PASS。
- 详细执行清单见 `docs/plans/2026-10-07-novel-to-drama-e2e-validation.md`。

### 3080 真实 Pilot 第一次执行

- [x] 恢复 3080 Harness 服务并从页面创建全新会话。
- [x] 在页面提交《都市生日夜》1 集、2–3 镜头完整 Pilot 请求。
- [x] 在“轨迹”页核对实际工具调用，而非依据 Agent 回复。
- [x] 首个入口门禁判定为 FAIL，并立即停止被污染的运行。
- 实际轨迹：加载 Skill 后调用 `studio_project_create → bash → studio_source_import → studio_source_read`，没有调用 `studio_novel_create`，没有启动要求的 Harness Workflow。
- 产生的测试 Project：`20261007134926939`；不得作为成功验收结果复用。
- 证据记录：`docs/research/2026-10-07-ui-pilot-validation.md`。

## 3080 唯一入口绕行根因定位

- [x] 对比仓库与已安装的 `elysium-generate-drama` Skill，确认是否存在内容漂移或冲突指令。
- [x] 追踪 `studio_novel_create`、Project/Source 工具和 shell 的注册与可见性策略。
- [x] 核对 root Agent、novel child、production coordinator 三类 Agent 的工具隔离边界。
- [x] 结合页面轨迹还原模型选择手工链路的完整因果链。
- [x] 输出主根因、放大因素、排除项和最小修复边界。

### 根因结论

- P0：所有低层工具对根 Agent 同权可见，唯一入口没有运行时 guard；现有 policy 只保护 orchestrate 启动后的 child。
- P1：Pilot 的 1 集、2–3 镜头范围无法由只接受 `sourcePath/title` 的整书入口表达。
- P1：GUIDANCE/Skill 同时保留唯一入口和手工分步链路，模型收到冲突指令。
- 排除：仓库与已安装 Skill hash 完全一致，工具已注册；不是重装或版本漂移问题。
- 详细证据：`docs/research/2026-10-07-novel-entry-bypass-root-cause.md`。

## 2026-10-07 最小闭环实施

### 目标与非目标

- 目标：让 `3080` 页面从唯一公开入口启动固定短剧 Workflow，并以 Project 正式数据驱动画布。
- 目标：用最小阶段/条目状态支持失败定位、重试和重启恢复。
- 非目标：本轮不重写通用平台，不先批量删除旧模块，不扩展动态 DAG、事件总线或新的调度抽象。

### 实施计划

- [x] 建立入口绕行的回归测试：根 Agent 不能直接调用 Project/Source/底层编排工具，Pilot 范围可由唯一入口表达。
- [x] 收紧公开工具面并统一 Skill/GUIDANCE：`studio_novel_create` 是小说生产唯一公开入口，内部工具只供 Workflow/受限 Agent 使用。
- [x] 将入口接入固定 Harness Workflow；Stage 只负责 prompt、Agent 调用、Schema/业务校验，ProjectStore 是唯一提交入口。
- [x] 为 Project 增加最小阶段与条目 checkpoint；保留原子写入、输入指纹和媒体任务 ID，不引入通用任务系统。
- [x] 运行聚焦测试和受影响回归，核对安装副本与工作区一致。
- [x] 重启服务后使用 `http://127.0.0.1:3080/` 和《都市生日夜》执行 Happy Run；从页面轨迹和画布正式数据逐步验收。
- [x] 中断并重启一次执行 Recovery Run，确认只恢复未完成阶段/条目，不重复提交已完成媒体任务。
- [ ] 根据新路径的真实调用证据列出可删除旧模块；本轮只删除已经无引用且有回归保护的代码。

### 完成门槛

- 页面轨迹的首个业务 Tool 必须是 `studio_novel_create`，且可看到固定 Workflow 启动。
- 文本 Pilot 至少完成分析、分集、单集剧本、角色/场景提示词、2–3 个镜头及图片/视频提示词。
- 画布只读取 Project 正式数据；Agent 回复文本不能作为完成依据。
- 服务重启后同一 Project 能继续，已完成阶段不重跑，失败信息能定位到具体阶段/集/镜头。
- 自动化测试、真实 UI 结果和未验证的外部媒体范围必须分别记录，禁止以 smoke 代替实机结论。

### 回顾

- 真实 Project：`20261007141225410`；文本 Workflow：`20261007141225410:text:43bbeeac9978:novel-to-drama-text-v6:1x3`；媒体 run：`b1a04073-0023-48f7-9724-81a07665620f`。
- 页面唯一入口成功生成 1 集、3 镜头；服务重启后只恢复两个失败视频和下游任务，已完成第三镜没有重跑。
- 修复 H3 manifest `refs.max=8` 未被执行器落实的问题；真实 provider 上三条视频均完成。
- 将 concat/deliver 从 LLM 回显 taskId/hash 的概率性计划中移除，改为确定性装配；恢复后 concat、Deliverable 均完成。
- 画布读模型按完整媒体 DAG 的实际引用统计资产，并保持有效 Deliverable 不被无关资产 rework 隐藏；最终页面显示 100%、6/6、视频 3/3、成片 1/1（24 秒）。
- 用户人工验收：角色一致性通过、剧情连贯、多镜头无明显漂移，最终成片质量通过。
- 自动化验证：`npm run test:all` 170/170；`npm run smoke:all` 通过；安装副本与工作区关键文件 hash 一致。

## 2026-10-07 移除冗余“下载视频”按钮

### 计划

- [x] 定位视频预览、原生控件和额外下载按钮的渲染代码。
- [x] 删除视频卡片底部的“下载视频”链接，保留原生视频控件与技术详情。
- [x] 运行静态检查与受影响的渲染 smoke，确认页面不再生成额外下载按钮。

### 验收标准

- 视频节点继续通过带 `controls` 的 `<video>` 元素预览。
- 视频卡片底部不再出现“下载视频”链接。
- 媒体 URL、图片预览和技术详情行为不变。

### 回顾

- 已移除视频节点底部的独立下载链接，并清理因此失去用途的 `.node-foot a` 样式。
- 保留 `<video controls>`、媒体 URL 和技术详情，浏览器原生下载、播放速度与画中画能力不受影响。
- 验证通过：`node --check studio/app.js`；静态断言确认冗余下载代码为 0 且原生 controls 仍存在；Studio 测试 11/11、渲染 smoke 24/24、画布主页 smoke 87/87。
