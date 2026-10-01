# AI短剧数据底座与能力蒸馏

- 类型：新功能 / 架构重构
- 目标：先冻结并完整迁移当前插件已经可用的制片能力，再建立可恢复的 Elysium 短剧项目域和网关执行契约；随后只蒸馏开源项目相对现有插件的真实增量，最后重做用户界面。
- 调研来源：`docs/research/调研-Harness网关与短剧数据底座.md`

## 人工决策

计划采用以下边界，需用户确认后才进入业务代码实施：

1. 短剧业务状态归 Elysium，不进入 Harness 通用核心，也不进入推理网关。
2. Project 独立于 Harness Session；一个项目可被多个会话和 Agent 打开。
3. 第一条生产链路只使用已验收 Elysium 图片/视频能力；其它 workflow 继续留在网关候选库。
4. 多 Agent 延后到单 Agent + 状态机闭环稳定之后。
5. UI 最后重做，前期只保留最小诊断与验收入口。
6. 当前插件的 Skills、人工门、画布操作、资产复用、连续性、返工、拼接、终检和渠道交付是迁移基线，不以“新架构”为理由删减。
7. 现有脚本和旧文件先分类迁移；只有替代测试和数据迁移验收通过后才删除源文件。

## 总体顺序

```text
插件生产协议与 Harness/网关能力基线冻结
  → Elysium 文件与项目域
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
3. `docs/audits/script-migration-matrix.md` — 新增：为全部 smoke/e2e/probe/bench/make/analyze/preview 脚本标注“插件保留、迁 Elysium、迁网关、替代后删除” → AC-7。
4. `docs/audits/harness-capabilities.md` — 新增：记录 Harness 0.1.0-rc.7 的 Agent、Workflow、Job、Schedule、Storage、Projection、UI 插槽契约与最小验证 → AC-1。
5. `docs/audits/gateway-capabilities.md` — 新增：记录网关路由、异步任务、恢复、取消、媒体和能力目录契约 → AC-2。
6. `scripts/audit-harness.mjs` — 新增：只读探针，验证目标 Harness 服务是否实际挂载，不只检查包存在 → AC-1。
7. `llm-modes-gateway/tests/server/server_test.go`、`tests/workflow/image_test.go` — 修改：固定当前 Elysium 能力基线和不泄露 workflow id 的边界 → AC-2。

验证：先用一个现有项目生成“迁移金样快照”，覆盖节点参数/血缘/泳道/批准版本/排序/送达状态；再运行 Harness 探针和网关测试。缺失服务必须显式失败，不能回退自建实现。

## 阶段 1：建立 Elysium 唯一文件入口

1. `dsh-elysium/src/database/files.js` — 新增：项目目录、媒体、临时文件、原子发布、hash、读取范围校验和删除的唯一文件入口 → AC-3。
2. `dsh-elysium/src/database/layout.js` — 新增：固定 `~/.dsh/storages/elysium` 下 project/media/export/cache 布局；禁止 session/workspace 路径成为权威身份 → AC-3。
3. `dsh-elysium/src/database/migrations.js` — 新增：格式版本、迁移登记、备份和失败回滚 → AC-3。
4. `dsh-elysium/tests/files.test.js` — 新增：原子写、路径逃逸、损坏文件、磁盘失败、迁移失败测试 → AC-3。

验证：故障注入中任何失败都保留旧版本；所有业务源码检索不到 `node:fs`，只有 `files.js` 可以导入。

## 阶段 2：建立项目聚合与领域命令

1. `dsh-elysium/src/domain/spec.js` — 新增：Project 聚合及 StoryBible、Character/State、Location/Scene、Episode、Shot、Attempt、Asset、Review、Timeline、Deliverable schema → AC-3。
2. `dsh-elysium/src/domain/service.js` — 新增：基于 Harness `dsh-storage-domain` 打开 Elysium domain；每个项目记录通过 `KvTable.update` 原子变更 → AC-3。
3. `dsh-elysium/src/domain/commands/*.js` — 新增：create/open/update/transition/attach/review/assemble/deliver 命令；统一 revision 与幂等检查 → AC-3、AC-4。
4. `dsh-elysium/src/domain/state-machines.js` — 新增：Episode、Shot、GenerationAttempt 状态机，非法跳转显式失败 → AC-3。
5. `dsh-elysium/src/domain/read-models.js` — 新增：项目列表、制作看板、镜头队列、审核队列、时间线只读模型 → AC-3。
6. `dsh-elysium/tests/domain/*.test.js` — 新增：并发 revision、重复命令、非法状态、跨会话打开同项目、损坏恢复 → AC-3、AC-4。
7. `dsh-elysium/src/domain/invalidation.js` — 新增：角色/场景/镜头表修订和链上镜头重渲时，按现有 Skill 规则显式失效下游分镜、片段、检查帧和时间线引用 → AC-4、AC-7。
8. `dsh-elysium/src/domain/policies.js` — 新增：镜头表自检、逐镜人工确认、字幕/说话人、参考图、画质一致性与生成前硬门 → AC-4、AC-7。

验证：两个 Harness 会话同时更新同一项目时不会静默覆盖；项目关闭再打开能恢复到相同 revision。

## 阶段 3：让插件成为薄适配层

1. `lib/index.js:loadProject/saveProject/画布工具` — 修改：删除本地 `project.json` 真值源；工具只调用 Elysium command/query service → AC-3。
2. `lib/index.js:resolveSessionRoot` — 修改：session 只记录活动来源；所有生成命令必须显式或通过会话绑定解析 project id → AC-3。
3. `lib/assets.js`、`lib/pdf.js`、`lib/concat.js` — 修改：所有文件读写经过 `dsh-elysium/src/database/files.js` → AC-3。
4. `lib/assets.js` — 修改：把 character/scene/style/clip/text、稳定 asset id、角色 state、跨会话物化和共享文件引用保护迁到 Elysium Asset service；修复中文名称和损坏库处理 → AC-3、AC-7。
5. `studio/app.js`、`lib/client.js` — 修改：第一阶段保持现有交互外观，把 edit/replace/redo/deprecate/restore/group/reorder/upload/register 转为 Elysium command；main/frames/discard 改为 read model 投影 → AC-3、AC-7。
6. `skills/*` — 修改：保持现有制片顺序和门控，改为调用领域工具；Markdown 继续作为展示产物，但不再是权威业务状态 → AC-3、AC-4、AC-7。
7. `lib/index.js:makeH3PromptGateListener/自动送达监听器` — 修改：分别接入 QualityPolicy 与 Delivery Outbox，保留当前有界 fallback 和 ask 前送达行为 → AC-4、AC-7。
8. `scripts/migrate-canvas-projects.mjs` — 新增：把旧 `canvas/<sessionId>/project.json` 和 `.dsh-assets/library.json` 迁为 Elysium Project/Asset，生成迁移报告，不自动删除源数据 → AC-3、AC-7。

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

1. `dsh-elysium/src/media/generation.js` — 新增：创建 Attempt、提交网关、持久化 task id、轮询/恢复、下载、hash 校验、登记 Asset → AC-4。
2. `dsh-elysium/src/media/recovery.js` — 新增：扫描非终态 Attempt，用 Harness Job 恢复；禁止依赖 UI 常驻 → AC-4。
3. `dsh-elysium/src/domain/commands/review.js` — 新增：ReviewDecision，候选素材只有批准后才能绑定 Shot approved asset → AC-4。
4. `dsh-elysium/src/quality/*.js` — 新增：可插拔质量门，只写检测结果，不自动覆盖人工决定 → AC-4。
5. `dsh-elysium/tests/recovery/*.test.js` — 新增：插件退出、Harness 重启、网关重启、下载中断、重复回调与坏媒体测试 → AC-4。
6. `dsh-elysium/src/media/lineage.js` — 新增：把 `ref_nodes`、首末帧、`continuity_from`、抽帧、超分、拼接、替换和重渲关系固化为依赖图；上游变化自动产生待返工集合 → AC-4、AC-7。

验证：在每个中断点杀死进程后重启，Attempt 最终进入唯一终态，素材无重复、Shot 状态正确。

## 阶段 6：成片项目与交付稳定化

1. `dsh-elysium/src/timeline/model.js` — 新增：版本化视频/音频/字幕/转场轨道 → AC-4。
2. `dsh-elysium/src/timeline/assemble.js` — 新增：从 approved asset 构建 immutable timeline revision → AC-4。
3. `dsh-elysium/src/delivery/export.js` — 新增：导出任务、编码参数、产物 hash、质量报告和失败恢复 → AC-4。
4. `dsh-elysium/src/delivery/adapters/*` — 新增：先实现 MP4 与工程清单；剪映/XML 等按开源项目审计结果逐项增加 → AC-4、AC-5。
5. `dsh-elysium/tests/golden-project/*` — 新增：固定一集最小金样，从建项目到交付全链路回归 → AC-4。
6. `dsh-elysium/src/delivery/outbox.js` — 新增：记录媒体/PDF/HTML 的待送达、已送达、失败、超限与重试；适配当前 Web/TUI/飞书行为 → AC-4、AC-7。
7. `dsh-elysium/src/quality/final-review.js` — 新增：结构化保存当前终检清单，包括角色、场景、口型、字幕、参考污染、薄弱片段和实际尺寸 → AC-4、AC-7。

验证：同一 timeline revision 重复导出内容 hash 一致；替换单镜只产生新 revision，不破坏历史成片。

## 阶段 7：逐个确认并蒸馏开源项目

每个项目建立 `docs/audits/open-source/<project>.md`，包含 commit、许可证、schema、调用链、恢复实测、蒸馏项和验收用例，并强制增加四栏：`当前插件已具备`、`需要增强`、`真正缺失`、`明确不引入`。只有“真正缺失”或经实测明显更好的设计进入实施。按以下波次执行：

### 7A：数据与稳定性优先

1. Jellyfish — 领域对象与任务中心。
2. Story Claw — 角色阶段、声线映射、VLM 质量门、断点续跑。
3. ArcReel — 数据迁移/备份、队列、供应商抽象和工程导出。
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

验证：每份审计卡都有一个成功金样、一个故障样例、许可证结论和明确的映射组件。

## 阶段 8：受控启用 Multi-Agent

1. `dsh-elysium/src/agents/blackboard.js` — 新增：只读快照与领域命令提交，不允许 Agent 直接共享可变对象 → AC-1、AC-4。
2. `dsh-elysium/src/agents/workflows/*.js` — 新增：只为小说压缩、角色提取、镜头规划、连续性检查、声音规划等独立任务使用 Harness Workflow/Subagent → AC-1、AC-5。
3. `dsh-elysium/src/agents/contracts/*.js` — 新增：每个 Agent 的输入 schema、输出 schema、允许命令和质量门 → AC-4。

验证：关闭所有 Subagent 后，单 Agent 仍能完成全链路；Subagent 失败不会损坏项目或阻塞人工继续。

## 阶段 9：最后重做 UI

1. `studio/src/project/*` — 新增：项目列表、版本与恢复入口，数据来自 Elysium read model → AC-6。
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

- AC-1：Harness 能力矩阵可定位到当前安装包源码/契约，并通过运行时探针。
- AC-2：网关职责、任务生命周期与能力目录由测试固定。
- AC-3：Elysium 是项目业务状态唯一所有者，所有写入经过领域命令和唯一文件入口。
- AC-4：生成到交付的每个非终态都能在崩溃后恢复，重复执行保持幂等。
- AC-5：17 个开源项目逐个完成证据卡、许可证门和独立验收，不做整项目移植。
- AC-6：UI 最后实施，且只通过 command/read model 与数据层交互。
- AC-7：当前插件能力账本全部有迁移目标和特征测试；任何旧文件仅在替代实现、数据迁移和行为同等三项同时通过后删除。

## 验证结果

未执行。本计划等待用户确认边界与实施顺序。
