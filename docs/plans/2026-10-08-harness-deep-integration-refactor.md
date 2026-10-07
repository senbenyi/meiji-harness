# Harness 深度集成重构方案（做减法）

> 状态：**待用户审核**。审核通过后交由 Codex 按第 7 节逐项执行。第 10 节（阶段二：对话式创作）不在本轮执行范围。
> 日期：2026-10-08。Harness 基线：本机全局 `@deepseek-ai/dsh@0.1.7-alpha.2`。
> 已吸收：Codex 2026-10-07 稳定性分析（原 `docs/research/2026-10-07-production-readiness-analysis.md`，其缺陷证据、设计风险、运行契约与故障矩阵已并入第 3.1、3.2、5.3、8 节，原文件未入库，已移入 macOS 废纸篓）。
> 相关文档：`docs/plans/2026-10-07-durable-production-architecture.md`（最小架构，本方案修正其中"Harness 负责持久恢复"的前提，见 4.3）、`docs/implement/harness-capabilities.md`（官方包组处置台账；本方案是其中 subagent/workflow/jobs、interaction、deliverables、skill 四组的具体落地）。

---

## 0. 给执行者（Codex）的硬约束

开始任何任务前必须遵守。违反任一条，该任务作废。

1. **功能不变**：Agent 工具名与参数、HTTP 路由、Project JSON 结构与 `schemaVersion`、领域命令类型名、ProductionTask `kind` 字符串、任务 id 规则（如 `${runId}:deliverable`）一律不改。进行中的 Run 必须能继续跑。
2. **不新增自动测试或 smoke 脚本**（用户已明确删除全部测试，见 `tasks/lessons.md`）。验证只用：
   - 所有 `lib/**/*.js`、`studio/*.js` 执行 `node --check`；
   - `node -e "import('./lib/index.js')"` 主入口可导入；
   - `npm pack --dry-run` 文件清单正确；
   - 引用扫描（被删符号/文件 0 残留）；
   - `git diff --check`；
   - 需要真实行为验证的任务，交由用户在 `http://127.0.0.1:3080/` 人工验收（每个任务标注是否需要）。
3. **不自建通用平台**：不引入新的调度器、DAG 引擎、事件总线、Outbox、Fencing 等概念。能交给 Harness 的交给 Harness；Harness 做不到的，只在现有 ProductionRun/Worker 上做最小补丁。
4. **搬迁与改逻辑不混在同一提交**。每个任务单独提交，提交信息说明任务编号。
5. **不对远程 GPU 服务做压测或批量生成**；不重启远程服务器；不使用 SSH 隧道连模型。
6. **Pipeline manifest 的角色、Schema、Prompt、校验契约有任何变化，必须提升 `version`**。
7. **Harness structured_output 只支持受限 JSON Schema**（不支持 `minItems/maxItems`，`oneOf` 单分支会被拒）。
8. 每完成一个任务，在 `tasks/todo.md` 的"2026-10-07 Harness 深度集成重构"一节勾选并写一句回顾。
9. 遇到【需人工验收】的任务：完成代码与静态检查后**停止并汇报**，等用户在 3080 验收通过再继续。

### 0.1 执行前必读资料

| 资料 | 用途 |
|---|---|
| `tasks/lessons.md` | 历次纠正形成的规则，全部适用 |
| `tasks/todo.md` 末节 | 本方案的勾选清单 |
| `docs/implement/harness-capabilities.md` | Harness 官方包组处置台账 |
| `README.md`「安装与运行」 | 插件安装、宿主启动命令 |
| Harness 源码 `/Users/mac/Library/pnpm/global/5/.pnpm/@deepseek-ai+<包名>@0.1.7-alpha.2*/node_modules/@deepseek-ai/<包名>/` | 阶段 B/C 查 API（README、`lib/types/*.d.ts`） |

### 0.2 安装与重启（需要人工验收或探针时）

- 安装/更新插件：`dsh plugin --profile web add -w file:/Users/mac/ai/llm-dsh-plugins`；不能以 `Already up to date` 作为已更新证据，必要时先 remove 再 `add --force`，并确认安装目录入口可 import（lessons）。
- 重启宿主：`dsh web --no-open`，确认日志无插件加载错误，页面 `http://127.0.0.1:3080/`。
- 重启宿主属于会影响用户运行中会话的操作：**执行前征得用户同意**。

---

## 1. 背景：为什么要重构，为什么是"做减法"

`lib/` 共 74 个文件、约 1.4 万行，`lib/index.js` 单文件 4682 行。之前两版方案（按目录拆文件、引入 DDD 概念层）都会让代码更复杂。问题的根源有两个：

1. **插件重造了大量 Harness 已有的底层能力**：子代理装配与登记、子代理权限限制、长任务承载、进度呈现、成片交付、Skill 安装。
2. **核心流程存在双轨和"只声明不执行"**：pipeline JSON 只做校验、不驱动顺序；两条交付路径；两套文本返工；审核先建 `awaiting_human` 再立刻自动批准。

方向：**把通用能力交还 Harness，插件只保留短剧领域独有的部分**。完成后代码量应净减少。

---

## 2. 核心模块（按真实代码追踪）

| # | 模块 | 位置 | 真实职责 | 处置 |
|---|---|---|---|---|
| M1 | 小说入口与总编排 | `lib/index.js` 中 `studio_novel_create`（约 4397）与 `studio_novel_orchestrate`（约 4181） | 导入原文 → 建 Project → 文本流水线 → 资产参考图 Run → 剩余文本 → 媒体 Run → 校验成片 | 保留业务逻辑；**承载方式**改由 Harness jobs |
| M2 | 文本生产流水线 | `pipelines/novel-to-drama-text.pipeline.json`、`lib/script/novel-production.js`、`lib/production/pipeline-registry.js`、`pipeline-compiler.js` | 8 个文本阶段的提示词、Schema、校验、提交 | 保留；阶段顺序由 `stages/catalog.js` 决定，JSON 只声明节点的提示词、Schema、重试、并发和角色，`dependsOn` 由 registry 校验与 catalog 一致（O5） |
| M3 | 智能体执行 | `lib/agents/workflow.js`、`roles.js`、`index.js` 中 `withProductionAgent`（约 3951）、`lib/script/child-policy.js` | 每任务一次 workflow 调用、角色指令、超时重试、子代理限权 | **大部分是 Harness 能力的重造**，收缩 |
| M4 | 项目领域 | `lib/domain/commands/index.js`（768 行）、`spec.js`、`state-machines.js`、`invalidation.js`、`creative.js`、`policies.js` | 唯一写入口、提案落地、失效传播、生成前门禁 | **不动**，这是核心资产 |
| M5 | 生产调度 | `lib/domain/production.js`、`lib/production/worker.js` | 持久 Run/Task、租约、checkpoint、断点续跑 | **保留**（Harness jobs 不持久，见 4.3） |
| M6 | 媒体生成 | `index.js` 中 `runRender`（约 1935–2270）、档位解析（约 980–1934）、`lib/manifest.js`、ComfyUI 客户端（约 271–376） | capability + tier → workflow manifest → 建图 → Attempt 推进 → 落盘 | 保留逻辑；最后一步才从 index.js 搬出 |
| M7 | 后期与交付 | `runConcat`/`runUpscale`、`lib/delivery/export.js`、`deliver-drama` handler、`lib/hooks/pre-ask-delivery.js`、`lib/pdf.js` | 拼接、成片记录、发给用户 | 拼接保留；**发送与展示交给 Harness** |
| M8 | 呈现 | `studio/app.js`（2.5 秒轮询 `/canvas`）、`lib/domain/read-models.js`、`lib/client.js`、旧画布适配 | 画布、进度、审核、返工 UI | 画布保留；对话侧进度交给 Harness |
| M9 | 手动创作支路 | `comfy_*`/`canvas_*` 工具与 `skills/elysium-generate-{image,video,video-3d,video-brand,minimax-h3}` | 非小说场景的逐镜手工生成 | 保留为支路，不在本方案中改动 |

---

## 3. 核心流程（真实执行链）

```
用户上传小说
 └ studio_novel_create（根 Agent 唯一入口；novel-entry-gate 拦截其它内部工具）
    ├ 原文归一化、按 12000 字分段 → registerSourceDocument
    ├ createProductionRun(novel-production-root)，在调用方前台自行租约 + 心跳
    └ studio_novel_orchestrate
        ├ 文本阶段一：source-summary×N → story-reconcile → episode-plan → episode-script×集
        │            → asset-extraction → asset-prompt → asset-commit
        │   每阶段 runBatch → runProductionWorkflow（每个任务一次 workflow 工具调用，Promise.all）
        │   → *_submit(autoApprove) → submitDevelopmentProposal + recordReviewDecision(approved)
        ├ 资产参考图 Run（render-reference）→ waitForProductionRun 每秒轮询
        ├ 文本阶段二：shot-plan → storyboard-prompt / video-prompt → shot-prompts-commit
        └ 媒体 Run：render-reference → render-storyboard → render-shot → concat-video → deliver-drama
             ProductionWorker 并发 2，handler 写在 apply() 闭包里 → runRender → ComfyUI
 └ syncNovelTodoTerminal：结束时一次性写 5 条 todo
 └ 成片送达：只有之后有人调用 ask_user_question，pre-ask 钩子才把所有未送达节点 send_file
```

### 3.1 已核实的流程缺陷

| # | 缺陷 | 证据 | 级别 |
|---|---|---|---|
| D1 | 参考图挂在 `legacy-main` 的伪镜头上，批量生成把它们当正式镜头，阻断整项目 | `index.js:602` ensureLegacyShot；批量范围 `index.js` `studio_batch_generate`（约 4608–4617）按全部 episodes 取镜头 | P0 |
| D2 | 界面"重试"只把任务改回 ready，小说根任务没有消费者 | `studio/app.js:984`；Worker 无 `novel-production-root` handler（`index.js:4021`） | P0 |
| D3 | 一批 workflow 调用中一个抛异常，同批成功结果全部丢失 | `lib/agents/workflow.js:29`（Promise.all）、`:40`；`novel-production.js:128,151` | P1 |
| D4 | 本地 revision 冲突被归类为 `remote_failure` | `lib/media/failures.js:3` 默认 remote_failure | P1 |
| D5 | 画布按"最新 Run"猜当前流程，返工 Run 覆盖根流程状态 | `read-models.js:41,44,158`；`studio/app.js:971` | P1 |
| D6 | 文本降级结果（fallback）静默当作正式成功 | `novel-production.js:33,133,219,285` | P1 |
| D7 | 整部剧阻塞在一次前台工具调用里，中断即"unknown outcome" | `waitForProductionRun`（`index.js:3994`）无限轮询，不接 AbortSignal | P1 |
| D8 | 两条交付路径各跑一次 ffmpeg | `deliver-drama` handler（`index.js:4076`）与 `studio_deliverable_export` → `DeliveryService`（`lib/delivery/export.js`） | P2 |
| D9 | 两套文本返工绕开编译器，丢失 JSON 约束和重试策略 | `lib/script/rework.js`、`lib/script/creative-rework.js` | P2 |
| D10 | 成片送达依赖之后的 ask_user_question（而 skill 禁止 ask），且推送全部节点而非成片 | `pre-ask-delivery.js:36,204` | P2 |
| D11 | render-reference 在三处规划 | `index.js:4263`、`drama.js:59-69`、`production/rework.js` | P2 |
| D12 | `prepareMediaTask` 的 `runWorkflow` 参数从未被调用 | `lib/agents/media.js:15-21` | P3 |
| D13 | 插件内部工具互调用 `tool.execute` 直调，绕过 `tools/pre-execute` 钩子 | `index.js:4230-4236, 4421-4427` | P3 |

D1 的补充证据：某现场项目有 1 个正式分集、4 个正式镜头，`legacy-main` 下另挂 24 个图片类 Shot；只读重放批量筛选与 `dramaProductionTasks`，稳定复现 `scripts:legacy-main` 缺少正式剧本、参考图对象缺少资产绑定与提示词的错误。
D5 的补充证据：同一项目有 10 个 Run，根流程与原资产 Run 失败、后续返工 Run 完成；资产实际 19/19、分镜 4/4，但画布选中一个单镜返工 Run 作为全局当前流程，较老的根流程被"最新 5 个"过滤掉。

### 3.2 已确认的设计风险（代码可证，尚未做故障实测）

| # | 风险 | 证据 | 处置 |
|---|---|---|---|
| R1 | 失去租约后旧执行仍可提交成果：`assertOwner` 只校验 owner，不校验执行代次；心跳失败只记日志，不停止 handler；文本执行固定 owner `novel-text`、租约 30 分钟 | `lib/domain/production.js:68`、`lib/production/worker.js:80` | A7 |
| R2 | ComfyUI 已受理、本地尚未保存 promptId 时进程退出，恢复时可能重复提交付费生成；当前 `client_id` 每次随机，无法事后查回 | `index.js` `comfySubmit`（约 288）、`runRender` 提交（约 2138）与保存 promptId（约 2145） | B5 → C7 |
| R3 | `Worker.stop` 等待全部 handler 结束，但不向 handler 传停止信号，优雅退出可能长时间挂起 | `lib/production/worker.js:32` | A7 |
| R4 | 每条命令都克隆并解析整个 Project；4 镜头项目快照约 2.2 MB、647 条 commandResults；Worker 每轮扫描全部项目 | `lib/domain/service.js:86-111`、`worker.js:43-71` | 本次不处理，在 `docs/open-issues.md` 登记，规模扩大前再评估 |

---

## 4. Harness 能力集成现状

### 4.1 已用但浅用或重造

| 能力 | 现状 | 问题 |
|---|---|---|
| `storage.domain` | Project 聚合，自建命令层、CAS、幂等（`lib/domain/service.js:28-111`） | 合理，保留 |
| `tools` | 注册 30+ 工具；内部互调直调 `execute` | 绕过钩子（D13） |
| `workflow` 工具 | 每个任务一次调用，Promise.all 并发 | 批次异常丢结果（D3） |
| `agents.create` + 手写 `subagent/descriptor`、`subagent/catalog` | `withProductionAgent` 手工造协调会话（`index.js:3951-3992`） | 重造子代理登记；合成的 AbortSignal 永不触发 |
| `agent/created` + `child-policy.js` | 用 `tools.restrict/guard` 和 `agent/pre-step` 给 workflow 子代理限权 | 重造 subagent 的 `toolFilter` / `persona` |
| `systemPrompt.section` | 一大段常驻 guidance，子代理也注入，再靠"子代理请忽略"前言豁免（`guidance.js:2`） | 曾导致子代理幻觉调用未开放工具（lessons 第 47 条） |
| `todo_write` | 结束时一次性写 | 无实时进度 |
| `send_file` | 只在 pre-ask 钩子里调用 | D10 |
| Skill | `lib/skills/sync.js` 把文件拷到 `~/.dsh/skills` 并做版本戳 | 重造 `ctx.skills.register` |

### 4.2 未用的深度能力（按价值排序）

| 优先级 | 能力 | 用法 | 可删除的自建代码 |
|---|---|---|---|
| P1 | `ctx.jobs`（需 `dsh-tool-jobs` 挂载） | 整部剧作为后台 job：`updateProgress` 报"第 3 集 镜头 12/40"，`job_output`/`job_kill`，完成时 wakeup 主 Agent | 前台阻塞、`waitForProductionRun` 轮询 |
| P1 | `ctx.subagents.registerProvider` | 注册 `studio-crew` provider：包装 `spawn`，按角色注入 `persona` 与 `toolFilter`（只允许 `structured_output`） | `child-policy.js`、`restrictedNovelParents`、`agent/created` 监听、guidance 豁免前言 |
| P1 | `present` 工具 + 显式 `send_file` | `deliver-drama` 完成即在 Deliverables 卡片呈现成片并发送 | pre-ask 钩子的"顺带推送全部节点" |
| P2 | `ctx.approval` / `ctx.userQuestions` | 可配置审核档位（见 5.1） | "先 awaiting_human 再自动批准"的假审核 |
| P2 | `ctx.skills.register` | 从包内直接注册 bundled skills | `skills/sync.js` 的拷贝、戳、哈希、刷新开关 |
| P3 | 多模态子代理 + `attachments` | 抽帧做视觉自检（需先确认 `elysium-chat` 是否支持图像输入） | 填补 `visualReview: not_performed` |
| P3 | 工具 `timeoutMs` 声明 + `exec.signal` 贯通 | 长工具声明预算，取消传到 ComfyUI 轮询 | 永不 abort 的合成 signal |
| 不采用 | agent-team（experimental）、goal-round-driver（重启后需人工 resume）、schedule、PTC、webhook | 收益低或不稳定 | — |
| 不采用 | `ctx.sessionProjections.register`（O7） | 进度已有 job 进度、五条 todo、画布三处展示，再加投影与客户端订阅只增加代码 | — |

### 4.3 读 Harness 源码核实的关键事实（决定方案边界）

1. **`ctx.jobs` 是内存态**，进程重启后 job 消失（`dsh-jobs/README.md` Known Limitations）。→ 持久性仍必须由 ProductionRun + Worker 保证；job 只是可观测、可取消的句柄。这修正了 `2026-10-07-durable-production-architecture.md` 中"Harness 负责暂停、恢复和已完成节点不重复执行"的前提。
2. **`workflow/agent-end` 事件不带结果值**，只有 `outcome`（`dsh-workflow/lib/types/types.d.ts:99-103`）。→ 不能把整阶段合成一个 workflow run 再靠事件逐条落盘。**保留"每任务一次 workflow 调用"**，改为 `Promise.allSettled` + 成功即落盘。
3. **workflow 工具 `run_in_background: true`** 会把 run 注册为调用方拥有的 `workflow` job；root transport 时成员事件仍写入调用方会话（`dsh-tool-workflow/README.md:42,78`）。但插件是在自己的 JS 编排里多次调用 workflow，**turn 结束后 root exec 是否仍能把事件记入会话，需要运行时探针**。历史上后台化曾导致 Todo 和子智能体不可见（`tasks/todo.md` "对话任务计划与 Subagent 可见性回归"）。
4. **`SubagentProvider` 是完整实现契约**（`dsh-subagent/lib/types/types.d.ts:327`）。`studio-crew` 需要包装 `ctx.subagents.getProvider('spawn')` 并注入 `persona`/`toolFilter`；需探针确认 `spawn` 的 capabilities 是否支持这两项。子代理深度不变（lessons：默认 `maxDepth=1`，协调者不能改成 depth=1 子代理）。
5. **`dsh-tool-call-timeout-policy` 只对声明了 `timeoutMs` 的工具生效**，插件工具未声明，因此当前不会被强制超时。

---

## 5. 已确认的决策

### 5.1 审核档位：可配置，默认全自动

- 新增插件配置项 `reviewMode`，只有两档：`auto`（默认，等同现行为）、`key-stages`（故事圣经、资产卡、分镜三处人审）。逐镜人审暂不做，确有需要再加（O8）。
- `auto` 下**行为与现在完全一致**。
- 非 `auto` 时：ReviewTask 仍是权威记录；交互经 `ctx.approval.request`；Approval 不可用或无人应答时 fail-closed，任务保持 `awaiting_human`，可在 Studio 审核队列处理。

### 5.2 承载方式：整部剧改为后台 job

- `studio_novel_create` 启动后立即返回 `{ projectId, runId, jobId }`。
- 小说根任务由 Worker 执行（A5/O1），Worker 是唯一流程驱动者；job 只是这个根任务的进度与取消句柄。
- 持久性仍由 ProductionRun + Worker 保证；宿主重启后 Worker 恢复 Run，并重新挂一个 job 句柄。
- **前置条件**：第 7 节任务 B1 探针通过。不通过则保留前台承载，只做 signal 贯通和超时声明。

### 5.3 运行契约（所有任务都必须满足）

以现有 Project / ProductionRun 为业务恢复的唯一事实；Harness 提供 Agent 执行、会话与展示；媒体 Worker 只消费确定任务。

1. 一次生产请求有明确、持久的根身份；重试沿用该身份，另做一版才创建新身份。
2. 每个子任务只对本次输入版本负责；完成一个就校验并持久化一个。
3. 成功的条件是产物有效且已落盘；失败、降级、需复核分别记录。
4. 每次恢复必须绑定到一个任务消费者；状态变成 ready 不等于已经恢复执行。
5. 外部生成与本地物化分开记录；已有远程结果时优先补写本地，不得无理由重新生成。
6. UI 用同一根身份关联任务与返工；当前尝试、历史失败、有效产物分别展示。
7. 旧执行失去租约后不能再提交成果；新执行必须有可验证的代次。
8. 完成必须核对镜头覆盖、媒体版本、成片文件，不以模型一句"完成"或 Todo 完成为依据。

### 5.4 简化决策（2026-10-08 用户确认）

目标：用简单的编码实现强大稳定的功能，能力尽量下沉到 Harness 与模型。

| # | 决策 | 落在 |
|---|---|---|
| O1 | 小说根任务交给 Worker 执行，Worker 是唯一流程驱动者；删除根任务自管租约与 `novel-text` 固定租约 | A5、C2 |
| O3 | 提交对账只做"客户端指定 prompt_id"一种形态，不支持就放弃 | B5、C7 |
| O4 | 先删死代码（D1）再修 bug | 第 7 节执行顺序 |
| O5 | 阶段对象只声明 phases，文本节点从 JSON 推导、任务 kind 从 handlers 推导；阶段顺序由 catalog 决定，JSON `dependsOn` 只做一致性校验 | 6A.1、D5 |
| O6 | 角色 persona 文本移出代码，改提示词不改代码（2026-10-08 由 S6 细化：放包根 `agents/*.md`，不放 pipeline JSON） | C1、6A |
| S5–S7 | 目录按扩展点组织（tools / hooks / agents / skills）、角色即智能体定义文件、工具清单唯一（2026-10-08 用户确认"结构对齐 Claude Code，能力后续迭代"） | 6A、C1、D3b |
| O7 | 不使用 sessionProjections | 4.2 |
| O8 | 审核档位只有 `auto` / `key-stages` 两档 | 5.1、C5 |

未采纳：O2（A7 改为单进程执行集合），A7 保持执行代次方案。

---

## 6. 目标形态

插件只保留四个独有核心：

```
领域   M4  Project / 命令 / 失效 / 门禁          ← 不动
调度   M5  持久 Run / Task / Worker             ← 不动；新增 job 句柄挂接
生成   M6  档位 → manifest → ComfyUI → Attempt   ← 逻辑不变，最后搬出 index.js
流水线 M2  pipeline JSON → 每任务 workflow 调用  ← JSON 声明节点，顺序由阶段目录决定
阶段       6 个固定业务阶段，各自持有文本节点 / 媒体任务 / handler / 完成判定 / 进度  ← 唯一阶段目录（6A）
```

Harness 承担：子代理装配与限权（subagents provider）、长任务承载与进度（jobs）、交付呈现（present / send_file）、人审交互（approval）、对话侧进度（todo）、Skill 分发（skills.register）。

模型承担：角色 persona 放在包根 `agents/*.md`（S6），改创作要求只改数据不改代码；插件只保留模型做不到、必须确定的部分（Schema、覆盖校验、稳定 id、依赖与状态）。

预计删除：`child-policy.js`、`skills/sync.js` 大部分、`withProductionAgent`、`waitForProductionRun`、`runNovelRootInCallingSession` 与根任务手工租约、文本执行的固定 `novel-text` 租约、pre-ask 全量推送逻辑、两套重复返工栈、`dag-executor.js` 及其它无引用模块。

---

## 6A. 最终 `lib/` 结构（重构完成后的唯一目标）

这是全部任务完成后 `lib/` 必须呈现的样子。已采纳七项结构设计（S1–S4、S5–S7，均为 2026-10-08 用户确认；S5–S7 的目标是结构对齐 Claude Code，结构一次定型，能力后续迭代）：

- **S1 唯一阶段目录**：6 个业务阶段只定义一次，调度、门禁、画布、studio 共用。
- **S2 扩展层边界**：读宿主 `ctx` 的代码只在扩展层（`tools/`、`hooks/`、`agents/`、`routes/`、`harness/`）与 `runtime.js`、`index.js`；其余目录不知道 Harness 存在。
- **S3 内部工具改函数**：只被插件自己调用、对 Agent 全部屏蔽的 7 个 `studio_*_submit` 工具改为普通函数。
- **S4 按阶段切片**：每个业务阶段一个目录，放该阶段的文本节点、媒体任务、Worker handler、完成判定与进度。
- **S5 按扩展点组织（对齐 Claude Code）**：顶层目录先回答"模型能用什么"——工具（`tools/`）、钩子（`hooks/`）、子智能体（`agents/`）、技能（包根 `skills/`），再往下才是领域与引擎。新增能力时先判断它属于哪个扩展点，而不是新开目录。工具说明（description）就是写给模型的使用手册，与工具代码放在同一文件；系统提示词只放全局原则。
- **S6 角色即智能体定义文件**：6 类生产角色写成包根 `agents/<role>.md`（frontmatter 声明 name / label / tools，正文是 persona），与 Claude Code 的 `.claude/agents/*.md` 和本项目已有的 `skills/*/SKILL.md` 同一风格；pipeline JSON 节点继续用现有 `role` 字段引用（取代 O6 的 JSON `roles` 段，O6"改提示词不改代码"的目标不变）。
- **S7 工具清单唯一**：`tools/index.js` 列出全部工具及可见性，入口门禁、文档、扫描都从它推导，不再在别处维护工具名单。

文件名必须直接说明职责（AGENTS.md）。阶段只有固定的 6 个，**不是通用 DAG**：`stages/` 是一张有序清单，不是调度引擎。

### 6A.1 目录树

包根（与 Claude Code 的 `.claude/{agents,skills}` 同构：能力是数据文件，代码只负责加载）：

```
agents/                             【S6 新增】生产角色定义，一个角色一个文件
│   story.md  script.md  assets.md  storyboard.md  shot.md  delivery.md
│                                   ← lib/agents/roles.js 的 name / instruction 原文搬入；frontmatter：
│                                     name（= pipeline 节点 role）、label、tools: [structured_output]
skills/                             不变：elysium-generate-* 运行时操作契约（C6 改由 ctx.skills.register 注册）
pipelines/                          不变：novel-to-drama-text.pipeline.json（节点 role 字段不变，不新增 roles 段）
schemas/  workflows/  studio/       不变
lib/                                见下
```

```
lib/
├── index.js                        插件入口：name / inject / apply()；只做装配，< 300 行
├── runtime.js                      createStudioRuntime(ctx)：创建 FileService、projectService、画布 adapter、
│                                   能力注册表、Worker；替代 index.js 的 6 个模块级 let
├── config.js                       不变
├── client.js                       不变：浏览器端入口（package.json exports "./client"）
│
├── tools/                          【S5 模型可见面】一个文件一个工具族，统一形状（见下方"工具统一形状"）
│   ├── index.js                    allTools(runtime)：全部工具的唯一清单，每项带 visibility（'root' | 'workflow-internal'）（S7）
│   ├── novel-tools.js              studio_novel_create / studio_novel_orchestrate / studio_batch_generate /
│   │                               studio_deliverable_export；业务体调用 pipeline/novel-orchestrator.js
│   ├── project-tools.js            领域工具 studio_project_* / episode_* / shot_* / review_* / production_* /
│   │                               timeline_* / attempt_* / rights_* 等（含 studio_project_get 等只读工具）
│   ├── source-tools.js             studio_source_import / studio_source_read（原 script/tools.js 去掉 *_submit 后的剩余部分）
│   ├── generation-tools.js         comfy_generate_image / comfy_generate_video / comfy_render
│   ├── canvas-tools.js             canvas_list_nodes / write_node / get_node / group_nodes / reorder / get_state / set_state
│   ├── media-post-tools.js         video_concat / extract_frame / video_upscale
│   ├── workflow-tools.js           comfy_list_workflows / comfy_workflow_inspect / preview / verify
│   └── asset-tools.js              asset_list / asset_to_canvas
│                                   （阶段二 E2 在此新增 rework-tools.js，不改其它文件结构）
│
├── hooks/                          【S5】工具调用前后的拦截，一个钩子一个文件
│   ├── h3-prompt-gate.js           不变
│   ├── novel-entry-gate.js         拦截名单改为从 tools/index.js 中 visibility='workflow-internal' 推导（S7），
│   │                               随 S3 从 12 个缩为 5 个
│   └── pre-ask-delivery.js         C3 后只推送显式标记的中间稿
│
├── agents/                         【S5 + S6】子智能体：定义在包根 agents/*.md，这里只做加载与执行
│   ├── agent-definitions.js        读取包根 agents/*.md（frontmatter + 正文 persona），校验 pipeline 节点 role 都有定义
│   ├── crew-provider.js            C1：studio-crew SubagentProvider，persona / toolFilter 取自 agent 定义
│   └── workflow-runner.js          runProductionWorkflow：调用 Harness workflow 工具（A2：allSettled）  ← agents/workflow.js
│
├── routes/                         HTTP：studio 画布 UI 的接口（Claude Code 无对应物，属本项目界面层）
│   ├── http-router.js              前缀注册、token 校验、路由表分发、studio 静态页、/media 伺服、/api/config、/api/workflows
│   ├── http-utils.js               HttpError / sendJson / requestJson / contentType / safeRelative / inside
│   ├── project-routes.js           /api/projects/**
│   └── canvas-routes.js            /api/canvas**、/api/assets**、/api/generate/{image,video}
│
├── harness/                        宿主服务适配（不是扩展点）：jobs、storage、skills、system prompt、工作区
│   ├── production-job.js           C2：ctx.jobs 句柄挂接、进度上报、重启后重挂；吸收 observability.js
│   ├── project-repository.js       HarnessProjectRepository：ctx.storage.domain 打开与读写     ← domain/service.js
│   ├── workspace-resolver.js       resolveSessionRoot / resolveFromQuery
│   ├── system-prompt.js            GUIDANCE 文本 + systemPrompt.section 注册（只放全局原则，见 S5 说明）
│   └── skill-registration.js       C6：ctx.skills.register（注册包根 skills/）
│
├── stages/                         【S1 + S4】6 个固定业务阶段，顺序即生产顺序
│   ├── catalog.js                  有序阶段清单 + 查询：stageOfTaskKind、stageOfNode（经 phase 映射）、
│   │                               allHandlers()、productionProgress(project)（汇总各阶段 progress）
│   ├── analysis/                   故事分析（key: analysis，含分集规划）
│   │   ├── index.js                阶段定义：key / label / role / phases / 完成判定 / progress
│   │   ├── source-text.js          原文归一化、存储、分段读取            ← script/source-service.js
│   │   └── analysis-text.js        source-summary / story-reconcile / episode-plan 的请求、校验、提交
│   ├── scripts/                    分集剧本（key: scripts）
│   │   ├── index.js                role(script)
│   │   └── script-text.js          episode-script：episodeDraftSchema / assertEpisodeDraft / assertEpisodeCoverage
│   ├── assets/                     资产设定（key: assets）
│   │   ├── index.js                role(assets)；完成判定 = 当前签名的必需参考图全部 approved（lessons 36）
│   │   ├── asset-text.js           asset-extraction / asset-prompt / asset-commit       ← script/asset-production.js
│   │   └── reference-images.js     render-reference 的规划、就绪门禁与 handler        ← drama.js + renderPreparation
│   ├── storyboard/                 分镜预览（key: storyboard）
│   │   ├── index.js                role(storyboard)
│   │   ├── shot-plan-text.js       shot-plan：episodeStoryboardSchema / groundedStoryboardFallback / assertStoryboard / storyboardPrompt
│   │   └── storyboard-images.js    storyboard-prompt 请求 + render-storyboard 规划与 handler
│   ├── shot-video/                 镜头视频（key: media，沿用现有 UI/API 键名）
│   │   ├── index.js                role(shot)
│   │   ├── video-prompt-text.js    video-prompt 请求与合并                               ← script/shot-production.js 视频部分
│   │   └── shot-render.js          render-shot 规划与 handler（含时长校验、自动审核）
│   └── delivery/                   成片交付（key: delivery）
│       ├── index.js                role(delivery)
│       ├── assembly.js             concat-video / deliver-drama 的规划与 handler（C3 后经 deliverable-service）
│       ├── deliverable-service.js  DeliveryService：唯一成片交付路径                ← delivery/export.js
│       └── pdf-export.js           文本交付物 HTML/PDF 导出                          ← pdf.js
│
├── pipeline/                       与具体阶段无关的执行机制（只服务上面 6 个阶段）
│   ├── novel-orchestrator.js       小说根任务的 Worker handler 业务体：按 catalog 顺序推进各阶段、成片校验（O1）
│   ├── text-runner.js              文本批处理：runBatch、checkpoint、成功即落盘、失败按 manifest 重试  ← novelTextProduction 通用部分
│   ├── media-planner.js            汇总各阶段的媒体任务规划为一个 Run           ← dramaProductionTasks 组合部分
│   ├── proposal-submit.js          【S3】7 个提案提交函数（原 studio_*_submit 工具的执行体）
│   ├── rework-runner.js            author-creative / revise-text handler，请求经 pipeline-compiler 生成（C4）
│   ├── pipeline-registry.js        加载校验 pipeline JSON；新增校验：dependsOn 与 catalog 阶段顺序一致（O5）；role 定义完整性由 agents/agent-definitions.js 校验（S6）
│   ├── pipeline-compiler.js        不变
│   ├── worker.js                   唯一流程驱动者：持久任务轮询、租约、心跳（A7：执行代次与停止信号；O1：含小说根任务）
│   └── project-commands.js         revision 冲突有界重试                         ← production/commands.js
│
├── generation/                     ComfyUI 生成引擎（与阶段无关，手动支路也用）  ← 原 media/ 与 index.js
│   ├── comfy-client.js             上传、提交、轮询、取输出、下载
│   ├── comfy-request-builder.js    manifest → ComfyUI 请求
│   ├── render.js                   runRender、buildRenderGraph、参考图/源视频解析与上传
│   ├── media-store.js              persistMedia、probeImageSize、parseDataUrlImage、tmpChunkPath、nextArtifactStamp、resolveStoredPath
│   ├── video-size.js               snapLengthToGrid、snap32、allocateChainIndex
│   ├── concat.js                   ffmpeg / ComfyUI 拼接 + runConcat
│   ├── upscale.js                  超分规划 + runUpscale
│   ├── failures.js                 失败分类（A3：local_conflict）
│   └── recovery.js                 Attempt 诊断
│
├── capabilities/                   能力注册表：capability → tier → manifest
│   ├── manifest.js                 manifest 校验、资产解析、graph 编译
│   ├── comfy-export-converter.js   ComfyUI 导出 JSON → manifest 草稿
│   ├── workflow-registry.js        注册表加载与签名、资产覆盖、resolveManifest、参数校验
│   ├── tier-resolution.js          档位解析、实现可用性探测、resolveTieredManifest
│   ├── capability-matrix.js        describeTierMatrix / describeWorkflowsApi / 用户策略展示
│   ├── workflow-bindings.js        不变
│   └── workflow-inspector.js       不变
│
├── canvas/                         手动创作支路与旧画布兼容（M8/M9）
│   ├── legacy-canvas-adapter.js    不变
│   ├── canvas-store.js             loadProject / saveProject / submitProjectCommand / ensureLegacyShot / emptyProject / nextOrder
│   ├── canvas-media.js             importManualImage / copyAssetToCanvas / replaceNodeImage
│   └── asset-library.js            跨会话角色/场景/风格资产库
│
├── projections/                    只读投影（从 domain 移出，因为进度要读阶段目录）
│   ├── canvas-read-model.js        canvasReadModel、projectSummary          ← domain/read-models.js
│   ├── review-read-model.js        reviewQueue、diagnosticsReadModel、attemptList
│   └── production-status.js        productionStatus（studio_production_status 使用）  ← domain/production.js
│
├── domain/                         项目领域：纯函数，不依赖任何上层目录
│   ├── commands/index.js           不变
│   ├── spec.js  state-machines.js  errors.js  invalidation.js  policies.js  creative.js  production.js
│   ├── service.js                  ProjectService（命令执行、CAS、幂等），仓储由 runtime 注入，不再接触 ctx
│   ├── content-editor.js           productionEditor / assertReworkIdle / editableValues    ← domain/rework.js（改名避免三处 rework）
│   ├── rework-tasks.js             返工请求 → 任务列表                      ← production/rework.js
│   ├── proposal-contracts.js       提案校验：contracts.js 全部 + validateAssetExtraction / assetScriptRefs  ← script/
│   ├── output-schemas.js           读取 schemas/production/novel-output.schema.json   ← script/production-schemas.js
│   └── task-roles.js               角色 id 与 task kind → 角色映射（纯数据，persona 在包根 agents/*.md）  ← agents/roles.js 的映射部分
│
├── prompts/                        不变：compiler.js / snapshot.js / specification.js
└── storage/                        files.js / layout.js
```

**阶段模块统一形状**（`stages/<stage>/index.js` 导出一个普通对象，没有基类、没有注册机制）：

```js
export const assetsStage = {
  key: 'assets', label: '资产设定',
  role: 'assets',                                  // 只引用角色 id；persona 在包根 agents/assets.md（S6）
  phases: ['asset-extraction', 'asset-prompts'],   // 对应 pipeline JSON 的 phase id；文本节点由此从 JSON 推导（O5）
  runText,        // 本阶段文本节点执行，调用 pipeline/text-runner.js 的 runBatch（原 novelTextProduction 对应段）
  planMedia,      // 本阶段媒体任务规划（原 drama.js 对应段），没有媒体任务的阶段省略
  handlers,       // { 'render-reference': fn }；任务 kind 即其键名，Worker 从 catalog.allHandlers() 取
  isComplete,     // 完成判定（复用 domain/policies.js，不另写规则）
  progress,       // 本阶段进度（原 productionProgress 对应段）
}
```

**工具统一形状**（`tools/*.js` 每个工具一个普通对象，对应 Claude Code 的 Tool 契约；现有 `defineTool` 参数不变）：

```js
export const novelCreateTool = {
  name: 'studio_novel_create',
  visibility: 'root',          // 'root' = 主 Agent 可调；'workflow-internal' = 仅 workflow 子代理可调（S7）
  readOnly: false,
  description: '…',            // 写给模型的使用手册，逐字沿用现有文本
  parameters: { … },           // 不变
  timeoutMs,                   // 可选
  execute: (args, exec) => …,  // 只做参数整理与结果格式化，业务体在 pipeline/ 或 stages/
}
```

**智能体定义文件示例**（`agents/assets.md`）：

```md
---
name: assets
label: 角色
tools: [structured_output]
---
从正式剧本提取角色、场景、道具与衍生状态，编写每项完整图片提示词。沿用稳定 id，标记剧本使用位置，不改变剧情。
```

不再单独声明文本节点和任务 kind 清单（O5）：文本节点 = JSON 中 `phase` 属于本阶段 `phases` 的节点；任务 kind = `Object.keys(handlers)`。同一事实只写一处。

阶段与 pipeline phase 的对应：

| 阶段 key | phases |
|---|---|
| analysis | `analysis`、`episode-planning` |
| scripts | `scripts` |
| assets | `asset-extraction`、`asset-prompts` |
| storyboard | `shot-planning`、`storyboard-prompts` |
| media（shot-video） | `video-prompts` |
| delivery | 无文本节点 |

`catalog.js` 只是 `[analysis, scripts, assets, storyboard, shotVideo, delivery]` 加若干查询函数，**阶段顺序由它决定**；registry 加载 pipeline JSON 时校验每个节点的 `dependsOn` 不指向更晚阶段，保证 JSON 与 catalog 不会分叉。画布读模型把 `catalog` 的 key/label/状态随 `/canvas` 返回，`studio/stages.js` 改为使用接口返回的阶段清单；手动支路的无阶段节点继续用现有正则兜底。

**命名提醒**（现有代码，不改名，避免改持久数据）：提案 kind `episode_draft` = 分集剧本，`episode_script` = 镜头规划（由 shot-plan 提交）。代码注释中写明即可。

### 6A.2 现有文件 → 目标位置

**整文件迁移或改名**（D3a，纯 `git mv` + 改 import）：

| 现在 | 目标 |
|---|---|
| `lib/hooks/*.js` | 原位不动 |
| `lib/guidance.js` | `lib/harness/system-prompt.js` |
| `lib/agents/workflow.js` | `lib/agents/workflow-runner.js`（改名） |
| `lib/domain/tools.js` | `lib/tools/project-tools.js` |
| `lib/script/tools.js` | `lib/tools/source-tools.js`（`*_submit` 部分在 D4 移出） |
| `lib/domain/service.js` 的 `HarnessProjectRepository` | `lib/harness/project-repository.js`（`createHarnessProjectService` 的装配移到 `runtime.js`） |
| `lib/production/observability.js` | 并入 `lib/harness/production-job.js`（C2） |
| `lib/skills/sync.js` | `lib/harness/skill-registration.js`（C6） |
| `lib/production/commands.js` | `lib/pipeline/project-commands.js` |
| `lib/production/worker.js`、`pipeline-registry.js`、`pipeline-compiler.js` | `lib/pipeline/` 同名 |
| `lib/production/rework.js` | `lib/domain/rework-tasks.js` |
| `lib/domain/rework.js` | `lib/domain/content-editor.js` |
| `lib/script/contracts.js` | `lib/domain/proposal-contracts.js` |
| `lib/script/production-schemas.js` | `lib/domain/output-schemas.js` |
| `lib/script/source-service.js` | `lib/stages/analysis/source-text.js` |
| `lib/delivery/export.js` | `lib/stages/delivery/deliverable-service.js` |
| `lib/pdf.js` | `lib/stages/delivery/pdf-export.js` |
| `lib/media/failures.js`、`recovery.js` | `lib/generation/` 同名 |
| `lib/comfy/request-builder.js` | `lib/generation/comfy-request-builder.js` |
| `lib/concat.js`、`lib/upscale.js` | `lib/generation/` 同名 |
| `lib/manifest.js` | `lib/capabilities/manifest.js` |
| `lib/convert.js` | `lib/capabilities/comfy-export-converter.js` |
| `lib/compat/legacy-canvas-adapter.js` | `lib/canvas/legacy-canvas-adapter.js` |
| `lib/assets.js` | `lib/canvas/asset-library.js` |

**按阶段拆分的文件**（D5，函数体逐字搬）：

| 现在 | 拆到 |
|---|---|
| `script/novel-production.js` 的 `novelTextProduction`（62–314） | 通用部分（execute / ensureRun / appendTasks / runBatch，约 62–170 行区段）→ `pipeline/text-runner.js`；source-summary / story-reconcile / episode-plan 段 → `stages/analysis/analysis-text.js`；episode-script 段 → `stages/scripts/script-text.js`；asset 段 → `stages/assets/asset-text.js`；shot-plan / storyboard-prompt / video-prompt 段 → `stages/storyboard/`、`stages/shot-video/`；seal → `pipeline/novel-orchestrator.js` |
| `script/novel-production.js` 的校验函数（315–432） | `assertNovelCoverage` / `materializeEpisodeSourceSpans` / `assertNovelPlan` → analysis；`assertEpisodeDraft` / `assertEpisodeCoverage` / `episodeDraftSchema` → scripts；`assertAssetDesign` → assets；`assertStoryboard` / `storyboardPrompt` / `episodeStoryboardSchema` / `groundedStoryboardFallback` → storyboard |
| `script/asset-production.js` | `validateAssetExtraction` / `assetScriptRefs` 及其依赖 → `domain/proposal-contracts.js`（domain/creative.js 要用）；其余 → `stages/assets/asset-text.js` |
| `script/shot-production.js` | 图片提示词部分 → `stages/storyboard/storyboard-images.js`；视频提示词部分 → `stages/shot-video/video-prompt-text.js` |
| `production/drama.js` | `assetReference*` → `stages/assets/reference-images.js`；`dramaProductionTasks` 中各 kind 的任务构造 → 对应阶段 `planMedia`；组合与依赖串接 → `pipeline/media-planner.js` |
| `agents/roles.js` | 角色名称与指令文本 → 包根 `agents/<role>.md`（C1 完成，S6）；id 与 task kind 映射 → `domain/task-roles.js` |
| `agents/media.js` | 逻辑只是"换入已保存提示词"，并入 `stages/shot-video/shot-render.js` 与 `stages/storyboard/storyboard-images.js` 的 handler 前置步骤；删除文件 |
| `domain/read-models.js` | `productionProgress` 各段 → 各阶段 `progress`，汇总在 `stages/catalog.js`；`canvasReadModel` / `projectSummary` → `projections/canvas-read-model.js`；`reviewQueue` / `diagnosticsReadModel` / `attemptList` → `projections/review-read-model.js` |
| `domain/production.js` 的 `productionStatus` | `projections/production-status.js`（domain 不再 import 进度） |
| `script/rework.js`、`script/creative-rework.js` | `pipeline/rework-runner.js`（C4） |

**从 `lib/index.js` 拆出**（D3b，函数体逐字搬，行号为 2026-10-08 基线）：

| index.js 内容 | 约在行 | 目标 |
|---|---|---|
| HttpError / sendJson / safeRelative / inside / requestJson / contentType | 121–216 | `routes/http-utils.js` |
| resolveStoredPath / nextArtifactStamp / mediaDelivery | 218–238 | `generation/media-store.js` |
| humanSize / mediaResultDetail / renderResolutionNote / intArg / floatArg | 239–270、966–979 | `tools/generation-tools.js` |
| comfyFetch / comfySubmit / comfyWait / comfyOutputs / comfyDownload / comfyUploadImage | 271–376 | `generation/comfy-client.js` |
| buildFluxImageWorkflow / buildH3VideoWorkflow / buildH3ImageToVideoWorkflow | 377–406、453–561 | **删除**（D1） |
| VIDEO_MODE_LONG / VIDEO_MODE_DEFAULT / computeVideoSize | 411–451 | **删除**（D1，只被死函数使用） |
| allocateChainIndex / snapLengthToGrid / snap32 | 414–431 | `generation/video-size.js` |
| projectDir / emptyProject / loadProject / saveProject / submitProjectCommand / ensureLegacyShot / nextOrder | 563–618 | `canvas/canvas-store.js` |
| resolveSessionRoot | 620–645 | `harness/workspace-resolver.js` |
| probeImageSize / persistMedia / parseDataUrlImage | 647–727 | `generation/media-store.js` |
| importManualImage / copyAssetToCanvas / replaceNodeImage | 728–840 | `canvas/canvas-media.js` |
| runImageGeneration / runVideoGeneration | 842–964 | **删除**（D1） |
| manifestSignature / reloadRegistry / getRegistry / getPreferred / resolvePinnedImplementation / getAssetOverrides / validateVideoArgs / resolveManifest / resolveMode / computeManifestSize / manifestDeliverySize / resolutionLockWarning / chainGraphMismatch | 983–1327 | `capabilities/workflow-registry.js` |
| sortTierCandidates … resolveTieredManifest（含 probeNodeClass / checkAvailability / assertImplementationUsable / tierFromArgs 等） | 1328–1599 | `capabilities/tier-resolution.js` |
| projectCapabilityStrategies … describeWorkflowsApi / effectiveAssetsOf | 1600–1858 | `capabilities/capability-matrix.js` |
| buildRenderGraph / uploadCanvasNodeImage / resolveRefImage / resolveSourceVideo / runRender | 1860–2275 | `generation/render.js` |
| runConcat | 2276–2372 | `generation/concat.js` |
| runUpscale / tmpChunkPath | 2373–2557 | `generation/upscale.js`（tmpChunkPath → `generation/media-store.js`） |
| makeTools | 2582–3384 | 按 6A.1 拆入 `tools/*.js` |
| makeRoutes / requireToken | 3386–3865 | 按 6A.1 拆入 `routes/*.js` |
| apply() 内服务创建 | 3881–3899 | `runtime.js` |
| apply() 内 approveGeneratedAsset / renderPreparation | 3900–3933 | 资产与分镜的 handler：`stages/assets/reference-images.js`、`stages/storyboard/storyboard-images.js`；approveGeneratedAsset 两处共用，放 `pipeline/media-planner.js` 旁的 `pipeline/auto-review.js`（C5 后读取 reviewMode） |
| apply() 内 Worker handlers | 4008–4131 | render-shot → `stages/shot-video/shot-render.js`；concat-video / deliver-drama → `stages/delivery/assembly.js`；author-creative / revise-text → `pipeline/rework-runner.js` |
| apply() 内 withProductionAgent / waitForProductionRun / runNovelRootInCallingSession / latestDramaRun / verifyCompletedDramaRun | 3934–4007、4333–4395 | `pipeline/novel-orchestrator.js`（A5 后 runNovelRootInCallingSession 删除；C2 后 withProductionAgent、waitForProductionRun 删除；涉及 ctx 的部分进 `harness/production-job.js`） |
| apply() 内 studio_novel_orchestrate / studio_novel_create / studio_batch_generate / studio_deliverable_export | 4181–4636 | 工具定义 → `tools/novel-tools.js`；业务体 → `pipeline/novel-orchestrator.js` |
| apply() 内注册（tools / hooks / systemPrompt / routes / effect 清理） | 4637–4682 | 留在 `index.js` |

**删除且不再出现**：`comfy/`、`compat/`、`delivery/`（迁入 stages）、`diagnostics/`、`media/`（迁入 generation）、`production/`（迁入 pipeline / stages / domain）、`review/`、`rights/`、`script/`（迁入 stages / domain / pipeline）、`lib/skills/`（包根 `skills/` 保留）、`timeline/`；`lib/agents/roles.js`、`lib/agents/media.js`；`capabilities/registry.js`、`capabilities/validation.js`、`domain/lease.js`、`domain/outbox.js`、`domain/read-models.js`、`gateway.js`、`storage/gc.js`、`storage/locator.js`、`storage/migrations.js`、`script/child-policy.js`（C1）。

### 6A.3 依赖方向

```
index.js → runtime.js → tools/ · hooks/ · agents/ · routes/ · harness/
扩展层（tools/ hooks/ agents/ routes/ harness/）→ pipeline/ · stages/ · projections/ · generation/ · capabilities/ · canvas/ · domain/ · prompts/ · storage/
pipeline/     → stages/ · generation/ · domain/ · prompts/ · storage/
stages/       → generation/ · capabilities/ · domain/ · prompts/ · storage/
projections/  → stages/catalog.js · domain/ · prompts/ · generation/recovery.js
generation/   → capabilities/ · canvas/ · domain/ · storage/
canvas/       → projections/canvas-read-model.js · domain/ · storage/
capabilities/ → storage/
domain/       → prompts/ · storage/layout.js   （基础层，不依赖任何其它目录）
prompts/      → domain/errors.js · domain/output-schemas.js
```

- **只有扩展层（`tools/`、`hooks/`、`agents/`、`routes/`、`harness/`）与 `runtime.js`、`index.js` 可以读宿主 `ctx`**。`stages/` 与 `pipeline/` 需要调用 Agent 时，通过参数拿到 `agents/workflow-runner.js` 提供的 `runWorkflow` 函数。
- 扩展层内部：`tools/` 可调用 `harness/`、`agents/`；`hooks/` 只读 `tools/index.js` 的清单；扩展层之间不形成环。
- `stages/` 之间不互相 import；跨阶段的数据只通过 Project 读取，跨阶段顺序只由 `catalog.js` 决定。
- **原有的 4 处反向依赖全部消除**：`domain/commands` → `script/contracts.js`、`production/rework.js`；`domain/creative` → `script/asset-production.js`；`domain/production` → `agents/roles.js`、`domain/read-models.js` → `media/recovery.js`。方法是把被依赖的纯函数下沉到 `domain/`，把读模型上移到 `projections/`。

### 6A.4 规模目标

| 指标 | 基线（2026-10-08） | 目标 |
|---|---|---|
| `lib/index.js` | 4682 行 | < 300 行 |
| 单文件最大行数 | 4682（index.js） | ≤ 800（`domain/commands/index.js` 768 行，本次不拆） |
| `lib/` 总行数 | 约 14,253 | 净减少 ≥ 1,500 |
| `lib/` 顶层目录 | 18 个 + 11 个根文件 | 14 个（扩展层 5 + 阶段与引擎 9）+ 4 个根文件 |
| 工具名单维护处 | 2 处（注册处、`novel-entry-gate.js` 硬编码） | 1 处（`tools/index.js`） |
| 角色定义处 | `lib/agents/roles.js`（代码） | 包根 `agents/*.md`（数据） |
| 模块级可变状态 | 6 个 `let` | 0 |
| 无引用模块 | 17 个 | 0 |
| 业务阶段定义处 | 5 处（Episode 状态、pipeline phases、任务 kind、read-models 字符串推断、studio/stages.js） | 1 处（`stages/catalog.js`；Episode 状态枚举与 pipeline JSON 保留但由 catalog 声明对应关系） |
| 读宿主 ctx 的目录 | 散在 index.js、domain/service.js、hooks、script/child-policy、production/observability | 只有扩展层（tools / hooks / agents / routes / harness）与 `runtime.js`、`index.js` |
| 反向依赖 | 4 处 | 0 |

---

## 7. 执行任务清单（Codex 按顺序执行）

每个任务的格式：目标 / 改动 / 禁止 / 验收。标注【需人工验收】的任务完成后暂停，等用户在 3080 上确认后再继续下一阶段。

**执行顺序：D1 → A → B → C → D2 → D3a → D3b → D4 → D5**。D1 只删无引用代码、零行为风险，先做可以让后续每个任务的 diff 和引用扫描更干净（O4）。D1 的内容写在阶段 D 中，编号不变。

### 阶段 A：修复确定断点（行为修正，不做结构调整）

**A1 批量范围只取正式镜头（D1）**
- 改动：`studio_batch_generate`（`lib/index.js` 约 4608）与 `dramaProductionTasks`（`lib/production/drama.js`）的镜头范围只取正式分集（排除 `legacy-main`）中、具备正式剧本的镜头；参考图和分镜辅助图不得进入视频或拼接候选。
- 禁止：放宽剧本或参考图门禁来绕过错误。
- 验收：静态检查；【需人工验收】在已有 `legacy-main` 辅助图的项目上执行批量生成，只生成正式镜头。

**A2 批次异常隔离、成功即落盘（D3）**
- 改动：`lib/agents/workflow.js` 改用 `Promise.allSettled`，每个任务的异常只影响自己；`lib/script/novel-production.js` 的 `runBatch` 对每个成功结果立即校验并 checkpoint，失败任务单独按 manifest 重试策略处理，耗尽后再把 Run 收敛为 failed。
- 禁止：增加重试次数或延长超时来掩盖问题。
- 验收：静态检查；【需人工验收】可在下一次真实流程中观察，若有单任务失败，同批成功任务不被重跑。

**A3 失败分类区分本地冲突（D4）**
- 改动：`lib/media/failures.js` 的 `classifyGenerationFailure` 识别 `DomainConflictError`（或 `revision conflict` 文本），归类为新的 `local_conflict`，`retryable: true`，`submissionUncertain: false`；调用方对 `local_conflict` 走"用同一 promptId 补写本地结果"，不重新提交远程生成。
- 附加（写给模型看的报错）：`classifyGenerationFailure` 的返回值增加 `nextStep` 字段，按 `failureClass` 查一张固定表生成一句可执行的下一步（例：`transient_network` →"远程暂时不可达，Worker 会按重试策略自动重试，无需重复调用"；`invalid_input` →"输入不合法，请用户在画布上修改 <字段> 后重做该节点"（阶段二 E2 上线后改为指向 studio_rework）；`configuration` →"档位或工作流未配置，停止并告知用户，不要换档重试"；`local_conflict` →"本地版本冲突，已用同一 promptId 补写，无需操作"）。`studio_*` / `comfy_*` 工具在失败结果里带上 `failureClass` 与 `nextStep`；`novel-entry-gate.js` 的拒绝原因同样写明"该做什么"而不只是"不能做什么"。
- 禁止：把提示文字拼进错误 `message`——分类靠正则匹配 message，追加文字（如含 missing、timeout）会改变分类结果；不得改动现有错误码前缀（`comfy-unreachable:`、`workflow-validation:` 等）。
- 验收：静态检查；用 `node -e` 直接调用函数确认分类结果与 `nextStep`（一次性命令，不落地为测试文件）。

**A4 降级结果显式标记（D6）**
- 改动：`novel-production.js` 中 fallback 物化的产物在 checkpoint 和 proposal 中写 `degraded: true` 与原因；`read-models.js` 将其投影为"需复核"状态。**是否继续推进的行为不变**。
- 验收：静态检查；【需人工验收】降级产物在画布上可见"需复核"标记。

**A5 小说根任务交给 Worker 执行（D2，O1）**
- 改动：为 `novel-production-root` 注册 Worker handler，业务体就是现在 `studio_novel_orchestrate` 的编排；Worker 成为唯一流程驱动者。画布"重试"只需 `resumeProductionRun` + `worker.drain()`，与媒体 Run 的重试走同一条路。删除 `runNovelRootInCallingSession` 中独立的租约与心跳；文本任务不再使用固定 owner `novel-text` 与 30 分钟租约，改用执行根任务的 Worker owner 并随 Worker 心跳续约。
- 可见性保持：`studio_novel_create` 在 C2 之前仍前台等待根任务结束，并通过现有 `activeNovelExecs` 把调用方 exec 交给 handler，使 Workflow 事件继续记入用户会话（lessons 45、50）；调用方不在时 handler 按现有方式回退到协调会话。
- 禁止：只改状态不唤醒执行者；改变任务 kind、id、run id；新增调度概念。
- 验收：静态检查；【需人工验收】① 页面单次发起，Workflow 子智能体仍在用户会话中可见；② 根 Run 失败后点画布"重试"，流程继续推进；③ 宿主重启后根任务由 Worker 自动续跑。

**A6 画布按根 Run 关联状态（D5）**
- 改动：`ProductionRun` 增加可选字段 `rootRunId`（新建返工/媒体 Run 时写入，旧数据缺省视为根）；`read-models.js` 与 `studio/app.js` 按根 Run 聚合阶段与失败提示，不再按"最新 5 个 Run"猜测。
- 禁止：改 Project schemaVersion（新增可选字段不需要）。
- 验收：【需人工验收】单镜返工完成后，总览仍显示根流程状态，失败提示不被新 Run 隐藏。

**A7 租约执行代次与停止语义（R1、R3）**
- 改动：以现有 `attemptNumber`（或租约次数）作为执行代次；领取任务时把代次交给 handler，`checkpoint/complete/fail` 命令携带代次，`assertOwner` 同时校验 owner 与代次，不符即拒绝。Worker 心跳失败或租约被他人接管时 abort 该 handler 的 signal；`Worker.stop` 向所有 handler 发停止信号后再等待。
- 禁止：引入新的 Fencing/调度概念或新的状态机；不改任务 kind 与 id。
- 验收：静态检查；用 `node -e` 对内存 Project 调用命令处理器，确认旧代次提交被拒（一次性命令，不落地为测试文件）。

### 阶段 B：Harness 运行时探针（只读实验，不改业务代码）

需要用户同意后在 3080 宿主上执行；探针代码写在临时目录，结束后删除，不提交。

**B1 后台 job 内 workflow 事件可见性**：在一个临时插件里用 `ctx.jobs.start` 包住一次 workflow 调用，调用方 turn 结束后观察：父会话是否出现 run/phase/member 事件，子智能体是否可点开，job 面板是否显示进度，完成时主 Agent 是否被唤醒。
**B2 studio-crew provider**：注册包装 `spawn` 的 provider，workflow 脚本 `agent(prompt, { provider: 'studio-crew' })`，确认 persona 生效、子代理只能调用 `structured_output`、深度不变。
**B3 present 与 send_file**：确认在后台 job（无打开 turn）中能否调用；不能则记录，C3 改为在主 Agent 被唤醒的 turn 中交付。
**B4 attachments 多模态**：确认 `elysium-chat` 是否接受图像输入（决定后续视觉自检是否可做）。
**B5 ComfyUI 客户端指定 prompt_id**：只读确认线上 ComfyUI 版本的 `/prompt` 是否接受请求体中的 `prompt_id`（查看服务端版本说明或源码，不提交新生成）。只回答"支持/不支持"，不研究 client_id 扫描等替代方案（O3）。

产出：把结论逐项写入第 9 节（通过 / 不通过 / 限制）。

### 阶段 C：Harness 能力替换（依赖 B 的结论）

**C1 studio-crew provider 替代 child-policy**（依赖 B2 通过）
- 改动：把 `agents/roles.js` 的六类角色名称与指令文本原样写成包根 `agents/<role>.md`（S6，格式见 6A.1 示例），`package.json` 的 `files` 加入 `agents`；新建 `lib/agents/agent-definitions.js` 加载这些文件并校验 pipeline 每个节点的 `role` 都有定义；`agents/roles.js` 的 id 与 task kind 映射移到 `domain/task-roles.js`，文件删除。新建 `lib/agents/crew-provider.js`（6A 目标路径），从 agent 定义取 persona 与 tools（只允许 `structured_output`）注入 toolFilter；`PRODUCTION_WORKFLOW` 脚本中 `agent()` 指定 `provider: 'studio-crew'`，不再把角色指令拼进 prompt；删除 `child-policy.js`、`restrictedNovelParents`、`agent/created` 监听、`guidance.js` 第 2 行的子代理豁免前言。
- 版本：pipeline JSON 不变，无需 +1；角色指令进入 persona 而非 prompt，属于提示词组装变化，记入第 9 节。
- 验收：静态检查；`npm pack --dry-run` 清单含 `agents/*.md`；【需人工验收】真实流程中子代理只调用 `structured_output`，Workflow UI 照常可见。

**C2 后台 job 承载**（依赖 B1 通过）
- 改动：`studio_novel_create` 创建根任务（A5 后由 Worker 执行）后，用 `ctx.jobs.start` 挂一个观察该根任务的 job 并立即返回；Worker 推进阶段时通过 `handle.updateProgress` 上报；`job_kill` 映射为取消根 Run；删除 `waitForProductionRun` 与前台等待；宿主启动时 Worker 发现未完成根 Run 则重新挂 job。`syncNovelTodoTerminal` 改为阶段推进时增量更新。job 挂接代码新建在 `lib/harness/production-job.js`（6A 目标路径），`production/observability.js` 并入该文件。
- 保持：Project、ProductionRun、任务 DAG 与修改前一致；幂等键不变。
- 验收：【需人工验收】页面单次发起后立即返回；job 面板有进度；中途重启宿主后 Run 续跑至成片；完成时主 Agent 被唤醒并汇报。

**C3 交付收口（D8、D10）**
- 改动：`deliver-drama` handler 改为调用 `DeliveryService`（`planDeliverable → startDeliverableExport → completeDeliverableExport`），删除 handler 内的独立 ffmpeg 与 `recordDeliverable` 路径；成片就绪后 `present` 成片并 `send_file`（按 B3 结论选择调用时机）；`pre-ask-delivery.js` 只推送用户显式标记的中间稿，默认关闭全量推送。
- 保持：Deliverable 记录的 hash、路径语义；`studio_deliverable_export` 工具不变。
- 验收：【需人工验收】成片完成后对话里出现交付卡片并收到文件，不再推送参考图和分镜。

**C4 文本返工复用编译器（D9）**
- 改动：`lib/script/rework.js` 与 `creative-rework.js` 的提示词、Schema、批处理改为通过 `pipeline-compiler` 生成请求，复用 JSON 约束与重试策略；两文件只保留"选择要返工的节点"的逻辑。
- 验收：静态检查；【需人工验收】画布对剧本、资产、镜头各做一次重新生成。

**C5 审核档位（5.1）**
- 改动：配置项 `reviewMode`，只有 `auto`（默认）与 `key-stages` 两档（O8）；`autoApprove` 与 `approveGeneratedAsset` 读取档位；`key-stages` 时在故事圣经、资产卡、分镜三处经 `ctx.approval.request` 交互。
- 验收：`auto` 下行为不变；【需人工验收】`key-stages` 下在三个节点出现审批交互。

**C6 Skill 注册**
- 改动：用 `ctx.skills.register` 从包内注册 `skills/*`；`lib/skills/sync.js` 删除拷贝与版本戳逻辑。若 B 阶段发现 `skills` 服务在 web profile 未挂载，则保留 sync.js 并在本文件记录原因。
- 验收：【需人工验收】新会话能加载 `elysium-generate-drama`。

**C7 提交对账（R2，依赖 B5，O3）**
- B5 = 支持：`comfySubmit` 请求体传 `prompt_id = attemptId`（ComfyUI 要求的格式不符时，用 attemptId 确定性派生 UUID），提交前即知道 promptId；恢复 `submission_unknown` 或缺 promptId 的 Attempt 时先查 `/history/<promptId>` 与 `/queue`，查到就沿用远程任务，查不到才允许重新提交。
- B5 = 不支持：本任务取消，保留现有 `submission_unknown` 语义，在第 9 节记录"崩溃窗口内无法保证不重复提交"。不做 client_id 扫描等替代方案。
- 验收：静态检查；【需人工验收】结合第 8 节故障场景 F3。

### 阶段 D：清理与收敛（纯删除与搬迁，零行为变化）

**D1 删除死代码**
- 无引用模块（2026-10-07 依赖图扫描结果，执行前重新扫描确认）：`capabilities/registry.js`、`capabilities/validation.js`、`comfy/client.js`、`diagnostics/audit.js`、`diagnostics/events.js`、`domain/lease.js`、`gateway.js`、`media/batch.js`、`media/generation.js`、`media/lineage.js`、`production/dag-executor.js`、`review/service.js`、`rights/service.js`、`storage/gc.js`、`storage/locator.js`、`storage/migrations.js`、`timeline/model.js`。`domain/outbox.js` 仅被 `service.js` 再导出，一并删除再导出。
- `lib/index.js` 死函数：`runImageGeneration`、`runVideoGeneration`（只定义无调用），以及仅被它们使用的 `buildFluxImageWorkflow`、`buildH3VideoWorkflow`、`buildH3ImageToVideoWorkflow`；删除后再扫一遍新变成无引用的辅助函数和常量。
- 同步更新 `docs/架构-单机AI成人短剧创作工具.md` 中列出这些文件的表格。
- 验收：引用扫描 0 残留；静态检查。

**D2 消除模块级单例**
- 改动：`apply()` 构造 `runtime = { ctx, projectService, adapter, registry }` 并显式传入；删除 `index.js` 中模块级 `let ctx / legacyCanvasAdapter / activeProjectService`。
- 验收：静态检查；【需人工验收】跑一次单集 Pilot。

**D3a 整文件迁移与改名**（纯 `git mv` + 改 import）
- 按 6A.2 "整文件迁移或改名"表执行，一个提交完成；迁空的目录删除（见 6A.2 删除清单）。
- 验收：静态检查；引用扫描旧路径 0 残留；`npm pack --dry-run` 清单正确。

**D3b 从 index.js 拆出**（函数体逐字搬，只改 import/export 与参数注入）
- 按 6A.2 "从 lib/index.js 拆出"表执行，建议按"工具函数 → generation → capabilities → canvas → pipeline → tools → routes → runtime"顺序，每组一个提交。
- 同步完成 S7：`tools/index.js` 汇总全部工具并标注 visibility；`novel-entry-gate.js` 改为从清单推导拦截集合，推导结果必须与原 `INTERNAL_NOVEL_TOOLS` 逐项相等。
- 拆分后 `index.js` 只保留：`name`、`inject`、`apply()` 中的 runtime 创建调用与 tools / hooks / systemPrompt / routes / Worker 注册和 effect 清理。
- 验收：静态检查；`index.js` < 300 行；6A.3 依赖方向扫描无违规（例外项除外）；6A.4 指标达标；【需人工验收】跑一次单集 Pilot。

**D4 内部提案工具改为函数（S3）**
- 改动：`studio_content_analysis_submit`、`studio_asset_design_submit`、`studio_asset_extraction_submit`、`studio_shot_prompts_submit`、`studio_episode_plan_submit`、`studio_episode_draft_submit`、`studio_episode_script_submit` 的执行体移到 `pipeline/proposal-submit.js` 作为普通函数；编排处由 `tool.execute(...)` 改为直接调用函数；从工具注册中移除这些工具；`novel-entry-gate.js` 拦截名单删去它们。
- 先确认：`skills/`、`harness/system-prompt.js` 没有引用这些工具名（2026-10-08 扫描为 0）；执行时重新扫描。
- 保持：提案提交的领域命令序列、commandId、autoApprove 行为与修改前一致。
- 验收：静态检查；引用扫描；【需人工验收】跑一次单集 Pilot。

**D5 阶段目录与阶段切片（S1 + S4）**
- 改动：按 6A.2 "按阶段拆分的文件"表执行，建立 `stages/catalog.js` 与 6 个阶段目录；`pipeline/text-runner.js`、`pipeline/media-planner.js`、`pipeline/novel-orchestrator.js` 改为按 catalog 顺序调用各阶段的 `runText` / `planMedia`；Worker handler 改由 `catalog.allHandlers()` 提供；`productionProgress` 改为汇总各阶段 `progress`；`/canvas` 返回阶段清单，`studio/stages.js` 使用接口返回值（手动支路无阶段节点保留正则兜底）；读模型移到 `projections/`，4 处反向依赖按 6A.3 消除。
- 子步骤（每步一个提交）：① 纯函数下沉 domain（proposal-contracts / output-schemas / task-roles / rework-tasks / content-editor）；② 读模型上移 projections；③ 建 catalog 与阶段目录，函数体逐字搬入；④ 编排与 Worker 改为经 catalog 取阶段；⑤ progress 汇总与 studio 阶段清单。
- 禁止：改变任务 kind、任务 id、run id 规则、提案 kind、pipeline JSON 节点 id；阶段之间互相 import；为阶段引入基类、注册表或插件机制。
- 行为一致性检查（一次性脚本，放仓库外，不提交）：对 `~/.dsh/storages/short_video_studio` 中现有 Project 快照只读执行，改动前后 `productionProgress`、`canvasReadModel`、`dramaProductionTasks`（新为 `media-planner`）输出深度相等；不等则修正到相等为止，不允许以"新逻辑更合理"为由接受差异。
- 验收：静态检查；行为一致性检查通过；6A.3 依赖扫描无违规；【需人工验收】跑一次单集 Pilot，画布各阶段显示与改动前一致。

> 路径说明：A、C 阶段在现有路径上修改，**新建的文件直接放到 6A 目标路径**；D3–D5 统一搬到 6A 结构。最终结构以 6A 为唯一标准，执行中发现 6A 与代码事实冲突时，先在本文件 9 节记录再调整，不得自行另起结构。

---

## 8. 最终验收（全部任务完成后）

在 `http://127.0.0.1:3080/` 由用户执行，Codex 不得在运行期间调用内部工具、补数据或重试：

1. 全新会话，单次发起《都市生日夜》单集 Pilot，自动到成片交付；
2. 对话中可见：Workflow 阶段与子智能体、job 进度、成片交付卡片；
3. 中途重启宿主一次，Run 续跑完成，已完成任务不重跑；
4. 单镜返工后，总览仍正确显示根流程；
5. `lib/` 总行数与文件数相比 2026-10-08 基线（74 文件、约 14,253 行）净减少。

### 8.1 故障场景（人工制造，逐项给结论）

| # | 故障注入 | 必须得到的结果 |
|---|---|---|
| F1 | 一个文本节点输出无效，其余成功 | 保留成功成果，只重做失败节点 |
| F2 | 模型或 Workflow 调用网络失败 | 失败可归因到具体任务，同批其他结果不丢 |
| F3 | 远程已受理、本地 promptId 保存前退出 | 能找回任务或明确标为待确认，不盲目重复提交 |
| F4 | 远程已完成，下载或本地 CAS 提交失败 | 复用同一远程结果补齐本地产物 |
| F5 | 媒体生成期间重启宿主 | 任务恢复，根流程继续推进到交付 |
| F6 | 单镜返工完成 | 有效产物与全局进度更新，不隐藏根流程故障 |
| F7 | 租约过期但旧执行未退出 | 旧执行提交被拒，新执行有唯一代次 |
| F8 | 显示完成但交付文件缺失 | 显示不一致或失败，不能判定交付成功 |

执行顺序：1 集少量镜头真实流程 → 同一项目中断恢复 → 多集流程 → 创作质量验收。不要把模型耗时、成功率和恢复正确性混成一个"跑通"指标。

### 8.2 每轮记录的指标

每阶段成功率、自动恢复成功率、重复远程提交数、已完成任务被重跑数、状态与产物不一致数、失败到恢复耗时、人工介入次数、降级成果比例。

只通过一次只能表述为"链路打通"，不能表述为"稳定"（见 `tasks/lessons.md`）；只有连续多轮、无人工干预、无残留任务且 8.1 恢复场景通过，才能称为稳定。

---

## 9. 探针结论

（B 阶段执行后由 Codex 填写。）

---

## 10. 阶段二：对话式创作（本轮不执行，第 8 节验收通过后另行启动）

> 本节会**新增功能**，超出第 0 节"功能不变"约束，因此不在本轮第 7 节清单内。Codex 执行本轮时**不得**实现本节任何内容；本节只为保证本轮的结构（6A）给它留好位置。

### 10.1 目标：接近 Claude Code 的设计哲学，不照搬

目标是"用户在对话里就能把一部短剧从原文做到成片，并能随时说'第 3 集女主换个发型'这样的局部修改"，稳定性与 Claude Code 同级。不追求复刻 Claude Code 的全部功能。

| Claude Code 的稳定来源 | 本项目对应 | 状态 |
|---|---|---|
| 状态在外部（文件），不靠模型记长流程 | Project（Domain Storage）+ 持久 Run/Task | 本轮 A 组加固 |
| 工具薄、报错可读、模型据报错自修 | 命令层 + 失败分类 + `nextStep`（A3） | 本轮 A3 |
| 长任务后台化、可见进度、可中止 | 后台 job + `job_kill`（C2） | 本轮 C2 |
| 子智能体权限收窄 | studio-crew provider（C1） | 本轮 C1 |
| 能力在 skills 与数据里，不写死在代码 | `skills.register`（C6）、角色进 `agents/*.md`（S6） | 本轮 C1、C6 |
| 按扩展点组织代码（tools / hooks / agents / skills） | 6A 的 S5–S7 | 本轮 D3–D5 |
| **对话里能局部修改** | 读：已有 `studio_project_get` 等只读工具；改：返工只有界面 HTTP 路由（`/projects/:id/edit|regenerate|replace-image`），主 Agent 无对应工具 | **E1（核对）、E2** |
| **做完自检、发现问题自修**（相当于"跑测试"） | 无，`visualReview` 恒为 `not_performed` | **E3** |

### 10.2 分工原则：模型管内容，代码管流程

- 对话层像 Claude Code：主 Agent 理解意图、调用工具、解释结果。
- 生产层像构建系统：pipeline JSON + Worker 稳定执行，流程顺序、重试、恢复由代码决定。
- 自建 LLM 的长链路规划与结构化输出稳定性低于 Claude，**不得**把整条生产流程交给 Agent 自主编排；Agent 只决定"改什么"，由工具把修改落到同一条持久流程里执行。

### 10.3 任务

**E1 对话读项目（只读）**
- 更正（2026-10-08）：主 Agent 已有只读工具 `studio_project_get`、`studio_production_status`、`studio_shot_list`、`studio_review_queue`、`studio_attempt_list`（`lib/domain/tools.js`），并非读不到。E1 先用它们回答 10.4 ① 的问题，只有答不出时才补字段或新增 `studio_project_inspect`，不重复造只读工具。
- 目标：让主 Agent 读到结构化项目信息：集数、每集镜头、角色与资产、各节点状态与产物、降级标记（A4）、审核队列、最近失败（含 A3 的 `failureClass` / `nextStep`）。
- 实现：只调用 `projections/` 已有读模型（`canvasReadModel`、`productionProgress`）与 `domain/content-editor.js` 的 `productionEditor`，不新增查询逻辑；参数 `{ projectId?, scope?: 'overview'|'episode'|'node', episode?, nodeId? }`，按 scope 裁剪输出，控制结果长度。
- 放置：若新增，放 `lib/tools/project-tools.js`，visibility = `root`。

**E2 `studio_rework`（对话发起局部返工）**
- 参数：`{ projectId, kind, id, operation: 'edit'|'regenerate', values?, instruction? }`。`instruction` 是用户的自然语言修改要求，写入返工任务输入，交给对应阶段 role 生成。
- 实现：复用现有 `runtime.rework` 的命令路径（`editProductionContent` / `requestProductionRework`），修订号与 commandId 由工具内部读取和生成；失效传播、Worker 调度、C4 统一后的编译器路径全部复用，**不新增第二条返工路径**。
- 返回：受影响的下游节点列表（来自失效传播）和后台 job id，Agent 据此告诉用户"将重做哪些镜头"。
- 放置：`lib/tools/rework-tools.js`，visibility = `root`。
- 门禁：大范围返工（如影响超过 N 个镜头，N 写进配置）走 `ctx.approval` 确认；`replace-image` 需要用户上传图片，保持只在界面提供。

**E3 视觉自检闭环（前提：B4 证实 `elysium-chat` 接受图像输入）**
- 分镜图与成片抽帧经 `attachments.saveImage` 交给多模态子智能体（studio-crew 的 `reviewer` role），按 structured_output 打分：角色一致性、与分镜描述相符、明显瑕疵。评分 schema 遵守 structured_output 子集限制（第 0 节第 7 条）。
- 不合格 → 自动发起一次 E2 的 `regenerate`，同一节点最多 1 次；仍不合格 → 标"需复核"进入审核队列，不无限重试。
- 结果写入 `visualReview`，替换 `not_performed`。
- B4 证伪时：E3 取消，由 C5 的 `key-stages` 审核档位人工兜底。

### 10.4 启动条件与验收

- 启动条件：第 8 节最终验收通过，8.1 F1–F8 全部给出结论。
- 验收（3080 人工）：在一次已完成的项目对话中，① 询问"第 2 集有几个镜头、哪些需复核"得到正确回答；② 说"把第 1 集第 3 镜改成夜景"后，只有该镜及其下游被重做，其他镜头不重跑，成片重新交付；③（E3 可用时）人为放入一张不一致的分镜图，系统自动发现并重做或标记复核。
