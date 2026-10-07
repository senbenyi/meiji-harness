# Harness 官方原生插件能力审计

> 状态：已完成静态组合审计；业务接入实测按本文优先级逐项补充
> 基线：2026-10-01；当前 `web` Profile；`dsh 0.1.7-alpha.2`
> 范围：DeepSeek Harness 官方包组、当前组合配置、Standard Agent preset、当前短剧插件可复用能力；不把“官方存在”自动等同于“应安装或启用”

## 0. 结论

- 当前 `web` Profile 的组合配置出现 182 个 `@deepseek-ai/*` 包或子入口；基线审计时均可解析到本机安装树，组合内缺包数为 0，本轮无需安装新依赖。
- 当前环境不是单一版本：启动器为 `0.1.7-alpha.2`，组合中同时存在 `0.1.2-rc.1`、`0.1.7-alpha.2` 和基础依赖 `1.1.6`。后续文档不得再写成统一的 `0.1.0-rc.7`。
- Todo、Subagent、Workflow、Goal、Jobs、Plan、Storage Domain、Session Projection、Approval、Skill、Attachment、Deliverables、Compaction 与 Spill 均已有官方实现。当前插件应先利用这些能力，禁止复制任务列表、子代理调度、计划审批、后台作业面板或会话恢复机制。
- “已安装”“已挂载”“当前 preset 对 Agent 可见”“当前业务已经利用”是四种不同状态。仅存在于 `node_modules` 不能证明可用；宿主层的 disabled 占位也不能证明 Standard preset 未启用。
- 官方包全量研究不等于全量安装。Schedule、SSH、Terminal、Browser/Computer Use、LSP、Webhook、SDK/ACP、Extensions 和 Experimental 等能力必须由明确业务需求触发；当前短剧主链路没有安装或启用它们的必要。

## 1. 审计方法与状态口径

### 1.1 当前组合取证

```shell
dsh --version
dsh --profile web --dump-config
```

审计时逐项核对：

1. 组合配置是否引用该官方包或子入口。
2. 本机 pnpm 安装树能否解析其实际包。
3. 包的已安装版本。
4. 配置行是 enabled、disabled 还是条件启用。
5. 同一能力是否在宿主层禁用、但在 Agent preset 内重新启用。

### 1.2 四种状态

| 状态 | 判定证据 | 能支持的结论 |
| --- | --- | --- |
| 已安装 | 包可从当前 Profile 或 pnpm 安装树解析 | 本机有代码，不能证明运行时可用 |
| 已挂载 | `dsh --profile web --dump-config` 存在有效组合行 | Host 或某个 preset 会装载它 |
| Agent 可见 | 当前会话 preset 的工具/提示词组合包含它 | Agent 可以调用或受到其策略约束 |
| 业务已利用 | 当前插件调用链、Skill 或实测任务确实使用 | 可以计入短剧生产能力 |

## 2. 官方包组全量处置

官方仓库的 package map 是包组全集；完整包级安装账本由审计脚本从当前组合实时生成。下表对全部官方包组给出本项目处置，避免按包名逐个重复发明机制。

| 官方包组 | 本项目处置 | 理由 |
| --- | --- | --- |
| `core`、`api`、`typert`、`boot`、`host`、`client` | 直接使用，不扩写替代层 | Harness 产品主干、RPC 与 Web 壳 |
| `session`、`session-query` | 直接使用会话日志、投影输入和精确读取；不充当项目数据库 | 会话状态与短剧项目状态生命周期不同 |
| `goal`、`todo`、`plan` | 直接使用 | 分别负责长期会话目标、当前轮任务清单、实施前计划审批 |
| `subagent`、`workflow`、`jobs` | 受控使用 | 支持委托、并行编排和本地后台工作，但不拥有业务真值 |
| `storage` | 采用 Domain Storage 作为当前插件项目聚合的结构化存储 | 已有 schema、串行写链和原子 `update` |
| `skill`、`preset`、`context` | 直接使用 | 创作规范按需加载；每会话组合由 preset 管理 |
| `interaction` | 采用 Approval、Ask User 和权限 preset | 付费生成、人工审核和高风险操作不另造审批协议 |
| `attachment`、`deliverables`、`document` | 优先复用，保留画布专属资产绑定 | 普通附件、文件交付、PDF 转换已有宿主能力；画布节点血缘仍属插件 |
| `settings`、`credentials` | 先做字段边界设计，再迁入非业务设置与密钥引用 | 避免插件配置页与 Harness 设置形成双份真值 |
| `workspace`、`fs` | 使用 Workspace 身份和受策略约束的文件能力 | 项目身份仍由插件项目域定义，不能退回 session/workspace 充当 project id |
| `subprocess`、`shell`、`sandbox` | 作为运维和验证基础设施使用 | 不让业务代码绕过唯一文件入口或网关契约 |
| `compaction`、`spill`、`guard` | 直接保留 | 长会话上下文、超长工具结果和重复调用治理已有实现 |
| `llm`、`web`、`mcp` | 使用官方 provider seam 与工具面 | 插件只补充短剧业务工具，不重造通用模型、搜索或 MCP 客户端 |
| `feedback`、`telemetry`、`identity` | 保留宿主能力，不映射为 ReviewDecision | 产品反馈/遥测与素材审核是不同语义 |
| `schedule` | 当前不采用 | 短剧恢复由项目状态和 Harness Job 驱动；没有定时跟进需求，当前 UI 也处于 disabled |
| `terminal`、`ssh` | 当前不为业务链路启用 | 模型连接使用外网 HTTP(S)；SSH 只用于人工运维 |
| `computer-use`、`browser-use`、`lsp` | 当前不采用 | 当前制片链路无桌面自动化、浏览器自动化或 LSP 需求 |
| `webhook` | 待出现可信外部事件入口后评审 | 不能用未认证回调驱动付费生成或状态转换 |
| `ptc-runtime` | 只作为 Workflow 执行实现，不暴露成业务模型 | 内部执行机制不应泄漏为短剧公共契约 |
| `extensions` | 不向生产 Agent 开放自修改 | 动态挂卸插件会破坏可复现组合与审计边界 |
| `sdk`、`acp` | 当前不采用 | 当前插件运行在 Harness 内部，没有外部 Agent 控制面需求 |
| `bundle`、`hooks` | 由部署组合使用，不承载短剧业务 | 属于组装和外部工具桥接层 |
| `experimental` | 默认不采用 | 未稳定能力不能进入生产主链路 |
| `runtime-diagnostics`、`test-support`、`util` | 仅开发与验证使用 | 不成为产品能力或业务状态所有者 |

## 3. 当前高价值能力矩阵

| 能力 | 当前状态 | 当前插件如何利用 | 禁止重复实现/误用 | 下一步 |
| --- | --- | --- | --- | --- |
| Todo | 已安装；Standard preset 启用；UI 已显示 | 多步骤制片任务展示 `pending/in_progress/completed` | 不写第二套任务清单 UI；Todo 下一轮会清空，不能当项目状态 | 在长流程 Skill 中要求 Agent 维护 Todo，但镜头状态仍写项目域 |
| Goal | 已安装；命令、工具和 UI 可用 | 保存同一会话的长期目标，支持暂停/恢复 | 不代替 Project/Episode/Shot 状态机 | 长期制片会话可创建 Goal；项目关闭后仍从项目域恢复 |
| Plan | 已安装；Standard preset 可进入 | 架构改动和高风险实施前提交可审阅计划 | 不用 Plan 文档表达运行中镜头状态 | 保持工程审批用途，不嵌入生产状态机 |
| Subagent | 已安装；spawn/fork、控制工具和 UI 可用 | 小说压缩、角色抽取、连续性检查等独立任务 | 不共享可变对象；不让子代理直接改项目文件 | 通过只读快照输入、领域命令输出接入 |
| Workflow | 已安装；Standard preset 启用；运行 UI 可见 | 用户明确要求大型多 Agent 编排时并行独立任务 | 不作为永不结束的生产守护进程；不隐藏业务状态 | 项目域稳定后再用于可重放的阶段编排 |
| Jobs | 已安装；本地 registry、工具和 UI 可用 | 后台探针、导出、恢复扫描等宿主工作 | 不作为远端媒体任务或供应商任务真值源 | Job 只携带 project/attempt id，真实状态写项目域和网关 |
| Storage Domain | 已安装并挂载 | 保存 Project 聚合、revision、命令结果与恢复状态 | 不直接存大型媒体字节；不假设跨表事务 | 以单 Project 聚合记录为一致性边界 |
| Session Projection/Cache | 已安装并挂载 | Todo、Goal、Subagent 目录和会话 UI 的读模型 | 不作为独立项目真值源 | 项目 UI 另建基于项目域的 read model |
| Skill | 已安装并实际使用 | 加载片型、提示词和生成规范 | 不把 Markdown 当权威业务状态 | Skill 只表达流程与策略，写操作走领域命令 |
| Approval/User Questions | 已安装；Web UI 可用 | 付费生成、逐镜人工确认、迁移和破坏性操作 | 不在插件重复实现通用审批 transport | 业务命令保存审批结果，Harness 负责交互 |
| Attachment | 已安装；本地持久附件可用 | 普通会话文件输入 | 不能假设原生附件自动成为画布 `ref_nodes` | 保留附件到 Asset/画布节点的显式导入步骤 |
| Deliverables/Document | 已安装；UI 与 PDF 能力可用 | PDF、报告、成片清单和最终文件交付 | 不取代 Timeline/Deliverable 业务记录 | 领域产物完成后通过宿主交付 |
| Settings/Credentials | 已安装并挂载 | 宿主级模型、账号、密钥引用和非业务偏好 | 不把 provider secret 写入项目、任务或画布 | 先审计插件 `/config` 字段，再决定迁移映射 |
| Compaction/Spill | 已安装；按 preset 启用 | 长制片会话保持可继续，超长结果落盘 | 不依赖被压缩聊天文本恢复业务状态 | 项目恢复只读结构化状态，聊天只作活动记录 |
| Web/MCP | 已安装并挂载 | 官方资料调研、外部工具接入 | 不让外部内容直接触发付费生成或状态提交 | 外部结果先校验，再转领域命令 |
| Schedule | 仅 Web UI 行存在且 disabled；无当前业务接入 | 暂不使用 | 不因“官方有”就安装整套调度能力 | 出现明确的定时发布/提醒需求后单独设计 |

## 4. Todo、Subagent 与 Workflow 的协作边界

```text
用户目标
  → Goal：跨轮次保存同一会话目标
  → Todo：展示当前轮次做到了哪一步、还剩什么
  → Subagent：执行一个独立、可验证的子任务
  → Workflow：仅在明确需要大型并行编排时组织多个 Subagent
  → Project Domain：保存真正可恢复的剧集、镜头、Attempt、审核和成片状态
```

Todo 的文本和状态由 Agent 写入，Harness 负责校验、会话日志持久化和 UI 展示。Subagent 的创建同样由 Agent 发起，Harness 负责运行、目录、耗时、token 和继续/中断路由。当前短剧插件只应通过 Skill 告诉 Agent“何时需要任务列表或委托”，不得复制底层实现。

## 5. 安装与启用决策

### 5.1 本次结果

- 组合内官方包：182 个包/子入口。
- 可从本机安装树解析：182。
- 组合引用但缺失：0。
- 需要立即安装：0。

### 5.2 后续安装门

新增官方插件必须同时满足：

1. 当前短剧链路存在明确需求和验收场景。
2. 当前已挂载能力没有等价实现。
3. 与当前 `dsh`、bundle 和 preset 版本兼容。
4. 明确 Host 服务、Agent 工具、UI 三者哪些需要安装和启用。
5. 安装后通过 `--dump-config`、实际插件加载日志和真实页面最小操作验证。

禁止仅因为包存在于官方仓库就安装；禁止只安装 UI 而没有 Host 服务，或只安装 Host 服务却误报 Agent 可见。

## 6. 分阶段利用顺序

1. 立即使用：Todo、Goal、Plan、Skill、Approval、Deliverables。
2. 数据底座阶段：Storage Domain、Session Projection 的设计模式、Credentials/Settings 边界。
3. 单 Agent 闭环稳定后：Subagent。
4. 有三个以上独立任务且用户明确要求大型编排时：Workflow。
5. 真实后台恢复需要时：Jobs，但 Job 只驱动，Project/Attempt 才是业务真值。
6. Schedule、Webhook、Browser/Computer Use、SSH/Terminal 等由新增需求单独触发审计。

## 7. 诚实边界

- 已确认：当前组合清单、包解析、版本、Standard preset 中 Todo/Subagent/Workflow 等注册、Web UI 对应展示包。
- 未实测：每个官方插件的完整运行路径；本文只把与当前短剧架构相关的能力列入接入优先级。
- 版本风险：当前安装是混合版本组合，不能从某一个包版本外推所有插件行为；升级前需重新运行审计。
- 安装结论只针对当前 `web` Profile，不外推到 TUI、headless、ACP 或其它电脑。

## 8. 证据

- 当前 Profile：`~/.dsh/profiles/web/package.json`、`cordis.yml`、`../../cordis.patch.yml`。
- 当前组合：`dsh --profile web --dump-config`。
- 当前 Standard preset：`@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml`。
- 本地官方包 README：Todo、Subagent、Goal、Plan、Workflow、Conversation UI 等已安装包。
- 官方包组地图：https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/README.md
- 官方组合清单：https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/composition.md
- 官方工具目录：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-catalog.md
- 官方配置目录：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/config-catalog.zh.md
