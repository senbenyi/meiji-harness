# Harness、网关与短剧数据底座调研

> 状态：已完成（静态源码审计）；真实长任务与故障注入尚未验收
> 基线：2026-10-01；DeepSeek Harness `0.1.0-rc.7`；当前 `llm-dsh-plugins` 与 `llm-modes-gateway` 工作区
> 范围：Harness 核心能力、网关核心能力、当前插件的完整生产协议与数据状态、17 个开源项目的能力蒸馏顺序；不包含界面定稿和业务代码实施

## 0. 结论

- Harness 已经具备 Agent 循环、Skill、Goal、Workflow、后台 Job、Schedule、Subagent、会话事件日志、投影缓存和持久化 Domain Storage。新插件不应另造 Agent Runtime 或通用任务编排器。
- 网关已经具备模型/渠道路由、异步任务先落库、未知提交恢复、轮询、取消、媒体资源定位和 ComfyUI workflow 编译。网关应继续只拥有推理执行，不拥有短剧项目、剧集、角色或镜头业务状态。
- 当前插件不是空壳。它已经形成从简报、资产卡、镜头表、自检、逐镜生成、连续性控制、人工确认、返工、拼接、终检到多渠道交付的一套可运行生产协议；画布还实现了主线/检查帧/废弃三条泳道、重做、替换、恢复、入库和跨会话素材复用。这些都是迁移基线，不能因重做数据层而丢失。
- 当前最大断点是这套生产协议没有可靠数据底座：插件把 `sessionId` 当项目 id，把全部状态压在 `<workspace>/canvas/<sessionId>/project.json` 的 `settings + nodes` 中，并直接操作 `node:fs`。它没有独立项目身份、领域对象、修订号、迁移、生成尝试记录、审核决策、成片版本和可靠恢复。
- 仓库规范要求的 `dsh-elysium/src/database/files.js` 与 `~/.dsh/storages/elysium` 当前均不存在。必须先建立 Elysium 项目域，再集成开源项目能力；否则只会把更多流程继续堆进画布 JSON。
- 多 Agent 不是第一阶段目标。Agent 只能通过经过校验的领域命令读写项目；共享状态来自 Elysium，不来自 Agent 之间的隐式对话或超长 prompt。
- 界面必须最后实施。先完成数据所有权、状态机、命令、恢复、网关任务关联和开源能力验收，再根据稳定读模型设计 UI。

## 1. 规格

### 目标

探明 Harness 与网关已经提供的可靠能力，设计唯一的短剧项目数据域和数据流，并建立逐个蒸馏开源项目优势的实施顺序。

### 非目标

1. 本阶段不修改业务代码。
2. 不复制开源项目源码、资产、专有 prompt 或受限许可实现。
3. 不先做新 UI，也不以 UI 页面反推数据结构。
4. 不把短剧业务对象塞入通用 Harness 核心或推理网关。
5. 不以“存在多 Agent”作为能力完成标准。

### 验收标准

- AC-1：Harness 能力矩阵可定位到当前安装包的源码或公开类型契约。
- AC-2：网关职责、任务生命周期与数据边界可定位到实际执行路径。
- AC-3：短剧项目的唯一数据所有者、写入口、实体、不变量和状态转换明确。
- AC-4：从创作命令到网关任务、素材审核、时间线和成片交付的数据流完整且可恢复。
- AC-5：17 个开源项目逐个有“蒸馏项、禁止照搬项、许可证门、验收样例”。
- AC-6：计划明确先数据与流程、后能力、最后 UI。
- AC-7：当前插件已经可用的生产协议、人工操作和渠道交付均有迁移映射与特征测试，重构前后行为不倒退。

## 2. Harness 核心能力

审计基线均为 `@deepseek-ai/* 0.1.0-rc.7`。

| 能力 | 已确认实现 | 可直接复用 | 不能误用为 |
| --- | --- | --- | --- |
| Agent 生命周期 | `dsh-agent-loop.AgentLoop.createAgent/resume` | 创建、恢复、取消 Agent | 短剧项目数据库 |
| Skill | `dsh-tool-skill` | 按需加载创作规范 | 持久业务状态 |
| Goal | `dsh-tool-goal` | 同一会话目标与收尾 | 项目/剧集状态机 |
| Workflow | `dsh-tool-workflow` + `ctx.workflowEngine` | 有界 JavaScript 编排、并行子任务、取消 | 无边界自动化主循环 |
| Background Job | `dsh-tool-jobs` | 查询输出、列出、终止后台工作 | 网关媒体任务真值源 |
| Schedule | `dsh-schedule` | 基于会话事件日志的持久提醒 | 精确媒体队列调度器 |
| Subagent | `dsh-subagent-spawn-in-process`、`dsh-tool-subagent-control` | 独立、可验证的分析/生成子任务 | 共享可变业务状态 |
| Domain Storage | `dsh-storage-domain` | schema 校验、单域写链、持久化后更新内存、`update` 原子读改写 | 跨多个表的数据库事务 |
| JSON Backend | `dsh-storage-json` | 指定根目录、原子整文件发布 | 大型二进制媒体仓库 |
| Session Projection | `dsh-session-projection` | 从已提交会话事件计算一致读模型 | 独立于会话的项目真值源 |
| Projection Cache | `dsh-session-projection-cache` | 版本化 checkpoint、尾日志重放、冷读恢复 | 权威数据；它只是可丢弃缓存 |
| UI 扩展 | conversation/workspace slots、API gateway | 会话视图、侧栏、工作区和远程服务 | 数据所有权 |
| LLM 可靠性 | `dsh-llm-retry`、output retention | 提供商重试、输出限长 | 业务命令幂等与镜头恢复 |

### 2.1 最重要的存储语义

`dsh-storage-domain` 已确认具备：

- 每个 domain 一条串行写链。
- 后端持久化成功后才修改内存并发出 `domain/changed`。
- `KvTable.update` 在写链上执行原子读改写，能避免同一记录的并发覆盖。
- `DomainSpec.version` 不匹配时拒绝打开，不会静默误读旧格式。
- 没有跨表事务。因此短剧项目需要以“一个项目聚合记录”为一致性边界，而不能一次命令分散写多个权威表。

### 2.2 Harness 中应沉淀什么

只沉淀通用机制：结构化工具、命令执行、会话投影、后台编排、恢复与 UI 插槽。短剧专用实体和状态机应实现为建立在 Harness 能力上的 Elysium 领域插件，而不是修改 Harness Agent Loop。

## 3. 网关核心能力

### 3.1 当前真实链路

```text
API 请求
  → core.Gateway.Route(public model, sync/async)
  → 按 priority 选择可用 channel
  → provider adaptor 校验语义请求并编译 workflow
  → 异步请求先 CreateTask(status=submitting)
  → 提交上游
     ├─ 成功：queued + remote_id
     ├─ 结果未知：保留 submitting，后续 Recover
     └─ 明确失败：failed
  → Poller 扫描 active tasks
  → queued / in_progress / completed / failed / cancelled
  → 媒体注册为 opaque resource id
```

### 3.2 已确认能力

- 公共模型到渠道的优先级路由与同优先级随机分配。
- 同步执行与异步执行分离。
- 异步任务提交前落 SQLite，避免丢失提交意图。
- 上游响应不确定时按任务 id 恢复，禁止盲目重复提交。
- 任务轮询、取消与“仅活动状态可更新”的并发保护。
- Token 所有权、使用日志、TID、任务和媒体资源定位。
- ComfyUI provider 拥有 capability/tier 到 workflow 的选择和编译。

### 3.3 缺口

- `MediaCapability` 只有 `name + tiers`，不足以表达输入形状、数量、时长、分辨率、连续性、输出类型和当前健康状态。
- 缺少调用方幂等键；插件崩溃后无法证明某次领域命令是否已经创建网关任务。
- 网关任务没有稳定的调用方关联字段；TID 用于观测，但不能代替 `generationAttemptId`。
- 媒体资源保存的是上游定位信息而非项目资产语义；它不应承担项目素材库。
- 当前路由主要按 public model/channel，能力选择与渠道健康、成本、延迟策略尚未形成统一决策对象。

### 3.4 网关中应沉淀什么

- 能力目录、输入输出约束、路由策略、幂等提交、任务恢复、取消、媒体访问、用量和诊断。
- 不沉淀 Project、Episode、Character、Shot、Review、Timeline 等业务对象。

## 4. 当前插件数据状态问题

当前权威状态是 `<workspace>/canvas/<sessionId>/project.json`：

```json
{
  "schemaVersion": 1,
  "sessionId": "...",
  "settings": {},
  "nodes": []
}
```

已确认的问题：

1. 项目与会话绑定，无法稳定表达一个项目跨多个会话、Agent 或设备继续制作。
2. 角色、场景、道具、服装、剧集、镜头、生成尝试、审核和成片只是自由节点或文本，没有领域约束。
3. 读取 JSON 失败直接返回空项目，损坏数据可能被伪装成“新项目”。
4. 只有进程内 per-session 写锁；没有持久 revision、乐观并发、跨进程写保护或冲突反馈。
5. 生成请求完成后才写 ready 节点；提交后插件崩溃时，项目中没有可恢复的 attempt/task 关联。
6. `schemaVersion` 存在但没有迁移器。
7. 源码直接导入 `node:fs`，与仓库要求的唯一文件入口冲突。
8. 画布节点同时承担领域对象、执行状态、素材索引和 UI 布局，任何一层演进都会牵动其它层。

### 4.1 当前插件真实产品能力

本节来自 `lib/index.js`、`lib/client.js`、`studio/app.js`、`lib/assets.js`、8 个 bundled Skills、现有架构文档及脚本，不再把插件视为待从零设计的壳。

| 层 | 已实现能力 | 迁移时的判定 |
| --- | --- | --- |
| 生产流程 | 故事短片：规格确认 → 简报 → 大纲 → 角色卡 → 场景卡 → 七列镜头表 → 强制自检 → 文本/铅笔分镜 → 逐镜生成 → 拼接 → 终检 → 交付 | 业务协议，必须保留 |
| 品牌流程 | 可核验来源 → 品牌事实表 → 来源清单 → 身份资产绑定 → 创意方向 → 六列镜头表 → 自检/审批 → 生成/拼接/交付 | 可复用的“来源与权利”协议；成人短剧的身份、成年与授权记录可沿用此思想 |
| Prompt | H3 Ref2VA 六段式、I2VA/FL2VA 三段式、字幕唯一真值、结构校验门和有界 fallback | 质量策略；结构门保留在插件/Elysium，模型工作流选择留给网关 |
| 生成语义 | 图片 t2i/i2i、视频 r2v/i2v、capability + tier、参考卡、首末帧、`continuity_from`、抽帧、超分、拼接 | 语义命令保留；实现/workflow id 归网关 |
| 连续性 | 单视图零文字参考、角色/场景锚点、同场景链式续接、跨场景转场、链尺寸约束、重渲后的下游链连锁失效 | 核心领域不变量，必须进入 Shot/Attempt/Asset 血缘 |
| 人工门 | 简报、大纲、角色卡、场景卡、镜头表、自检、分镜、逐镜、交付均有人工确认；同镜连续失败升级求助 | 状态机门，不得只留在 Skill 散文里 |
| 画布 | image/video/text/table 卡片；编辑、上传替换、AI 重做、分组、排序、删除；main/frames/discard 泳道；废弃与恢复 | 已有操作语义必须映射为领域命令；界面可晚改 |
| 资产库 | character/scene/style/clip/text 类型，稳定 asset id、角色 state、跨会话物化、共享文件引用保护 | 合并进 Elysium Asset/CharacterState，不应删除后重造 |
| 交付 | 逐镜/成片、PDF/HTML 文本导出、飞书 `send_file` 的 ask 前自动送达、20 MiB 失败记录、Web/TUI fallback | DeliveryAttempt/Outbox + 渠道适配器；保留现有最后一公里 |
| 包装 | bundled Skill 同步、版本/hash、宿主 system prompt、settings/toolbar/sidebar/view slots | 插件壳继续承担，不下沉网关 |

### 4.2 当前画布不是“无结构节点”

`project.json` 的 `nodes[].params` 已经承载 capability、tier、seed、尺寸、帧数、fps、prompt、参考节点、首末帧、来源节点、asset id、废弃标记、送达状态与错误。`studio/app.js` 还把节点解释为：

- `main`：当前有效的制片产物；
- `frames`：抽帧、检查帧和中间验证产物；
- `discard`：被替代、审核拒绝或用户废弃的产物，可恢复；
- group/order：生产阶段和人工编排顺序；
- replace/redo/deprecate/restore：人工纠错与版本选择。

因此迁移不能只对比“节点数和媒体 hash”。还必须保留每个节点的参数快照、血缘、泳道、当前批准版本、分组顺序、废弃/恢复状态和渠道送达记录。

### 4.3 Skill 中已有但尚未结构化的领域规则

当前 Skills 已经定义了大量成熟规则，但主要靠 Markdown 与 Agent 自律执行：

1. 角色卡或场景卡重做后，所有下游镜头表、分镜和片段必须切到新版本。
2. 任一链上镜头重渲会产生新 latent 槽位；从该镜开始的所有 `continuity_from` 下游必须顺序重渲，旧节点不得继续引用。
3. 镜头表修订后必须重跑自检，才能恢复分镜和生成资格。
4. 单镜生成成功只代表候选产物；逐镜 AI 自检与人工确认通过后才可推进。
5. 拼接必须使用当前批准且画质一致的镜头；单镜超分后必须重跑拼接。
6. 交付清单需记录镜头到节点/文件/时长映射，并核对角色、场景、口型、字幕、参考污染、尺寸和薄弱片段。

这些规则应被提升为 Elysium 的命令前置条件、依赖失效规则、ReviewDecision 和 Timeline 校验，而不是在重构时改写成另一套流程。

### 4.4 当前插件需要修复而不是丢弃的点

- `lib/assets.js` 的中文名称 slug 可能为空；损坏 JSON 会退化为空库；资产库仍是 workspace 级并直接读写文件。
- 画布加载损坏会返回空项目，生成任务只在成功后落 ready 节点，崩溃恢复信息不足。
- H3 门、交付钩子、Skill 和画布状态之间仍有散文式双份真相。
- `lib/index.js` 仍保留旧 ComfyUI/manifest 路径、已迁移到网关后的兼容代码和过期提示，职责边界不够干净。
- 插件根目录的 `workflows/` 已不在当前文件树中，但 `lib/manifest.js` 与 `schemas/workflow-manifest.schema.json` 仍存在；`lib/index.js` 也仍有 legacy workflow registry/HTTP 兼容路径。它们属于待完成的文件级迁移尾项，不能因为主调用已经走网关就视为迁移完成。
- 生产文档中的部分历史契约与当前实现可能不一致；迁移前要用特征测试以运行结果为准。

### 4.5 现有测试和实验资产

仓库已有 19 个 smoke、9 个 e2e、6 个 probe、3 个 benchmark、8 个模板生成脚本、6 个分析脚本和 3 个 UI preview。它们是可执行知识库，不应随旧 workflow 文件一起删除：

- provider/workflow 编译、tier、分辨率、链式续接和 GPU probe：迁到网关资格测试；
- 画布、资产、上传、Skill 安装、H3 门、PDF、交付、拼接：迁到 Elysium/插件特征测试；
- 真机 benchmark：变为网关候选实现晋级/降级的离线评测；
- UI preview：保留为最后阶段的交互与视觉回归。

旧脚本只有在对应新测试通过并建立一一映射后才能删除。

## 5. 目标数据所有权

```text
Harness 会话日志                   网关任务库
  对话、工具调用、Agent 生命周期      路由、提交、远端状态、用量、媒体定位
          │                                │
          └────── 领域命令 / task id ──────┘
                         │
                 Elysium Project Domain
        项目、内容、状态机、修订、尝试、审核、时间线、交付
                         │
                 Elysium File Service
             项目媒体、代理文件、导出物、校验和
                         │
                    UI Read Models
```

### 5.1 唯一权威实体

| 聚合/实体 | 核心内容 |
| --- | --- |
| Project | 身份、标题、类型、分级、创建者、当前版本、生命周期 |
| StoryBible | 世界观、叙事规则、风格、禁用项、连续性规则 |
| Character | 稳定身份、视觉锚点、声线、权利/同意记录 |
| CharacterState | 服装、伤势、年龄阶段、携带物、情绪、适用场景范围 |
| Location/Scene | 空间、光照、时间、道具和连续性状态 |
| Episode | 大纲、剧本、节奏、场景序列和制作状态 |
| Shot | 时间、镜头语言、角色/场景绑定、输入、期望输出和审核状态 |
| GenerationAttempt | 幂等键、能力、参数快照、gateway task id、状态和失败原因 |
| Asset | 来源、类型、校验和、派生关系、审核状态和文件引用 |
| ReviewDecision | 通过/驳回、理由、标注、操作者和时间 |
| Timeline | 片段、音轨、字幕、转场、版本 |
| Deliverable | 时间线版本、编码参数、成片文件、质量报告 |

成人内容项目还必须把参与者成年确认、同意范围、真人肖像授权、来源追踪和内容分级作为结构化数据，而不是 prompt 备注。

### 5.2 一致性边界

- 每个 Project 是一个可原子更新的聚合记录，带 `revision`。
- 所有写入只能经过 Elysium command service；Agent、HTTP、UI 都不能直接改记录或文件。
- 媒体字节只能经过 `dsh-elysium/src/database/files.js`；业务记录只保存 file id、hash、mime、size 和派生关系。
- Harness session id 只能作为 `activity/sourceSessionId`，不能作为 project id。
- 网关 task id 只能属于一个 GenerationAttempt；相同 attempt 的重复提交必须返回同一个结果。

## 6. 核心状态机

### 6.1 Episode

```text
draft → outlined → scripted → planned → producing → postproduction
      → review → approved → delivered
任一制作态 → blocked
review → producing/postproduction（返工）
```

### 6.2 Shot

```text
planned → ready → generating → review → approved → assembled
              └→ failed → ready
review → rejected → ready
任一非终态 → blocked / cancelled
```

### 6.3 GenerationAttempt

```text
created → submitting → queued → running → succeeded
                   ├→ submission_unknown → recovering
                   ├→ failed
                   └→ cancelled
```

Shot 状态不能直接从“模型返回成功”跳到 approved；模型成功只产生候选 Asset，必须经过 ReviewDecision。

## 7. 稳定数据流

```text
用户/Agent 提交领域命令
  → Elysium 校验 project revision、前置状态和引用
  → 原子创建 GenerationAttempt(created) + 幂等键
  → 调用网关 semantic API
  → 写入 gateway task id / submitting 或 submission_unknown
  → 后台 Job 轮询或恢复
  → 下载并校验媒体，经 File Service 落盘
  → 登记 Asset + Attempt(succeeded)
  → Shot(review)
  → 人工/规则/VLM 审核形成 ReviewDecision
  → approved Asset 进入 Timeline
  → Timeline 固化版本并导出 Deliverable
```

任何中断后都从 Elysium 中非终态 Attempt 恢复，不能从画布节点、聊天文本或文件名猜测。

## 8. 开源项目逐项蒸馏清单

以下是现有调研形成的候选，不代表已经允许复制实现。每项实施前必须重新读取当前默认分支源码、测试和许可证，并制作独立验收卡。

| 项目 | 首要蒸馏项 | 放入本系统的位置 | 禁止直接照搬/门槛 |
| --- | --- | --- | --- |
| ArcReel | 分阶段人工审核、任务队列、供应商抽象、迁移/备份、剪映导出 | Elysium 流程、网关、交付 | AGPL 边界需先确认 |
| LumenX | Studio/Playground 分离、统一模型目录、声音与终剪 | 产品模式、网关目录、后期 | 先验证真实成片链路 |
| ViMax | 小说压缩、单职责 Agent、上下文索引、并行生成与续跑 | Harness workflow + Elysium 黑板 | Agent 不得直接共享可变状态 |
| Jellyfish | 角色/场景/道具/服装/镜头一级对象、统一异步任务中心 | Elysium 领域模型 | 先核对最新发布分支 |
| Toonflow | 无限画布、节点能力包、provider/tool/team/skill 扩展边界 | 最后阶段 UI 与扩展 SDK | 测试薄弱，不作为状态底座 |
| AID Studio | 模型健康、僵尸任务回收、媒体清理、运营作业 | 网关运维 | 不引入其重型平台栈 |
| waoowaoo | 持久执行、失败治理、计费审批、资源归属 | 网关治理/Elysium 权限 | Elastic License，禁止直接服务化复刻 |
| LocalMiniDrama | 本地隐私、镜头行、工作流组重跑 | Elysium selection/rerun + UI | 不复制其本地状态缺陷 |
| moyin-creator | 角色圣经、批量队列、导演台、自动重试 | Elysium + Harness jobs | AGPL/商业许可门 |
| Huobao Drama | prompts/skills 与工具分离、供应商 adapter | Harness Skill + 网关 adapter | CC BY-NC-SA，商业产品不可复制代码 |
| Pixelle-Video | pipeline/processor/provider/model 分层、解说视频链路 | 可选内容模板 | 不当作连续短剧领域模型 |
| FastMovieAI | 用户、积分、支付和运营后台 | 未来商业层 | 活跃度与供应链风险；非核心制作能力 |
| MoneyPrinterTurbo | TTS、字幕、BGM、素材与合成 | 后期媒体服务 | 不具备角色/镜头状态，不当底座 |
| BigBanana | 产品流程声明 | 仅作产品研究 | 源码不足且非商业许可 |
| Novella | ProjectBlackboard、Hub-and-Spoke、音频工作室、插件 SDK | Elysium read model + Harness Agents | v0.0.1，宣传性能需实测 |
| AI Video Production Editor | 3D 预演、连续性复审、返拍队列、调色与交付 | 后期高级能力 | GPL 分发义务；能力逐项实测 |
| Story Claw | 角色阶段、跨章声线、VLM 首尾帧质检、断点续跑 | Elysium 状态与质量门 | 当前偏批处理，交互精修需重做 |

### 8.1 相对当前插件的逐项判断

| 项目 | 当前插件已经有 | 真正需要蒸馏的增量 | 不引入 |
| --- | --- | --- | --- |
| ArcReel | 人工门、生成/拼接/交付 | 持久任务队列、迁移备份、工程导出 | 整套运行时 |
| LumenX | 生成工具栏、画布生产 | Studio/Playground 模式、完整音频与终剪 | 另一套模型路由 |
| ViMax | Skill 编排、参考绑定 | 长篇压缩、上下文索引、可恢复并行任务 | Agent 共享可变状态 |
| Jellyfish | 角色/场景卡、镜头表 | 正式一级实体与统一任务中心 | UI 驱动的数据结构 |
| Toonflow | 节点画布、分组排序 | 稳定 read model 之后的扩展 SDK | 用无限画布充当数据库 |
| AID Studio | 基础错误记录 | 健康评分、僵尸任务、媒体 GC | 重型平台栈 |
| waoowaoo | 审批和送达错误 | 资源归属、失败治理、商业审批 | 受限许可实现 |
| LocalMiniDrama | 单镜重做、废弃恢复 | 镜头组选择与批量重跑 | 本地临时状态模式 |
| moyin-creator | 角色卡和逐镜流程 | 角色圣经结构、批量一致性队列 | 直接复制 AGPL 实现 |
| Huobao Drama | Skill/工具已经分层 | adapter 契约细化 | 非商业代码/prompt |
| Pixelle-Video | 视频生成、拼接 | 解说/口播模板 | 当作连续剧情底座 |
| FastMovieAI | 无商业后台 | 用户/积分/支付（后置） | 在制片底座前启动 |
| MoneyPrinterTurbo | 原生音频、字幕要求、拼接 | 独立 TTS/字幕/BGM 轨道和降级合成 | 其弱项目模型 |
| BigBanana | 已覆盖多数流程声明 | 仅产品对照 | 源码/能力集成 |
| Novella | Skill、画布、Harness Subagent | ProjectBlackboard 读模型、音频工作室边界 | 未实测性能声明 |
| AI Video Production Editor | 逐镜审核和返工 | 3D 预演、调色、专业工程交付 | 一次性大而全移植 |
| Story Claw | 链式连续性、逐镜自检 | 角色阶段、声线映射、VLM 首尾帧质量门、断点续跑 | 批处理 UI |

## 9. 逐项目确认卡的统一标准

每个项目必须用同一张卡，避免“看 README 就集成”：

1. 当前 commit、许可证、活跃分支与可构建性。
2. 实际领域实体和数据库 schema。
3. 从入口到成片的真实调用链。
4. 中断、重试、取消、重复提交和恢复行为。
5. 一条最小样片实测与产物检查。
6. 能蒸馏的设计原则；禁止复制的代码/资产/prompt。
7. 映射到 Elysium、Harness、网关或后期服务的唯一位置。
8. 一个可自动验证的验收用例和一个失败用例。

## 10. 诚实边界

- 已确认：Harness 与网关静态源码能力；当前插件宿主、客户端、画布、资产库、8 个 Skills、生产文档与脚本清单的静态执行契约。
- 未验收：Harness Domain Storage 在数百镜头项目上的体积与延迟；网关进程重启和远端不确定提交的完整故障注入。
- 未确认：规范中提到的独立 `dsh-elysium` 历史实现；当前磁盘没有找到该源码或 `~/.dsh/storages/elysium`。
- 开源项目表来自现有调研库存；正式集成前仍必须按第 9 节逐仓重新取证。

## 11. 证据

- 当前插件宿主：`lib/index.js` 的项目存储、Gateway render、16 个工具、HTTP 路由、H3 pre-execute 门、自动送达钩子和 system prompt。
- 当前插件客户端与画布：`lib/client.js`、`studio/app.js`、`lib/assets.js`。
- 当前插件流程：`skills/*/SKILL.md`、`docs/ARCHITECTURE.md`、`docs/consistency-plan.md`、`docs/video-shape-contract.md`、`docs/shot-chain-continuity.md`、`docs/channel-delivery.md`。
- 当前插件验证资产：`scripts/smoke-*`、`scripts/e2e-*`、`scripts/probe-*`、`scripts/bench-*`、`scripts/preview-*`。
- Harness：本机 npm npx 缓存中的 `@deepseek-ai/* 0.1.0-rc.7` 类型契约和实现。
- 网关：`internal/core/gateway.go`、`internal/store/store.go`、`internal/task/poller.go`、`internal/provider/comfyui/executor.go`。
- 开源项目库存：`docs/research/ai-short-drama-projects-comparison-2026-10-01.md`。
