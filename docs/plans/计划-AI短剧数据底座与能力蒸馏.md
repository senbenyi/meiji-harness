# AI短剧数据底座与能力蒸馏

- 类型：新功能 / 架构重构
- 目标：先冻结并完整迁移当前插件已经可用的制片能力，再在当前 `dsh-short-video-studio` 插件内建立可恢复的短剧项目域，并补齐网关执行契约；随后只蒸馏开源项目相对现有插件的真实增量，最后重做用户界面。
- 调研来源：`docs/research/调研-Harness网关与短剧数据底座.md`

> **边界修订（2026-10-02）**：原计划误把已经移出当前仓库的独立历史包及其 `~/.dsh/storages/elysium` 目录继续当作目标边界。该目录已经删除，后续不得恢复、探测、迁移到或回退创建。当前方案以 `dsh-short-video-studio` 为唯一插件项目；`Elysium` 只表示当前已验收的图片/视频生成能力，不表示存储产品、目录或项目域名称。结构化业务状态由 Harness Domain Storage 持久化；媒体与导出物由插件 File Service 管理，其物理根目录必须由宿主注入或显式配置解析，业务代码不得硬编码用户主目录路径。

## 人工决策

计划采用以下边界，需用户确认后才进入业务代码实施：

1. 短剧业务状态归当前 `dsh-short-video-studio` 插件的项目域，不进入 Harness 通用核心，也不进入推理网关。
2. Project 独立于 Harness Session；一个项目可被多个会话和 Agent 打开。
3. 第一条生产链路只使用已验收 Elysium 图片/视频能力；其它 workflow 继续留在网关候选库。
4. 多 Agent 延后到单 Agent + 状态机闭环稳定之后。
5. UI 最后重做，前期只保留最小诊断与验收入口。
6. 当前插件的 Skills、人工门、画布操作、资产复用、连续性、返工、拼接、终检和渠道交付是迁移基线，不以“新架构”为理由删减。
7. 现有脚本和旧文件先分类迁移；只有替代测试和数据迁移验收通过后才删除源文件。
8. 每项通用能力先查 `docs/audits/harness-capabilities.md`：Harness 已提供的 Todo、Goal、Plan、Subagent、Workflow、Job、Approval、Skill、Storage、Projection、Deliverables 等能力直接复用，不在插件内重造。
9. 存储位置不是领域身份：Project 只以稳定 `projectId` 标识；Domain Storage 保存权威结构化状态，File Service 只保存按 asset id/hash 引用的二进制与导出物。宿主没有提供可写根目录且用户也未显式配置时必须失败并说明修复方法，禁止静默回退到历史目录或 session/workspace 路径。

## 总体顺序

```text
Harness 官方插件全量审计与插件/网关能力基线冻结
  → 当前插件的文件服务与项目域
  → 状态机和领域命令
  → 网关幂等与能力契约
  → 任务恢复和素材血缘
  → 成片时间线与交付
  → 逐项目能力蒸馏
  → Multi-Agent 协作
  → UI/交互重构
```

任何阶段未通过故障恢复验收，不进入下一阶段。

## 阶段 0：冻结能力基线

1. `docs/audits/plugin-capability-ledger.md` — 新增：逐条登记当前 16 个工具、HTTP 路由、客户端 slots、画布动作、资产类型、8 个 Skills、人工门、连续性规则、交付钩子与对应迁移目标 → AC-7。
2. `tests/characterization/*` — 新增：对当前 `project.json`、节点泳道、资产物化、重做/替换/废弃/恢复、H3 门、逐镜确认、拼接和 ask 前送达建立黑盒特征测试 → AC-7。
3. `docs/audits/script-migration-matrix.md` — 新增：为全部 smoke/e2e/probe/bench/make/analyze/preview 脚本标注“插件保留、迁插件项目域、迁网关、替代后删除” → AC-7。
4. `docs/audits/harness-capabilities.md` — 新增：按当前实际版本全量登记 Harness 官方包组，区分已安装、已挂载、Agent 可见、业务已利用，并记录复用、暂不采用和安装门 → AC-1。
5. `docs/audits/gateway-capabilities.md` — 新增：记录网关路由、异步任务、恢复、取消、媒体和能力目录契约 → AC-2。
6. `scripts/tools/audit-harness.mjs` — 新增：只读解析当前 Profile 组合与本机安装树，验证官方包/子入口是否可解析并输出 enabled/disabled/conditional 状态；同时确认当前版本可用于 Domain Storage 和插件文件根定位的真实注入点，不能用历史路径代替未确认的宿主契约；运行时服务可用性在后续对应能力接入时增加聚焦探针 → AC-1、AC-3。
7. `llm-modes-gateway/tests/server/server_test.go`、`tests/workflow/image_test.go` — 修改：固定当前 Elysium 能力基线和不泄露 workflow id 的边界 → AC-2。

验证：先运行 `node scripts/tools/audit-harness.mjs web --json`，组合引用缺包数必须为 0；再用一个现有项目生成“迁移金样快照”，覆盖节点参数/血缘/泳道/批准版本/排序/送达状态，并运行 Harness 聚焦探针和网关测试。缺失服务必须显式失败，不能回退自建实现。本阶段审计未发现需要立即安装的官方依赖；以后只有被采用且确实缺失的能力才允许安装。

## 阶段 1：建立存储定位与唯一文件入口

本阶段先分开两种存储：Project/Shot/Attempt/Review 等结构化真值进入 Harness Domain Storage；图片、视频、代理文件、缓存和导出物进入 Studio File Service。两者共享稳定 id/hash，不共享物理路径作为身份。

1. `lib/storage/locator.js` — 新增：只从宿主注入或显式配置解析插件作用域文件根；返回规范化绝对路径和来源信息。缺失、只读或越界时显式失败；不得包含历史目录 fallback → AC-3。
2. `lib/storage/layout.js` — 新增：只定义相对于已解析根目录的 `media/`、`exports/`、`cache/`、`tmp/` 逻辑布局；Project 结构化状态不在此重复落一份 JSON → AC-3。
3. `lib/storage/files.js` — 新增：以 locator 返回的根为唯一边界，负责临时文件、原子发布、hash、读取范围校验和删除；业务模块不得自行拼接绝对路径 → AC-3。
4. `lib/storage/migrations.js` — 新增：媒体布局格式版本、迁移登记、备份和失败回滚。迁移源必须显式传入或由旧项目记录发现；不得扫描、创建或假设已删除的历史目录 → AC-3。
5. `tests/storage/*.test.js` — 新增：注入临时根，覆盖根缺失/只读、原子写、路径逃逸、损坏文件、磁盘失败和迁移失败；测试不得读写真实用户目录 → AC-3。

验证：故障注入中任何失败都保留旧版本；物理根变化后，同一 Project 仍可通过稳定 id/hash 恢复引用；所有业务源码检索不到 `node:fs`，只有 `files.js` 可以导入；仓库执行 `rg '~/.dsh/storages/elysium|storages/elysium' lib tests scripts` 必须无结果。

## 阶段 2：建立项目聚合与领域命令

1. `lib/domain/spec.js` — 新增：Project 聚合及 StoryBible、Character/State、Location/Scene、Episode、Shot、Attempt、Asset、Review、Timeline、Deliverable schema → AC-3。
2. `lib/domain/service.js` — 新增：基于 Harness `dsh-storage-domain` 打开当前插件的项目 domain；每个项目记录通过 `KvTable.update` 原子变更。Domain 负责结构化真值，记录 Asset 的稳定 id/hash/逻辑引用，不保存 File Service 的部署根路径 → AC-3。
3. `lib/domain/commands/*.js` — 新增：create/open/update/transition/attach/review/assemble/deliver 命令；统一 revision 与幂等检查 → AC-3、AC-4。
4. `lib/domain/state-machines.js` — 新增：Episode、Shot、GenerationAttempt 状态机，非法跳转显式失败 → AC-3。
5. `lib/domain/read-models.js` — 新增：项目列表、制作看板、镜头队列、审核队列、时间线只读模型 → AC-3。
6. `tests/domain/*.test.js` — 新增：并发 revision、重复命令、非法状态、跨会话打开同项目、损坏恢复 → AC-3、AC-4。
7. `lib/domain/invalidation.js` — 新增：角色/场景/镜头表修订和链上镜头重渲时，按现有 Skill 规则显式失效下游分镜、片段、检查帧和时间线引用 → AC-4、AC-7。
8. `lib/domain/policies.js` — 新增：镜头表自检、逐镜人工确认、字幕/说话人、参考图、画质一致性与生成前硬门 → AC-4、AC-7。

验证：两个 Harness 会话同时更新同一项目时不会静默覆盖；项目关闭再打开能恢复到相同 revision。

## 阶段 3：让插件成为薄适配层

1. `lib/index.js:loadProject/saveProject/画布工具` — 修改：删除本地 `project.json` 真值源；工具只调用当前插件的 command/query service → AC-3。
2. `lib/index.js:resolveSessionRoot` — 修改：session 只记录活动来源；所有生成命令必须显式或通过会话绑定解析 project id → AC-3。
3. `lib/assets.js`、`lib/pdf.js`、`lib/concat.js` — 修改：所有文件读写经过 `lib/storage/files.js` → AC-3。
4. `lib/assets.js` — 修改：把 character/scene/style/clip/text、稳定 asset id、角色 state、跨会话物化和共享文件引用保护迁到当前插件的 Asset service；修复中文名称和损坏库处理 → AC-3、AC-7。
5. `studio/app.js`、`lib/client.js` — 修改：第一阶段保持现有交互外观，把 edit/replace/redo/deprecate/restore/group/reorder/upload/register 转为项目域 command；main/frames/discard 改为 read model 投影 → AC-3、AC-7。
6. `skills/*` — 修改：保持现有制片顺序和门控，改为调用领域工具；Markdown 继续作为展示产物，但不再是权威业务状态 → AC-3、AC-4、AC-7。
7. `lib/index.js:makeH3PromptGateListener/自动送达监听器` — 修改：分别接入 QualityPolicy 与 Delivery Outbox，保留当前有界 fallback 和 ask 前送达行为 → AC-4、AC-7。
8. `scripts/migrate-canvas-projects.mjs` — 新增：从用户显式指定的 workspace 或已打开旧项目中读取 `canvas/<sessionId>/project.json` 和 `.dsh-assets/library.json`，迁为当前插件的 Project/Asset，生成迁移报告，不自动删除源数据；不得扫描已删除的历史目录 → AC-3、AC-7。

验证：迁移前后不只比较数量/hash，还逐项比较 params、血缘、泳道、group/order、当前批准版本、废弃/恢复和 delivery 状态；特征测试全部通过后，插件重启、换会话仍能打开同一项目。

## 阶段 4：补齐网关执行契约

在 `/Users/mac/ai/llm-modes-gateway` 实施：

1. `internal/core/port.go:MediaCapability` — 修改：增加输入形状、引用数量、输出类型、尺寸/时长范围、continuity、取消和健康状态 → AC-2、AC-4。
2. `internal/store/store.go:tasks` — 修改：增加唯一 `idempotency_key` 与不透明 `client_ref`；同一 token 重复提交返回原任务 → AC-4。
3. `internal/core/gateway.go:SubmitTask` — 修改：先按幂等键查询/创建，再提交；保留 submission_unknown/recovery 语义 → AC-4。
4. `internal/provider/comfyui/workflow/registry.go` — 修改：能力目录由通过验收的 manifest 元数据生成，候选实现不公开 → AC-2。
5. `internal/api/server.go`、`images.go`、`videos.go` — 修改：接收幂等键和 client_ref，返回规范化任务/资源契约 → AC-4。
6. `tests/server/*`、`tests/workflow/*` — 修改：重复提交、崩溃恢复、取消竞态、能力不匹配和不跨档回退测试 → AC-2、AC-4。
7. 插件 `lib/manifest.js`、`schemas/workflow-manifest.schema.json` — 删除：确认网关已有等价 manifest 编译、schema 校验与资格测试后，移除插件残留文件 → AC-2、AC-7。
8. 插件 `lib/index.js` legacy workflow registry、`/workflows` 写删路由、直接 ComfyUI builders 与只服务旧 manifest 的 `_internals` — 删除：保留的生成入口只提交 capability/tier/semantic inputs 给网关 → AC-2、AC-7。
9. 插件 `package.json`、`scripts/*` — 修改/迁移：删除仅由旧 manifest 路径使用的依赖；相关 smoke/e2e/probe/模板脚本移入网关测试树或由新测试替代，不在插件留同名空壳 → AC-2、AC-7。

验证：同一 GenerationAttempt 重试 100 次只产生一个网关任务；网关在提交响应丢失后能够恢复而不重复生成；插件执行 `rg 'manifest|workflow registry|ComfyUI direct'` 只允许出现网关语义客户端说明，不再存在本地 workflow 文件、schema、编译器和写删 API。

## 阶段 5：打通生成、审核和素材血缘

1. `lib/media/generation.js` — 新增：创建 Attempt、提交网关、持久化 task id、轮询/恢复、下载、hash 校验、登记 Asset → AC-4。
2. `lib/media/recovery.js` — 新增：扫描非终态 Attempt，用 Harness Job 恢复；禁止依赖 UI 常驻 → AC-4。
3. `lib/domain/commands/review.js` — 新增：ReviewDecision，候选素材只有批准后才能绑定 Shot approved asset → AC-4。
4. `lib/quality/*.js` — 新增：可插拔质量门，只写检测结果，不自动覆盖人工决定 → AC-4。
5. `tests/recovery/*.test.js` — 新增：插件退出、Harness 重启、网关重启、下载中断、重复回调与坏媒体测试 → AC-4。
6. `lib/media/lineage.js` — 新增：把 `ref_nodes`、首末帧、`continuity_from`、抽帧、超分、拼接、替换和重渲关系固化为依赖图；上游变化自动产生待返工集合 → AC-4、AC-7。

验证：在每个中断点杀死进程后重启，Attempt 最终进入唯一终态，素材无重复、Shot 状态正确。

## 阶段 6：成片项目与交付稳定化

1. `lib/timeline/model.js` — 新增：版本化视频/音频/字幕/转场轨道 → AC-4。
2. `lib/timeline/assemble.js` — 新增：从 approved asset 构建 immutable timeline revision → AC-4。
3. `lib/delivery/export.js` — 新增：导出任务、编码参数、产物 hash、质量报告和失败恢复 → AC-4。
4. `lib/delivery/adapters/*` — 新增：先实现 MP4 与工程清单；剪映/XML 等按开源项目审计结果逐项增加 → AC-4、AC-5。
5. `tests/golden-project/*` — 新增：固定一集最小金样，从建项目到交付全链路回归 → AC-4。
6. `lib/delivery/outbox.js` — 新增：记录媒体/PDF/HTML 的待送达、已送达、失败、超限与重试；适配当前 Web/TUI/飞书行为 → AC-4、AC-7。
7. `lib/quality/final-review.js` — 新增：结构化保存当前终检清单，包括角色、场景、口型、字幕、参考污染、薄弱片段和实际尺寸 → AC-4、AC-7。

验证：同一 timeline revision 重复导出内容 hash 一致；替换单镜只产生新 revision，不破坏历史成片。

## 阶段 7：逐个确认并蒸馏开源项目

每个项目建立 `docs/audits/open-source/<project>.md`，包含 commit、许可证、schema、调用链、恢复实测、蒸馏项和验收用例，并强制增加四栏：`当前插件已具备`、`需要增强`、`真正缺失`、`明确不引入`。只有“真正缺失”或经实测明显更好的设计进入实施。按以下波次执行：

### 7A：数据与稳定性优先

1. Jellyfish — 领域对象与任务中心。
2. Story Claw — 角色阶段、声线映射、VLM 质量门、断点续跑。
3. ArcReel — 只蒸馏与当前架构直接相邻且收益最高的引用/输入快照、ComfyUI workflow 检查与预览、Attempt 对账与恢复投影；不引入通用队列、供应商全集或工程后端。范围见 `docs/audits/open-source/ArcReel.md`，实施设计见 `docs/plans/计划-ArcReel高收益能力蒸馏.md`。
4. ViMax — 长篇上下文压缩、渲染状态持久化和并行续跑。

每项只集成一个可独立验收的能力；未通过金样和故障测试，不进入下一项 → AC-5。

### 7B：后期与成片

1. MoneyPrinterTurbo — TTS、字幕、BGM 与合成。
2. LumenX — Studio/Playground 分离和完整后期链。
3. Novella — 音频工作室、黑板读模型和插件边界。
4. AI Video Production Editor — 返拍队列、3D 预演、调色和专业交付。

### 7C：批量、运维与商业治理

1. LocalMiniDrama — 镜头组重跑。
2. moyin-creator — 批量一致性队列。
3. AID Studio — 健康检查、僵尸任务和媒体清理。
4. waoowaoo — 失败治理、资源归属和审批。
5. FastMovieAI — 用户/积分/支付，仅在确定商业平台需求后启动。

### 7D：扩展与模板

1. Toonflow — 节点扩展 SDK 和无限画布，只消费稳定 read model。
2. Huobao Drama — 仅蒸馏 Skill/adapter 分离思想，不复制非商业代码。
3. Pixelle-Video — 解说/口播作为内容模板。
4. BigBanana — 只保留产品研究，不进入代码集成。

### 7E：外部 AI 建议中通过复核的候选能力

以下项目不是组合安装清单，只在阶段 1–6 完成、Project Domain 成为唯一真相源后逐项审计：

1. `@liustack/modlens`、`dsh-vision-toolkit` — 二选一或按能力拆分验证角色、服装、场景、构图和首尾帧连续性；新增适配器必须把检测器、版本、输入 hash、结构化差异和证据资产写入 `Review`，不得直接修改 `Shot` 或替代人工结论 → AC-4、AC-5、AC-7。
2. `dsh-layered-memory` — 只验证“从已提交项目快照召回 StoryBible、角色状态和分集摘要”；召回结果必须携带 project/revision/source，关闭插件后同一金样仍能完整生产 → AC-3、AC-5。

以下建议不进入当前实施：`dsh-genui` 和 `DSH-better-sidebar` 与已有画布/宿主侧栏重叠；ComfyUI bridge 与当前能力注册表和执行器重叠；Milvus 没有规模与检索基准支撑；浏览器自动化、文件唤醒和手机审批不替代网关任务状态、outbox 与 Harness Approval。其余无法锁定一手仓库、版本、许可证和兼容性证据的名称，只能先建审计卡，不能写入 Profile 或依赖清单。

验证：每份审计卡都有一个成功金样、一个故障样例、许可证结论和明确的映射组件。

## 阶段 8：受控启用 Multi-Agent

1. `lib/agents/blackboard.js` — 新增：只读快照与领域命令提交，不允许 Agent 直接共享可变对象 → AC-1、AC-4。
2. `lib/agents/contracts/*.js` — 新增：每个 Agent 的输入 schema、输出 schema、允许命令和质量门；只定义业务契约，不实现子代理调度器 → AC-4。
3. `skills/*` — 修改：小说压缩、角色提取、镜头规划、连续性检查、声音规划等独立任务直接调用 Harness Subagent；只有用户明确要求大型多 Agent 编排且至少有三个独立任务时才使用 Harness Workflow → AC-1、AC-5。
4. `tests/agents/*.test.js` — 新增：固定只读快照、领域命令提交、子代理失败隔离、Workflow 取消和关闭所有 Subagent 后的单 Agent 回退 → AC-1、AC-4。

验证：Harness 原生 Subagent 目录能显示运行状态和完成结果，Todo 能显示当前步骤及待执行项；关闭所有 Subagent 后，单 Agent 仍能完成全链路；Subagent 失败不会损坏项目或阻塞人工继续。插件代码中不得出现自建 Agent runtime、子代理进程管理器或第二套任务列表 UI。

## 阶段 9：最后重做 UI

1. `studio/src/project/*` — 新增：项目列表、版本与恢复入口，数据来自当前插件的 read model → AC-6。
2. `studio/src/production/*` — 新增：剧集/场景/镜头生产看板与审核队列 → AC-6。
3. `studio/src/timeline/*` — 新增：只编辑 Timeline command，不直接改媒体或项目 JSON → AC-6。
4. `studio/src/diagnostics/*` — 新增：Attempt、gateway task、错误、恢复与血缘诊断 → AC-4、AC-6。
5. 现有 `studio/app.js` — 渐进迁移：保留主线/检查帧/废弃泳道、编辑、替换、重做、入库、分组、排序、恢复等现有操作，数据源改为 read model；达到行为同等后再删除旧 node 真值逻辑 → AC-3、AC-6、AC-7。

验证：同一项目从两个会话打开时读到相同 revision；UI 刷新、切会话、Harness 重启都不会丢失制作进度。

## 阶段门与发布策略

- Gate 1：阶段 1–3 通过后，才允许新增短剧业务功能。
- Gate 2：阶段 4–5 通过故障注入后，才称“生成链路稳定”。
- Gate 3：阶段 6 金样完成后，才称“成片项目可稳定管理”。
- Gate 4：每个开源能力单独 feature flag，上线不改变既有项目状态语义。
- Gate 5：UI 只消费稳定 read model；不得为了界面便利反向修改领域不变量。

## 验收标准

- AC-1：Harness 官方插件能力矩阵可定位到当前安装包源码、组合配置或官方契约，明确安装/挂载/Agent 可见/业务利用状态，并通过对应运行时探针。
- AC-2：网关职责、任务生命周期与能力目录由测试固定。
- AC-3：当前 `dsh-short-video-studio` 插件的项目域是业务状态唯一所有者；结构化写入经过领域命令与 Harness Domain Storage，二进制写入经过宿主定位的唯一 File Service。任何 Project/Asset 身份均不依赖固定绝对路径，代码无历史目录 fallback。
- AC-4：生成到交付的每个非终态都能在崩溃后恢复，重复执行保持幂等。
- AC-5：17 个开源项目逐个完成证据卡、许可证门和独立验收，不做整项目移植。
- AC-6：UI 最后实施，且只通过 command/read model 与数据层交互。
- AC-7：当前插件能力账本全部有迁移目标和特征测试；任何旧文件仅在替代实现、数据迁移和行为同等三项同时通过后删除。

## 验证结果

未执行。2026-10-02 已删除历史固定存储目录假设；本计划等待架构审核及用户确认其余边界与实施顺序。
