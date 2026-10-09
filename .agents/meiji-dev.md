# meiji 开发指引

> 本文按 schemaVersion 3 的当前实现维护。此次集成的自动化与真实运行证据见[实施记录](../docs/implement/1005-实施-合并实施（基座能力接入、项目剧本与角色库）.md)；未完成的真实走查不以自动化结果替代。

meiji 是 DeepSeek Harness 外部插件。本文记录项目专属的开发配置、模块边界、业务约束、编码与数据规则、测试命令和接口参考；档位、计划、实施、验证与图谱使用的通用流程见 [AGENTS.md](../AGENTS.md)。第 0 节中的路径相对仓库根目录，其余源码路径相对 `meiji/`，不维护目录树。原 `meiji/docs/` 的有效内容统一维护于本文：第 15 节为提示词接口与 Model，第 16 节为任务记录，第 17 节为历史迁移记录，第 18 节为网关接口参考。

## 0. 项目开发配置

- 开发范围为 `meiji/` 下代码、配置、skill 和测试，按 `AGENTS.md` 第 0 节判定档位；`meiji/docs/`、`meiji/reports/` 及其他纯文档修改不要求代码开发计划或业务测试。
- 计划目录为 `docs/plans/`，实施记录目录为 `docs/implement/`，文件使用 `MMDD-计划-*.md` 和对应的 `MMDD-实施-*.md`。

### GitNexus 配置

- 已配置 GitNexus MCP，不可用时使用本机 `gitnexus` CLI。通用流程中 `<仓库名>` 使用 `llm-dsh-plugins`，索引存于 `$HOME/.gitnexus/indexes`，不写入源码目录。
- 状态检查及索引更新在仓库根目录执行；索引命令为 `GITNEXUS_STORAGE_ROOT="$HOME/.gitnexus/indexes" gitnexus analyze --index-only`。检查与更新时点按 `AGENTS.md` 第 4 节执行。

### 工具入口与流程钩子

- 根目录 `CLAUDE.md` 只引用 `AGENTS.md`；`.claude/AGENTS.md`、`.cursor/AGENTS.md` 链接到根目录 `AGENTS.md`。
- `.claude/meiji-dev.md`、`.cursor/meiji-dev.md` 链接到本文。规范只改正文，不维护副本；是否读取业务指引按通用入口的请求分类决定。
- `.claude/settings.json` 注册 `.claude/guard.mjs`：`UserPromptSubmit` 提醒代码、配置、skill 和测试修改遵守流程；咨询、只读调研和纯文档修改不执行开发流程。
- `PreToolUse` 检查 `meiji/` 下编辑，排除 `meiji/docs/` 与 `meiji/reports/`；`docs/plans/` 中没有 24 小时内更新的 `MMDD-计划-*.md` 时拒绝修改。通用档位与实施流程引用 `AGENTS.md`，项目范围及测试要求以本文为准。

## 1. 模块职责与调用链

依赖由 `tests/architecture.test.js` 检查：`http/tools → flow（runs、operations、tasks、steps）→ 文本执行/网关/提示词 → runtime → data → models/skills → shared`。存储和执行共用的叶子模块为 `runtime/task-context.js`、`operation-context.js`，只能依赖彼此或 shared，不能反向引用存储/执行器。`flow/steps/` 按业务动作集中具体步骤，`flow/tasks/` 组合步骤，runtime 不反向引用步骤层；media 仅依赖 Node 与 shared。服务端各层可引用这些叶子、`host`、`shared`；`host` 只向下依赖 `shared`，服务端、工具和脚本不得引用 `client`。

| 位置 | 职责 |
|---|---|
| `index.js` | 组合入口：接入 Harness、处理重启遗留的执行标记、检查 FFmpeg，创建唯一的模型队列、Run 服务（`createRunService`）、即时保存服务（`createImmediateService`）及 Run jobs/goals 观察，注册面板并公开 meiji 服务；会话工具不在主机全局注册 |
| `session.js` | 短剧制作预设的子插件，等待主机 ready 后注册 `operation-context-query`、`operation-project-manage` 与 4 个 `run-*` 任务工具及会话说明，释放时撤销登记 |
| `server/host/harness-run-jobs.js`、`harness-run-goals.js` | 通过公开 jobs/goals 观察 Run：任务暂停或终态时结算 job，会话目标绑定任务并在终态结算；模型停止守卫与 owner 脱离 |
| `server/data/script-store.js` | 剧本版本、待确认方案与原子提交 |
| `shared/library-rules.js` | 三类库、变体、关联及跨集同步；库目录只含文字和有图标记 |
| `client/` | 原生 ES 模块面板，通过 `panel-api.js` 访问同源接口 |
| `shared/` | 可用于前后端的纯领域规则：模型、剧集构造与视图、语言、素材保留、节点补充、分镜编辑、门禁、步骤状态及下游删除；不读写文件 |
| `server/http/`、`tools/` | 面板与会话入口，复用服务端流程；鉴权与同源检查在 HTTP 层 |
| `server/flow/runs/` | 任务层：run-engine 唯一调度循环（依赖、分支暂停、审核修订、队列与步骤锁）；run-service 负责预览/确认/并入/恢复、会话归属、前置与剧本阻断检查、人工编辑接管 |
| `server/flow/operations/` | 即时保存：registry 只登记 direct/ 下的人工操作，occupancy 是 Run 步骤与即时保存共用的内存占用；制作目标不在这里声明 |
| `server/flow/tasks/` | 单步职责：task-registry 按 taskType 登记业务处理与队列；text/、media/ 组合具体业务步骤并保存目标结果；task-queue 限流，task-interrupt 处理重启后内容节点上的遗留执行标记 |
| `server/flow/shared/` | Run 单步与即时保存共用的执行入口（`executeRunStep`、`executeImmediate`）及数据协调；图片、视频等具体步骤与公共执行机制归 steps/ |
| `server/gateway/` | 文本/图片/视频网关适配、文本请求入口、视频轮询、请求快照和日志 |
| `server/media/` | 图片解码/文件处理/压缩，FFmpeg 检查、尾帧提取与视频拼接；不依赖操作、提示词或任务执行 |
| `server/prompts/` | Model 编排提示词，interfaces 赋值，`prompt-request.js` 统一请求结构，preview 复用实际入口 |
| `server/flow/steps/` | 每个业务步骤一个 step 文件（生成大纲、提取人物/场景/道具、审核大纲、修订大纲、生成镜头表、生成图片、提交视频、生成视频、提取尾帧等）；公共机制放 shared/；步骤只执行自身，不安排后续，重新生成复用生成、复审复用审核 |
| `server/runtime/` | 步骤执行的上下文、请求/响应与内部动作记录、审核准备与落定；task-context 管内存，step-execution 记录步骤内动作（attempts），run-execution 建立单步上下文 |
| `server/data/` | 文件与记录持久化、内容快照、剧集存储视图及封面；`projectStore` 管项目保存，`project-files.js` 独占存储布局；不放执行器或纯数据规则 |
| `server/host/` | Harness 公开接口适配、工作区与会话查询、日志及归属明确的历史提示词读取 |
| `models/`、`config/`、`skills/` | 模型路由与默认配置、生产规则、审核规则及会话说明 |

制作主链：`面板/会话提交 goal → run-service.plan（shared/run-planner.js 规划）→ 确认 → run-engine 按依赖调度 → 步骤进入对应队列并取得执行锁 → executeRunStep → 网关/媒体 → 保存结果与 Run/Step 快照`。即时保存走 `immediate-service.start`，立即执行并返回结果；对象属于进行中的任务时由 run-service 接管为人工编辑步骤。不能在页面或工具中另建执行通路。

## 2. 提示词 Model

- 按独立生成目标设计 Model，同类步骤复用 Model 与配置；Model 只编排输入和提示词，不调用 API、不保存项目。
- 资料使用 `{ task, review, facts }` 等结构化对象传入。生成、修订和审核分别编排；修订携带基稿与意见，审核只检查待审结果，不执行生成指令。
- 角色、任务、事实、参数、规则、意见和输出协议各有明确位置，避免重复。空上下文省略；输出语言由代码确定，不让模型选择默认值。
- 单段资料（本集摘要、项目摘要、剧本）在具名标题下直接放正文；已有结构化资料直接序列化为 JSON，不重复套包装字段。任务中说明各资料的用途；基稿和待审内容保留实际数据结构，列表用具名集合。
- system 放角色、基础及补充规则、输出协议；user 按本次任务 → 本次要求 → 具名资料 → 基稿及意见/待审内容排列。本次要求集中写代码已确定的输出语言、适用时长与画幅，不输出默认值选择说明。
- 大纲生成与修订直接返回 JSON 数组，不启用只允许对象的 `json_object` 模式，由程序解析并校验数组。其他文本生成、修订和审核返回 JSON 对象并启用 `json_object` 模式。解析字段后再保存与展示正文，字符串转义还原成真实换行；不能直接展示响应对象外壳。图片和视频接口沿用各自媒体协议。
- 文本请求由 `prompt-request.js` 分开组装 system 规则与 user 资料；图片接口接收完整 prompt，参考图 Base64 另传，不写入正文。
- 预览与提交复用同一组装入口；历史展示实际请求快照，不用当前资料重建。
- 大纲审核的 system 只放角色、审核原则、节点审核标准及补充、返回协议；资料用途及修订对照范围放 user。程序检查 JSON 结构，模型检查有证据的剧情问题，不审核展示标题或强求无依据的弱点、微动作。

参考：`server/prompts/models/`、`server/prompts/interfaces/`、`server/prompts/prompt-request.js`。

## 3. 任务与步骤

- 任务（Run）是一个可恢复的用户目标，步骤（Step）是不可删除的执行历史；内容节点是项目资料，和执行记录分开。数据结构、状态、暂停原因与锁见[重构计划「总体约定」](../docs/plans/1006-计划-Run步骤引擎基础.md#总体约定)。
- 步骤只由 `shared/run-planner.js` 按目标规划，客户端不能指定步骤、actor 或锁范围。文本对象为「生成 → 审核」，按意见修改为「修订 → 复审」；手动图片为「生图 → 等待人工确认」，人物生成任务内的图片为「生图并自动入库使用」，生成、下载转 Base64、保存候选是生图步骤内的三个动作（attempts）；成片每镜为「分镜 → 视频 → 尾帧」。
- 任务状态由步骤推导（draft/running/paused/completed/cancelled）。步骤执行失败（`step_failed`）或审核用尽修订（`review_exhausted`）只暂停所在分支及其下游，独立分支继续；取消分支连带取消下游，不视为依赖成功。
- 审核不通过由引擎追加最多 2 轮「修订 → 复审」，自动修订的意见取自正文节点上的本轮审核结论，不写入人工意见栏；复审带入修订前基稿与本轮意见。程序校验不通过、无法保存的生成稿在生成步骤内按校验问题修订，仍不通过才作为步骤失败。接口故障或审核协议错误属于执行失败，不触发内容修订。
- 一集只有一个未结束任务（draft、paused 也算），新目标并入当前任务（amend）；项目级任务的 episodeId 为 null。意见、重新生成、人工编辑在同一任务内插入新步骤，被替换的步骤标为 superseded 并保留历史。
- 执行锁：剧情资料（大纲、人物、场景、道具）、摘要、项目摘要、剧本回写/修改为项目级步骤，与一切互斥；其余按集、按对象互斥。锁等待不占模型队列名额；暂停或取消不提前释放仍在执行的步骤锁。
- 同一任务内成片按镜头顺序接续尾帧：后一镜的步骤依赖前一镜的尾帧步骤，前一镜未完成（失败、暂停或等待前置）时其后各镜都等待；只做单镜时不等待。视频已完成的镜头在「只做未完成部分」时不重编分镜。
- 目标范围外未完成的前置（含剧本更新后的项目摘要）列入 `prereq`，须用户授权才纳入；未授权时依赖它的分支暂停 `prereq_required`。剧本有待回写或待确认方案时，剧情层步骤暂停 `script_pending`，镜头、指令、图片和成片步骤照常执行。
- 即时保存（文字、图片导入/删除、参考图、人工放行等）不建任务，只在 `history/events` 留项目事件。文字编辑若被进行中的任务接管，记为 manual_edit 步骤并由用户选择复审或直接通过；没有任务接管时保存后立即审核。
- 面板发起的任务不创建会话目标、不通知会话；会话提交或并入过的任务绑定会话目标，暂停时目标保持进行中，完成或取消时结算。job 只观察任务；owner/service 销毁只脱离观察，不取消业务。

接口与存储见第 16 节。

## 4. 重新生成与按意见修改

- **重新生成**使用当前指定的上游资料，不带目标旧稿及历史意见。`outline/regenerate` 在请求前清空本集 plot、shots、assembly、pendingImages，即旧大纲、人物/场景/道具及图片关联、候选图、镜头和合成；失败或取消也不恢复旧数据，只保留本轮已保存结果。
- 清空剧情不删除摘要、节点补充、其他剧集、全局素材文件或任务历史。对应实现为 `server/runtime/review-checks.js` 的 `prepareChecks` 与 `server/flow/shared/task-executor.js` 的 `releaseOperation`。
- **按意见修改**提供基稿和本次意见，只改受影响内容及必要关联；自动修订使用本轮失败稿与审核意见，下游不继承上游意见。
- 成功后只清理已提交的意见，失败保留，不能清除执行期间新输入的意见。其他操作沿用各自保存、回退和下游删除规则。
- 图片重新生成和按意见修改保留旧候选记录及文件，直到新候选成功保存后在同次写入替换，再清理旧候选文件；请求校验失败、预览取消、生成失败或停止均保留旧候选及已确认图。候选 ID 已处理或不属于本卡时拒绝请求，不能悄悄改用另一张基图。前端不提前调用放弃候选。
- 单卡图片的版本保护只比较本卡资料/原图、该卡候选、项目输出语言与画幅，不将其他卡的生成和候选保存视为依赖修改。其他文本/视频步骤仍使用原依赖范围。图片目标接受已有五种比例（9:16、3:4、1:1、4:3、16:9）和像素尺寸，实际提交由网关尺寸映射校验。

## 5. 面板交互

- 生成入口保持可见，前置条件不足时禁用并说明节点与原因；门禁复用 `shared/generation-gates.js`。
- 任务历史为两层：任务列表 → 步骤详情，可按剧集、状态、发起方和对象筛选；进行中与暂停的任务置顶并常驻任务条。详情按对象分组显示步骤、来源、审核与失败原因、时间、内容快照和实际提示词，暂停原因给出可用动作；复用事件推送及时更新。
- 剧情顶部查看整次操作；大纲、人物、场景、道具区块各有按 target 查看任务历史与 skill 的入口。人物/场景详情合并文字和图片历史；图片、每秒指令及成片卡按自身 ID 过滤，成片也保留整集入口。
- 节点 skill 页为「基础 skill / 补充 skill」两个 tab：基础只读，补充整段编辑，空文本保存即清空；切换保留草稿，保存失败保留输入。实际提示词在任务步骤中查看。
- 意见是本次修订输入，补充 skill 是节点持续规则，分开保存。辅助入口放标题区，不单独占行；窄面板自然换行。
- 图片候选支持确定/放弃，生成中禁用确认，刷新后可恢复待确认项；放弃保留已用图片，选图不改变文字剧情审核结论。人物附属素材不再单独生成，道具图在道具卡操作。
- 图片 Run 预览取消时退出本地生成状态；重新生成请求失败或任务停止后恢复旧候选的确认/放弃/重试入口。并发刷新按本卡执行锁判断忙碌。项目库的「重新生成」显式使用 regenerate，即使已有图片也执行生图。
- 道具可人工删除并保留操作历史；当前删除不联动下游，素材库文件保留。
- 弹窗统一复用 `showPanelDialog`，遮罩限定短剧面板，支持取消和 Esc，多层只关闭最上层，不遮挡 Harness 会话区。

## 6. skill 分工

以 `skills/skill-catalog.js`、`skills/load-skills.js` 的登记与加载为准，详细写法见 [skills/README.md](../meiji/skills/README.md)。

| 来源 | 用途 |
|---|---|
| `skills/task/` | 按功能平铺的基础生产规则；生成与修订复用，不另建 revise 文件 |
| `skills/review/` | 独立审核规则；通过 `reviewFile/reviewVariants` 登记，不用生成指令代替审核规则 |
| `skills/session/panel.md` | 注册到 Harness 的会话说明；生产与审核 skill 不注册到会话 |
| 节点补充 | 当前剧集、当前节点的附加要求；生成/修订执行，审核作为验收依据，不覆盖输出协议 |

`skill-catalog.js` 管映射，`load-skills.js` 管读取与校验，`output-protocols.js` 管输出协议。基础正文可为空，缺文件或未登记文件报错；角色、语言、修订边界和输出协议由 Model/代码负责。没有模型审核的图片、视频任务不新增审核调用或审核 skill。

任务开始时冻结 skill 内容与来源版本，编辑只影响后续任务。节点补充按项目、剧集、节点校验归属；保存位置见第 12 节，不根据目标名称自行扩展支持范围。技能修改只经面板同源接口，会话工具不提供修改能力。

## 7. 结果与审核一致性

- 输出协议、解析、校验、保存和展示一起修改；ID、路径与素材关联由程序管理。
- 模型审核统一使用 `shared/review-result.js` 的 JSON `{ passed, issues }`：问题必须有非空 location/reason/requirement；通过时 issues 为空，不通过必须有问题。拒绝旧 PASS/FAIL、围栏和矛盾结论。
- 程序检查与模型审核记入同一自审步骤的 attempts，任一不通过即自审未通过。接口故障或审核协议错误属于执行失败，不触发内容自动修订。
- 草稿保存与审核通过分开，后续失败不抹掉已通过阶段。审核问题和执行错误分别保留，界面不重复显示同一原因；没有可用正文时仍展示失败原因，禁用人工放行。角色格式校验失败时可提交意见，以同集最新未发布原文为修订基稿；没有正文或失败稿时拒绝修改。
- 人工忽略自审仅限面板、仅对当前版本有效，不能忽略格式错误。每秒指令的草稿保存边界见第 10 节。

## 8. 项目修改核对

- 从实际入口核对 Model、接口、执行步骤、保存、下游清理与调用方；涉及页面时核对任务历史、意见和 skill 入口。
- 覆盖生成、修订、审核与失败路径，确保提示词、解析、保存及展示一致。
- 后端改动后重启 Harness 并刷新面板，确认服务加载新代码。验证记录按 [AGENTS.md](../AGENTS.md) 执行。

## 9. 运行数据与请求边界

- 会话与项目按需关联：仅 session-projects 显式选择有效，新会话不继承工作区项目。绑定后会话只处理本视频相关请求；无关内容、另建或打开其他项目时提示「请切换工作区或新建会话」，项目工具拒绝自动更换绑定。会话工具创建或打开仅绑定当前会话；面板创建项目始终在该项目工作区新建会话并切换，旧会话及其关联保持不变。面板打开已有项目继续绑定当前会话，无会话时才新建。旧 workspace-links 映射退出执行路径，原文件不删除，未显式选择的历史会话需重新打开项目。
- 删除项目同步注销该项目 workspaceId 对应的 Harness 工作区并清理 session-projects 选择记录，保留旧会话本身及其他工作区。仅删除当前会话关联项目成功后创建不带 workspaceId 的新会话，面板切换到新会话；删除其他项目不新建或切换会话；工作区注销失败时保留项目，已不存在的工作区允许继续删除。删除剧集不触发上述切换。
- 用户数据根为 `$DSH_HOME/storages/meiji/`，DSH_HOME 默认 `~/.dsh`；源码与数据分离，迁移备份放 `$DSH_HOME/backups/`。
- 项目索引只保存剧集文件引用，每集独立存储。创建保存标题、模式、画幅及模式对应的必填资料，没有创建前摘要草稿或 project-drafts。任务、内容和提示词快照放项目 history；步骤保存引用与时间，列表不携带完整提示词、密钥或图片 Base64；提示词读取校验任务归属。
- 图片候选放 `image-drafts/`，确认后入全局素材库；导入先暂存。素材库和任务历史不因重新生成而删除。
- 素材库七类卡片的删除走面板 `library-delete` 直接操作，仅原子写入素材元数据 `removedAt` 并从列表排除；原文件与 `file/script` 按 ID 读取保留，项目已有引用及历史不变，不释放磁盘空间。该可选字段无需旧数据迁移。
- Harness 会话默认模型由 `server/host/harness-chat-model.js` 同步到 meiji-gateway，使用相同 baseUrl、chat.model 与凭据；启动与模型保存共用入口。凭据仅写 credentials 服务，配置用引用；模型目录用当前 settings.describe，写入用 mutate/update，不使用已移除的 get。
- layout=2、schemaVersion=2 的旧项目离线运行 `scripts/migrate-project-v3.js`：只补索引，备份、读回验证，失败还原，不改剧集文件。
- 运行模型配置为 `storages/meiji/models.json`；仓库默认配置为 `config/models.json`，本地覆盖为被 git 忽略的 `config/models.local.json`。密钥不返回浏览器、不写日志或文档。
- gateway 校验生成请求的地址、密钥和当前模型；轮询、下载不要求生成模型。第三方图片下载不附网关密钥，不做缺密钥时的隐式后端回退。

## 10. 生成流程约束

### 摘要与剧情

剧本素材存 `assets/scripts/`，支持 UTF-8 TXT/TEXT，最多 1 MB、200000 字符。项目持久化 `mode: free | script`，创建默认 free，暂不支持创建后切换。自由模式必填 AI 创作方向（premise，最多 1000 字），禁止导入剧本；剧本模式必填 script 或 scriptAssetId，禁止设置方向，不预生成摘要。导入剧本建立第 1 版，素材原文保持不变；自由模式首次回写建立分节剧本。scriptKind 仅区分 imported 原始剧本与 assembled 自动回写记录，方向是否参与生成由 mode 决定。自由模式方向持续指导每集故事小段，自动回写不改变模式；本次 requirements 选填，不代替方向、不自动保存为方向。方向仅由人提供与编辑，会话不可修改，新方向用于之后生成；本次要求与已发生事实优先于方向，方向优先于回写参考与项目摘要。剧本模式隐藏方向，提示词不注入 premise，方向编辑接口拒绝写入。自由方向禁止清空，剧本模式编辑、方案确认及版本恢复禁止清空剧本。剧本是参考，沿情节顺序并以已发生剧情为准，审核不因剧本外事件直接判失败。

项目摘要保留独立展示提取入口，不作为剧情任务前置。剧集摘要只能由最新已通过故事小段提取，记录 outlineRevision，仅在列表和剧情页展示；不自审、不修订剧情、不自动回写、不触发下游清理。大纲通过后摘要为 optional/branch 旁支，失败记录错误可单独重试，不阻断镜头制作。独立摘要任务正常报告失败。

剧本保存保留版本和显式修改方案机制；显式回写使用完整故事小段及其版本，不从压缩摘要回写。自由模式删除剧集保留删除回写事实。跨集提示基于大纲版本及前集大纲版本，摘要更新不影响提示。

新增/编辑剧集只设置时长及本集要求，没有摘要输入、AI 摘要草稿和摘要 Tab。默认时长 150 秒，可设 1–86400 整数秒；无摘要也可建集、直接生成故事小段。人工编辑后以最新故事小段为准，可覆盖原剧情来源。

剧本具有独立「第N场」「场N」「Scene N」标题时，`shared/script-scenes.js` 按出现顺序识别分场，第N集完整对应第N场，场内时间小节不拆集。新建集的面板与制作目标入口均采用本场明示时长（没有时长则沿用输入/默认时长），不允许超出场数新建。剧情生成、修订及审核仅提供本场正文与标题前共同设定，并优先执行一场一集规则；人工正文审核优先级保留。无分场和自由模式沿用原规则，已有制作数据不自动重写。


剧情默认目标与剧情页按钮只生成并审核大纲。大纲通过后，在本集资产点击“生成人物角色”才提交 scope.only=characters 的独立任务，提取时先匹配项目角色库，已有角色直接引用身份、外貌、声音及图片，新角色生成完整资料；审核后仅为缺图出镜人物生图并直接入库使用，不等待人工确认；任务等待图片保存结束。手动人物任务的进度、审核意见和历史归本集资产。镜头表不要求人物卡；新每秒指令的participants只能选本集角色卡人物，空镜/独立旁白允许空清单，不隐式提取人物或生图；直接成片时只读取已通过指令 participants，以本镜现有卡及项目角色库名称/别名确定角色并复用资料、声音和参考图；不安排人物生成、自审、角色补图。缺资料时明确失败，保留上游；有文字外貌无图可直接编译。纯环境和独立旁白可使用空参与清单。取消自动提取场景、道具及场景补图；镜头表前置只要求大纲通过审核，不要求场景或道具。剧本模式直接按剧本、集序、时长和前集完整故事提取本集剧情；自由模式直接按方向和已发生故事创作。不传项目或剧集摘要。直接返回非空 JSON 数组（不包装“故事小段”或 outline 对象），每项仅含编号（从1连续递增）、时长秒（正整数）、正文（非空字符串）；所有时长之和在剧集目标上下10秒内，下限至少1秒，保留选定剧情的事件、完整对白、声源、动作、状态与结尾细节。数组直接存 plot.outline.content，逐段编辑正文和秒数并实时显示总和，人工保存标记 sourceMode=manual；审核不恢复人工删除的原剧情。镜头表只以最新故事小段拆镜，可一段多镜，完整覆盖各段细节。手动人物卡片基于本轮通过的大纲，返回完整 items JSON；成片直接消费当前已通过每秒指令的 participants 并读取项目角色资料，不返回或生成新的角色 items；outline/characters 分别保存快照，不再记录 story 聚合快照。

镜头表返回 `{"shots":[{"shotId":"S01","durationSeconds":12,"title":"剧情标题","content":"直接叙事正文"}]}`，编号连续、秒数为 1–15 的整数。正文用一段或少量自然段表达事件与必要交接，不要求固定栏目或分段理由。单镜修订使用同一结构，只返回指定镜头，编号和时长不变。解析后按现有镜头卡片存储标题与正文；非法结构不覆盖有效内容，已保存的旧栏目正文仍可使用。

人物只提取实际可见身体；环境和物件直接写在大纲、镜头及每秒指令叙事中，不为场景或道具自动建卡。人物修改保留同名实体 ID，新实体递增。本集资产只显示人物，项目概览只显示角色库；场景/道具区块与库入口取消。

### 项目角色库与场景清理

当前流程只提取人物并写入项目角色库；条目含名字、别名、身份字段与变体，变体含外貌字段及图片节点。新人物审核通过才并库；提取响应解析先用 characterLibraryTarget 按有效ID或名字/别名读取默认资料，已有角色可只返回name、presence、libraryId，不强制重生外貌/声线。失效ID、歧义及同库身份重复引用拒绝，否则新角色仍校验完整字段。关联卡片字段与图片以库为准，图复用无需生成/确认。底层三类字段及历史独立操作保留空骨架，不再作为统一生成目标。

用户已要求删除已有场景；服务启动在 interruptRunning 后、Run recover 前执行 `server/data/remove-scene-data.js`：持久化清空所有剧集场景卡、项目场景库及关联候选，清理 scenes 素材、场景候选文件与旧 E 图片；引用场景的镜头按既有删除规则重置，人物、摘要、剧本与历史保留。重复清理幂等，不在读取层伪装空数据。清理失败阻止服务 ready，不能忽略后继续恢复任务。

修改关联卡片写回库并同步全部关联剧集，保存前显示同步集数与删除清单；本集新变体不影响旧关联。图片确认同步库及关联卡片，删除引用该实体镜头的分镜、视频及合成。导入照片来源为 photo，单卡手动 AI 候选必须人工确认；人物生成任务内的图片自动入库使用。可改关联、解除、合并迁移；场景/道具有关联条目/变体不能删除；角色删除同步清理全部关联卡。必须出场的角色进入剧情上下文。下游仍使用剧集卡片 ID，关联列表临时派生，不持久化。

### 每秒指令与视频提示词

每秒指令按镜头顺序逐镜生成，每次返回仅含当前镜头的 shots JSON（version: 2），保持上游镜头 ID 与时长；beat 使用正整数 durationMs，由程序累计时间，dialogues 独立保存、beat 引用事件 ID，ambient/music 带时间。`shared/seconds-content.js` 管校验与可读正文，新文本直接使用稳定人物名称，dialogues 使用 speakerName；独立画外旁白固定 NARRATOR 且 delivery 为 off。旧版 version 1 的 ID 标记及 speakerId 仍可读、校验和编译，无需迁移已有数据。

程序检查结构、实体、时长与对白，模型审核语义。`seconds-feedback.js` 区分程序问题、语义问题和人工意见并去重；每镜独立任务生成、自审、至多两轮自动修订与复审，通过并保存后才继续下一镜。失败或取消停止后镜，已完成前镜保留。前镜更新同次删除后镜指令、分镜、视频和合成；清空后的旧稿只留历史。能唯一对应上游的镜头保留正文与失败原因；不可解析或无法对应上游时只存未发布 artifact，不覆盖旧镜头。生成/修订原始响应另存 seconds-response 快照。

最终视频提示词由 `compileVideoPrompt` 直接编译为有图六字段或无图三字段，不调用模型重写。referenceSnapshot 固定 Picture 顺序，Subject 表示实体，服装共享所属角色 Subject、武器独立；sourceMap 记录来源，人工编辑后移除。新版名称仅在编译副本中绑定角色与参考图，台词原文和原指令不重写；sourceName 保留指令称谓与库别名的对应，characters.secondsSource 仅保留旧提取来源兼容，不作为成片是否可复用角色的门禁。人工编辑仍需格式与语义审核。版本或素材变化需重新组装；图片在视频提交时按快照读取本地文件并转 Base64。

### 图片与视频

人物、场景及道具图片与文字提取分开，通过对应 Model 编排；道具使用 `image:Pnn` 目标，`part-image` 仅是基础 skill ID。场景图只使用实际场景资料，未指定视向时用中性建立视图。本集资产人物生成任务的图片自动入库使用；单卡手动生图、项目库生图仍须人工确认后入库。

视频保存后提取尾帧；FFmpeg 失败保留视频并报错，tail-frame 可单独重试。整集/逐镜制作发现已有视频缺尾帧时只补提取。

## 11. 编码规则

- 按实际调用链组织代码：同一生命周期集中维护，固定顺序用直接调用和条件分支表达，不另建通用步骤调度器；删除纯透传函数和中转导出，调用方直接引用职责模块。校验、快照、并发、记录与持久化等实际业务边界保留。
  - `server/flow/runs/run-engine.js` 专门负责 meiji 任务的依赖、分支暂停和审核修订，不扩展为任意工作流框架；旧「操作 → 任务 → 节点」执行链已删除，`tests/architecture.test.js` 禁止其模块与执行标识回流。一个运行 home 只由组合入口创建一份 Run 引擎，模型并发队列和执行锁由该实例统一持有。背景与阶段记录见[重构计划](../docs/plans/1006-计划-Run步骤引擎基础.md)。
- 按第 1 节分层；`client/`、`shared/` 使用平铺 `.js/.css`，不引入 JSX、bundler 或构建步骤。shared 不引用 Node 专属模块、client 或 server。
- Harness 接入只经 `server/host/` 的公开接口，不读取上游存储文件。
- 制作目标的步骤模板在 `shared/run-templates.js`、`shared/run-planner.js`，单步职责在 task-registry 按 taskType 登记队列与 run。即时保存在 direct/ 登记；人工专属操作标 agent:false。不增加旧操作别名或中转导出。
- 文件参照 skills 使用小写连字符命名，优先「动作 + 对象」或「对象 + 职责」，如 `operation-outline-edit.js`、`task-outline.js`、`project-store.js`，避免孤立的 `run.js`、`request.js` 等泛名。会话的查询与项目管理工具使用 `operation-` 前缀，任务工具使用 `run-` 前缀，均为小写连字符；`operation-context-query`、`operation-project-manage` 的工具名与实现文件主体一致，4 个任务工具集中在 `tools/run-tools.js`。迁移脚本使用 `migrate-` 前缀，测试按对应模块或明确主题命名。保留 `index.js`、`README.md` 等标准入口。
- skill 分工与登记规则见第 6 节。

## 12. 数据规则

- JSON 通过临时文件 + rename 原子替换，权限 `0600`；素材导入经 `.upload/` 暂存后重命名。
- 人物新增 `costumes: [{id,name,description,context}]` 保存全部明确服装，ID 由程序分配并跨集复用；`defaultCostumeId` 指定默认服装，`costume` 保留原始形象描述。创建与显式离线迁移优先匹配原着装描述，否则选择首套并保存ID；重排不改变默认，服装详情可设为默认并同步关联集。已有角色提取只追加有依据的新服装，不重写固定资料；服装集合变更本身不清理成片。
- 人物图片保存 `image.content.costumes[id]`，每项为图片引用及生成时的服装 description。人物生图先准备独立基准图，再按服装数组顺序逐套提交；每套始终引用同一张基准图及本套服装描述，产物为人物实际穿着该服装的完整图。集成提取只为缺失图片调用模型，已有基准图及匹配描述的穿搭复用原像素。全部成功后一起保存；提取任务自动入库，单独生图保留候选确认。失败清理本轮候选，保留旧图。缺少任一对应服装图或描述已变更时，不判定整个人物图片已齐备。
- 项目和关联剧集人物卡统一进入项目人物资料编辑页，人物资料内联编辑，服装以每排4个「上图下名称」缩略卡展示，点击进入独立服装编辑页展示图片、名称、描述、适用场景及保存/移除；人物页不嵌入服装大表单，人物资料保存不提交服装数组，避免覆盖独立服装编辑；服装图提供＋/－，＋底部选择导入或素材库，－删除当前服装资料及图片引用（无图片也可删除），详情删除成功返回人物页；人物/服装表单保存按钮置底放大，移除服装独立放置；各类库已移除手动条目合并入口、操作和迁移逻辑，编辑与关联同步保留；旧剧集人物详情页、专属图片工作台及回退路由已删除。保存结构化资料时同步生图 look 与关联剧集；成功后刷新已保存页面，未提交的新编辑保留。
- 剧本模式项目详情角色库旁提供「提取剧本重要角色」与「添加角色」。项目级 `project-characters` 任务直接读取完整剧本，生成/修订稿保存在 `projectCharacters`，审核通过后增量入库，不依赖剧集或自动生图。群演和普通无名人物默认排除，明确外貌衣着完整保留，未知不补造。
- 旧角色服装及默认ID通过 `scripts/migrate-character-costumes.js <DSH_HOME>` 离线备份迁移，启动/重启脚本在服务启动前执行，原默认着装和图片保留。
- 项目读写只经 `projectStore`，布局只由 `project-files.js` 处理；save 按 revision 串行提交，只写变化剧集，最后替换索引。
- 领域 schemaVersion 为 3，存储 layout 为 2，任务记录 Run 的 schemaVersion 为 1。拒绝旧结构，不做运行时兼容。默认离线备份迁移；用户明确授权删除时使用 reset-runtime-data.js，停止服务后清空项目与生成文件，保留素材库和系统配置。
- 摘要、大纲、人物、场景、道具补充存每集 `supplementalSkills`；其他阶段补充与指导素材暂存项目 `skills`。剧集不接受 customSkills/guidanceAssets，旧数据通过 `migrate-custom-skills.js` 迁移。技能修改层只经 `skill-store.js` 读写。
- 旧七字段及编号字符串大纲通过 `scripts/migrate-story-outline.js <DSH_HOME>` 离线转换，先备份索引和剧集再写入并读回核对；失败还原，旧正文保留为结构化编号段，按正文长度暂估各段时长使合计等于剧集目标，标记为待复审并保留既有下游素材；不修改历史请求。启动与重启脚本自动检查。
- 新生成素材不覆盖旧素材，参考图变化后按 R6 删除引用实体镜头的分镜、视频与合成；剧情重新生成的清空边界见第 4 节。
- 发起请求校验会话与项目绑定；制作任务按 runId 查看与控制，即时保存返回 editId；针对剧集的请求携带 episodeId；密钥边界见第 9 节。

<a id="test-environment"></a>

## 13. 测试环境与命令

- 代码、配置、skill 和测试任务开始前运行一次全量测试并记录基线；同一任务分阶段或跨轮继续时沿用已记录的基线，不重复跑全量。每阶段只运行相关测试，整项任务收尾时运行一次全量测试；不因阶段完成或回复用户而要求全量。出现测试失败、影响范围扩大或尚未解决的回归风险时，按实际需要补充测试。相关测试必须通过，全量不得新增失败，同时记录通过、失败与 cancelled 数。纯文档修改只检查内容、链接与差异。
- 全量测试命令：在仓库根目录运行 `cd meiji && npm test`；相关测试可在 `meiji/` 下运行 `node --test tests/对应文件.test.js`。何时运行及通过要求见 [AGENTS.md](../AGENTS.md#3-测试与收尾)。
- 测试固定使用 `tests/fixtures/models.local.json` 的测试密钥，不读真实密钥；UI 测试从同级 deepseek-harness 或 `HARNESS_DIR` 加载 jsdom。
- skill 正文变更时，用 `tests/fixtures/prompt-scenarios.js` 采集改前/改后请求，运行 `scripts/prompt-diff.js`，核对删除语句的去向或理由。

## 14. 外部边界

- 不修改上游 Harness 源码；`configure-harness.sh` 负责插件链接、迁移与启动，`restart-harness.sh` 校验链接后重启，源码 `meiji/cordis.patch.yml` 是预设唯一配置源，configure 只链接，不覆盖；短剧制作默认、standard 保留。
- 制作顺序由 `shared/generation-gates.js` 的上游资料与自审条件控制，不要求逐阶段人工审核；图片候选的“确认使用”仅用于素材选用与入库（见第 5、10 节）。
- 网关没有取消接口：停止、关闭或重启只取消本地任务，远端可能仍运行；不续查、不自动恢复，重试重新提交。
- 网关没有文件接口：图片以本地 localPath/assetId 为准，视频参考图按 Picture 顺序提交 Base64，文本请求不传图片。
- 生成任务经全局队列限流，并发上限来自 `config/models.json` 的 concurrency 配置。

<a id="prompt-models"></a>

## 15. 提示词接口与 Model 参考

### 15.1 修改入口

`server/prompts/interfaces/prompt-interfaces.js` 只选择接口，未知接口报错，不补默认模板。下表路径相对 `server/prompts/`。

| 任务 | 实际编排入口 |
|---|---|
| 项目摘要提取 | `interfaces/project-summary-interface.js` → `models/project-summary-model.js` |
| 剧集摘要 | `episode-summary-prompts.js` → `interfaces/episode-summary-interface.js` → `models/episode-summary-model.js` |
| 大纲、人物、场景、道具 | `story-prompts.js` → `interfaces/story-content-interface.js` → `models/story-model.js` |
| 镜头表、单镜修订、单镜每秒指令、图片提示词改写 | `interfaces/prompt-interfaces.js` → `models/text-step-model.js` 的配置与 `stepInterface` |
| 最终文本分镜 | `video-prompt-renderer.js` 程序编译；人工编辑的模型审核用 `models/text-storyboard-model.js` |
| 人物图、场景图 | `interfaces/character-image-interface.js`、`scene-image-interface.js` → 对应图片 Model |
| 道具图 | `interfaces/prompt-interfaces.js` → `models/part-image-model.js` |

`generationParts/reviewParts` 提供任务冻结的规则、节点补充、素材、语言和协议片段；Model 选择资料并经 `generationRequest/reviewRequest` 组装。`text-prompts.js` 负责分发和序列化，`server/gateway/model-gateway.js` 的 `runTextRequest` 负责一次网络请求、日志与取消。不能直接读内置 Markdown 绕过技能快照。

文本接口返回 system/user 分段数组，序列化请求为 `{ skill, system, user, json, segments }`；审核请求标记 `skill: review`。分段保留来源信息；system 为空时可仅发送 user。图片输出单段 prompt，图片字节单独交给生成层。

### 15.2 摘要与剧情 Model

`EpisodeSummaryModel` 保存项目背景、目标集和参考时长、前后集资料、生成/审核规则及修改基稿与意见。实际业务优先经 `buildEpisodePrompts` 赋值，不单独构造而漏掉节点补充或任务技能版本。

`StoryModel` 通过 `storyKinds` 区分 outline、characters、scenes、props；`StoryOutlineModel/StoryCharacterModel/StorySceneModel/StoryPropsModel` 是指定 kind 的子类。大纲携带剧本或方向、集序及前后集完整故事小段，不携带展示摘要，提取模型以已通过大纲为事实来源，避免重复携带无关上下文。

两类 Model 都提供 `toGenerateMessages/toReviseMessages/toReviewMessages` 和对应 `to*Segments`。生成/修订分别输出摘要 summary 对象、大纲数组或卡片 items 对象；审核一律输出 `{ passed, issues }`。生成与修订读取 task 规则，审核读取 review 规则。

修订参数包括 baseContent、opinion；自动修订使用 `automatic: true`，humanOpinion 保留仍有效的人工要求。复审核对最新失败稿及本轮意见，不把历史失败直接当成新结论。正常剧情任务仅一次大纲生成与一次审核；独立人物任务另行生成、审核和补图，失败时按第 3、7 节决定修订与停止。重新生成和修改的素材保留边界见第 4 节。

| 镜头任务 | 主要输入顺序 |
|---|---|
| 镜头表 | 大纲 → 本集时长与允许范围 → 历史场景/道具资料；不注入人物卡或独立人物称谓区块 |
| 每秒指令逐镜编排 | 本镜镜头表 → 上一镜本轮通过的交接摘要（首镜或前镜无通过内容时无此项） → 本镜历史场景/道具资料 → 剧情大纲整体参考；另附本镜时长，不注入人物卡或独立人物称谓区块 |

镜头表先估算大纲各小剧情的必要动作、完整对白与转场时间，再分配整集预算并拆为 1–15 秒片段。同一小剧情超过 15 秒拆段时，标题使用相同基础名称加 1、2…，例如「发现旧信1」「发现旧信2」；S 编号仍按整集连续递增。

人物身份、服装和外貌中影响剧情的事实以大纲及镜头叙事为依据。镜头表、单镜修订不注入人物卡资料；每秒指令仅注入本集称谓、可选服装目录、默认ID及最近已确认穿着，用于选择 costumeId，不注入固定外貌声线；基础规则仅要求沿用上游人物称谓并直接使用名称，speakerName 和 NARRATOR 由每秒协议负责。成片阶段才使用角色卡外貌、身份和图片进行绑定。

镜头表用直接叙事表达分段剧情、必要人物地点、完整台词/旁白及剧情边界，必要起点与状态变化融入正文；不列七栏目、不解释分段理由、不反复罗列稳定衣着/伤势/环境。每秒指令依据本镜关联资料设计机位、景别、构图、剪辑与具体空间调度，承接上一镜交接摘要；保留上游明确事实，不以镜头表未写摄影细节或缺少栏目判失败。生成、修订、审核和输出协议都遵守此分工，兼容已保存旧栏目正文。

前镜交接摘要由程序从当前已通过的前镜提取，不调用模型：只含 shotId、最后 beat 的 endState/camera/space/sound，以及持续到切点（endMs 等于前镜总毫秒数）的 ambient/music 文本。位置、朝向、持物及未完成动作读取 endState；不携带 summary、action、全部 beats 或对白原文。摄影/空间/声音参考只用于理解末段切点，不复制前镜过程或机位，不把局部动作声自动延长；允许有依据的转场、时间省略与机位变化。生成、审核、修订、预览共用相同摘要，前镜没有可用末态时省略。

同一地点、同一目标的连续行动优先合在可容纳的 1–15 秒视频片段，摄影切镜、反应与微动作不自动拆片段。每秒 beat 按必要变化划分，可覆盖整镜，不设 1–5 秒范围或固定字数；审核接受合理合并，不要求补齐无因果作用的微动作。编号、时长、剧情状态与时间校验仍保持。

镜头表按大纲数组的编号顺序逐段拆分，每镜1–15秒整数，允许15秒；各段镜头时长之和精确等于该段时长秒，全表合计等于大纲总和。剧集目标±10秒在大纲阶段校验，拆镜不再次调整总预算。禁止跨小段合镜/借秒、扩写补时或删减剧情；程序校验累计边界和总和，语义审核核对来源正文，修订仅调整对应段内拆分。原大纲已有旁白完整保留，进入每秒指令的 dialogues，speakerName 为 NARRATOR、delivery 为 off，不建人物卡或图片引用。

每秒指令使用 seconds 操作：整集逐镜建立任务；track 指定单镜修订。未提供新的整集意见时，从第一个未通过或缺失镜头继续到末镜；人工整集意见作用于全部镜头。历史节点和快照关联 seconds:Snn。

### 15.3 人物与场景图片 Model

人物普通生成、参考生成和意见修改均通过 `CharacterImageModel`；场景使用 `SceneImageModel`。两者提供 `toSegments/toPrompt`，可 JSON 序列化后通过创建函数恢复实例；接口负责赋值，模型不读取文件、不请求网关。

| 属性 | 约束 |
|---|---|
| mode | generate / reference / modify |
| character | nationality/name/role/gender/era/age/height/build/features；role 是人物身份，不是模型岗位；不带剧情服装、道具或旧面向 |
| scene | name/landmark/light/space/look，以最新场景卡为准 |
| generationRules | 从任务技能快照赋值，空正文不补默认规则；人物接口仅在正文含年龄条件分节时选择适用部分 |
| additionalInstructions | 场景模型接收接口选定的补充；不能由调用方自行拼入协议 |
| canvas | 正整数像素 width/height，由调用方确定；人物接口默认 768×1344，场景默认项目画幅 |
| images | 有序 `{ purpose, base64 }`；用途为 edit-base、character-reference 或 scene-reference，数据为 PNG/JPEG/WebP data URL |
| modification | instruction/preserveUnspecified；modify 必须有非空意见及第一张唯一 edit-base，无图不降级生成 |

人物资料沿用 `shared/character-facts.js` 的字段与 look 解析，国籍缺省为中国；参考图只说明身份用途。场景参考图不能恢复旧资料，意见用于机位、构图等画面调整，资料字段修改通过场景卡完成。正文不输出 Base64 或本地路径。

修改图片优先读取待确认候选，否则读取已确认图；本地字节转 Base64 后交给对应 Model 和图片生成层，结果仍走三个图片步骤并等待确认使用，不先调用文本模型改写资料。网关适配校验宽高为 8 的倍数，长边超过 2048 时等比缩小并对齐；同一归一化尺寸用于 prompt 和请求。文件大小限制由 `limitStillBytes` 处理，不写为模型绘图指令。

实际生成和预览复用接口：有剧集资料时使用对应卡片，缺少对象时明确显示模板占位。预览不能代替某次请求快照；修改后重启与提示词差异验证见第 8、12 节。

<a id="task-records"></a>

## 16. 执行记录与查看接口

Run 服务位于 `server/flow/runs/run-service.js`，由 index 创建唯一实例；`meiji.runs`、`meiji.edits`、`meiji.runJobs`、`meiji.runGoals` 是公开注入服务。`server/http/run-routes.js` 复用面板登录、会话项目绑定和同源请求头。

| 记录 | projects/<项目 ID>/history/ 下的路径 |
|---|---|
| 任务与步骤 | runs/<runId>.json，schemaVersion:1；步骤含 attempts、输入输出引用和冻结的 skill 版本 |
| 实际请求 | run-prompts/<id>.json，归属 runId + stepId，请求发出前保存 |
| 原始返回 | run-responses/<id>.json，HTTP 状态、耗时、完整脱敏正文/异常；视频只存最终轮询 |
| 内容快照 | run-artifacts/<id>.json，target、version、previousArtifactId、content、published；未通过校验的原文为未发布快照 |
| 项目事件 | events/<id>.json，即时保存、剧本编辑与恢复等 |
| 剧本版本 | script-revisions/<revision>.json，先落记录后提交；恢复不覆盖历史 |
| 剧本方案 | 任务产生的方案存 run-artifacts，人工提出的存 script-proposals/<proposalId>.json |

快照先写入，项目原子保存后发布；不承诺跨文件事务。每次生成/修订各留一版并指向上一版，步骤开始前的准备性保存不产生版本；图片变化不新增文字版本。任务列表只返回摘要，不携带正文、提示词或技能快照；读取严格校验项目、任务、步骤归属，不用当前资料重建。密钥、请求头与参考图 Base64 不存入快照。任务首个步骤执行时冻结规则，在途编辑仅影响之后启动的任务。删除剧集同时删除该集的任务、快照与人工方案；项目级任务保留。

以下接口统一加 `/plugins/meiji` 前缀并校验项目/会话，写请求在正文携带 projectId/sessionId：

| 接口 | 用途 |
|---|---|
| POST /runs | 提交 goal 预览草稿：步骤、缺少前置、删除清单、硬阻断；同集已有任务时返回并入预览 |
| POST /runs/:id/preview | 按授权的前置或并入的目标重新预览 |
| POST /runs/:id/confirm | 确认执行；有删除须 confirmDelete，删除范围变化时拒绝沿用旧预览 |
| POST /runs/:id/amend | 并入新目标或追加意见 |
| POST /runs/:id/resume | 按暂停原因允许的动作恢复：retry、resume、review、override（仅面板）、authorize、cancel-branch |
| POST /runs/:id/pause、/cancel | 协作式暂停；取消任务或指定分支，晚到的正文不再提交 |
| GET /runs、/runs/:id | 列表（剧集/状态/发起方/对象筛选，对象支持逗号分隔与末尾 `*`）与详情 |
| GET /runs/:id/steps/:stepId/{prompts,responses,artifacts} | 步骤的实际提示词、脱敏原始返回与内容快照 |
| GET /artifacts/:id | 按内容来源读取快照 |
| POST /turn | 即时保存；制作动作返回 400 `RUN_GOAL_REQUIRED` |

会话工具为 `run-plan`（提交目标并直接执行：缺少的前置自动纳入、连带删除自动确认、同集已有任务自动并入）、`run-amend`、`run-resume`、`run-cancel` 与查询、项目管理；会话不能人工放行，也不能确认图片或剧本方案。上下文查询包含剧本版本、方案、阻断、摘要新鲜度、三类库目录和当前任务（状态、暂停原因、可用动作）。会删除已有产物时无 confirmDelete 只返回清单，不启动任务。人工忽略自审只作用于当前有效版本，不能忽略格式错误。

<a id="model-migration-history"></a>

## 17. 剧本、原始返回与历史迁移记录

操作与任务保留发起 sessionId/callId，responses 严格校验项目/任务/步骤归属，删除剧集清理所属历史。离线 `scripts/export-session-log.js --session-log <公开JSONL或ZIP> --project <项目ID> --home <DSH_HOME> --out <文件>` 合并公开 Harness 会话导出与 meiji 历史，按时间排序、callId 关联；密钥和 Base64 脱敏，工具参数/结果截断 2000 字。不读取 Harness 内部会话存储。

运行时无 stale/dependencies；R1–R18 由 pipeline-cascade 在上游变更的同次保存里删除下游，保护执行中节点，空节点重复清空幂等。具体矩阵与验证见实施计划 3.7 和 state-cascade/state-locks/state-script/state-library 测试。


本节从原 model-refactor-execution 文档归档，只说明 2026-09-27 当时的实施记录，不作为当前结构、测试数量或部署状态的依据。

当时完成共享 Drama/Episode/Plot/Shot Model、意见版本保护、响应式 UI、素材引用显示及离线迁移。原记录报告 148 项测试通过，迁移 4 部剧、5 集、53 个镜头、33 张人物/场景卡、23 份文本分镜及 14 条视频记录；备份位置记录为仓库根目录下 `.dsh/backups/model-v2-2026-09-27T00-20-11-110Z/`。本次文档合并未重新核验该备份和历史数量。

原记录还包含 Harness 重启及浏览器人工检查，未调用付费生成接口，模型链路仅以注入响应验证。当前模型后来增加了道具、尾帧、结构化每秒指令和独立剧集文件等变更，应以第 9、10、13 节及源码为准。保留的长期要求是：迁移先备份并读回核对、不丢用户数据，运行时不兼容旧布局，意见草稿和页面输入不因异步响应丢失。

<a id="gateway-api"></a>

## 18. 网关 API 参考

以下保留原 gateway-api 文档的接口字段与示例。插件适配已对照 `server/gateway/model-gateway.js` 核查；远端网关源码不在本仓库，本次未重新验证部署地址、公开模型、容量、并发和上游限制。以下“当前”描述均指原接口文档记录，接入时以目标网关部署为准，不视为 meiji 的业务规范。运维命令在网关仓库执行。

### 18.1 接入信息

#### 18.1.1 地址

| 环境 | Base URL | Playground |
|---|---|---|
| 本地 | `http://127.0.0.1:18090` | `http://127.0.0.1:18090/playground` |
| 服务器 | `http://43.154.247.11` | `http://43.154.247.11/playground` |

示例统一使用：

```sh
export GATEWAY_URL=http://127.0.0.1:18090
export GATEWAY_API_KEY=sk-替换为实际密钥
```

#### 18.1.2 鉴权

除 `/health` 和 `/playground` 外，所有接口都需要网关 API Key。

OpenAI 接口使用 Bearer：

```http
Authorization: Bearer sk-...
```

Anthropic Messages 优先读取 `x-api-key`，未提供时也接受 Bearer：

```http
x-api-key: sk-...
```

密钥缺失、错误、禁用或已删除均返回 `401`。密钥不要放在 URL 或请求体中。

本地创建密钥：

```sh
go run ./cmd/gateway -config config/config-local.yaml token add local-client
```

密钥原文只在创建时输出一次。

#### 18.1.3 通用约定

- JSON 请求使用 `Content-Type: application/json`。
- 图片编辑以及视频首尾帧文件上传使用 `multipart/form-data`。
- 当前 HTTP 请求体上限为 **64 MiB**，超出返回 `413`。Base64 会增加请求体体积。
- 每个响应都会带 `X-Request-ID`；调用方提供该头时网关沿用，否则自动生成。
- 时间戳均为 Unix 秒。
- 对外模型名不会替换成内部模型名。
- 客户端断开会取消当前同步请求，但不会取消已经成功提交的视频任务。

### 18.2 接口总表

| 模块 | 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|---|
| 运维 | GET | `/health` | 无 | 网关进程存活检查 |
| 运维 | GET | `/playground` | 无 | 浏览器测试页面 |
| OpenAI | GET | `/v1/models` | Bearer | 查询公开模型名 |
| OpenAI | POST | `/v1/chat/completions` | Bearer | 文本对话，支持 JSON 和 SSE |
| Anthropic | POST | `/v1/messages` | `x-api-key` 或 Bearer | Anthropic Messages 兼容接口 |
| OpenAI | POST | `/v1/images/generations` | Bearer | 同步图片生成 |
| OpenAI | POST | `/v1/images/edits` | Bearer | multipart 多参考图编辑 |
| OpenAI | POST | `/v1/videos` | Bearer | 提交异步视频任务 |
| OpenAI | GET | `/v1/videos/{id}` | Bearer | 查询视频任务 |
| OpenAI | GET | `/v1/videos/{id}/content` | Bearer | 下载已完成视频 |

当前不提供文件管理、图片异步任务以及图片或视频取消接口。

### 18.3 模型与运维

#### 18.3.1 健康检查

```sh
curl -sS "$GATEWAY_URL/health"
```

成功响应：

```json
{"status":"ok"}
```

该接口只说明网关进程可以响应，不检查模型上游是否可用。

#### 18.3.2 模型列表

```sh
curl -sS "$GATEWAY_URL/v1/models" \
  -H "Authorization: Bearer $GATEWAY_API_KEY"
```

响应格式：

```json
{
  "object": "list",
  "data": [
    {"id":"elysium-chat","object":"model","owned_by":"gateway"},
    {"id":"elysium-image","object":"model","owned_by":"gateway"},
    {"id":"elysium-video","object":"model","owned_by":"gateway"}
  ]
}
```

模型列表来自运行配置，顺序稳定但部署可以增减模型。调用前应以实际响应为准。

| 当前公开模型 | 能力 | 对应接口 |
|---|---|---|
| `elysium-chat` | 文本、流式输出、函数工具调用 | Chat Completions、Messages |
| `elysium-image` | 文生图、多参考图编辑 | Images Generations、Images Edits |
| `elysium-video` | 文生视频、首尾帧、多模态参考 | Videos |

### 18.4 OpenAI Chat Completions

#### 18.4.1 请求

`POST /v1/chat/completions`

网关要求请求体是 JSON 对象，并且必须包含 `model` 和 `messages`。聊天参数会按 OpenAI Chat Completions 格式交给文本上游；当前明确使用的字段包括：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | string | 是 | 当前填写 `elysium-chat` |
| `messages` | array | 是 | OpenAI 消息数组 |
| `stream` | boolean | 否 | `true` 返回 SSE，默认非流式 |
| `max_tokens` | integer | 否 | 必须为正整数；超过剩余上下文时会被压到可用值 |
| `tools` | array | 否 | OpenAI function tools |
| `tool_choice` | string/object | 否 | 工具选择策略 |
| `temperature`、`top_p`、`top_k`、`stop` | 对应 JSON 类型 | 否 | 由当前文本上游处理 |
| `chat_template_kwargs` | object | 否 | llama.cpp 模板参数，例如 `enable_thinking` |

当前文本渠道上下文为 **65,536 token**，其中保留 **2,048 token** 给模板、推理和边界开销。网关会先套用真实聊天模板并分词；若不足 1,024 个输出 token 空间则返回 `400`。

非流式示例：

```sh
curl -sS "$GATEWAY_URL/v1/chat/completions" \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "model":"elysium-chat",
    "messages":[{"role":"user","content":"请用中文描述海边日落，100字以内。"}],
    "stream":false
  }'
```

响应保持 OpenAI Chat Completions 结构。网关会把响应中的模型名恢复为公开名，并移除 `timings` 和 `system_fingerprint` 等内部字段。

#### 18.4.2 流式响应

```sh
curl -N -sS "$GATEWAY_URL/v1/chat/completions" \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "model":"elysium-chat",
    "messages":[{"role":"user","content":"分三点说明为什么天空是蓝色的。"}],
    "stream":true
  }'
```

按 SSE 的 `data:` 事件解析，并以 `data: [DONE]` 作为结束标志。工具调用参数可能跨多个增量事件，必须按 `choices[].delta.tool_calls` 的索引组装，不能按 TCP 数据包切 JSON。

若客户端没有提供 `stream_options`，网关会在发往上游时加入 `include_usage: true` 以记录用量，并对客户端隐藏由此产生的纯用量事件。

#### 18.4.3 并发与后台工作负载

当前聊天并发槽为 2。普通请求最多排队 2 分钟；需要低优先级排队时添加：

```http
X-Elysium-Workload: background
```

后台请求最多排队 30 秒。排队超时返回 `429`、`Retry-After: 5`，并在 `Server-Timing` 中返回排队耗时。当前聊天总时限为 15 分钟。

### 18.5 Anthropic Messages

#### 18.5.1 请求

`POST /v1/messages`

最低请求字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | string | 是 | 当前填写 `elysium-chat` |
| `max_tokens` | positive integer | 是 | 最大输出 token |
| `messages` | non-empty array | 是 | 只接受 `user`、`assistant` 角色 |
| `system` | string/text blocks | 否 | 转为系统消息 |
| `stream` | boolean | 否 | `true` 返回 Anthropic SSE |
| `tools` | array | 否 | 自定义工具；需要 `name` 和对象型 `input_schema` |
| `tool_choice` | object | 否 | 支持 `auto`、`none`、`any`、`tool` |
| `temperature`、`top_p`、`top_k` | number | 否 | 转发到文本执行层 |
| `stop_sequences` | string array | 否 | 转换为 OpenAI `stop` |
| `metadata` | object | 否 | 校验类型，不交给文本上游 |
| `thinking` | object | 否 | `adaptive`/`enabled` 开启，`disabled` 关闭 |
| `output_config` | object | 否 | `effort` 支持 `low`、`medium`、`high`；`high` 映射为当前最高实际档 `medium` |
| `context_management` | object | 否 | 仅接受 `clear_thinking_20251015` 且 `keep: all` |

支持的消息内容：

- `content` 可以是字符串或非空内容块数组。
- `user` 支持 `text` 和 `tool_result`。
- `assistant` 支持 `text` 和 `tool_use`。
- `system` 与 `tool_result.content` 支持字符串或纯 `text` 内容块。
- 不支持图片、文档、thinking 内容块、Anthropic 托管工具和提示缓存字段；不支持的字段或内容块返回 `400`。

示例：

```sh
curl -sS "$GATEWAY_URL/v1/messages" \
  -H "x-api-key: $GATEWAY_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "model":"elysium-chat",
    "max_tokens":512,
    "messages":[{"role":"user","content":"请用中文描述海边日落，100字以内。"}],
    "stream":false
  }'
```

非流式响应为 Anthropic Message 对象，`content` 包含 `text` 或 `tool_use` 块，结束原因映射为 `end_turn`、`max_tokens`、`stop_sequence` 或 `tool_use`，并返回 Anthropic 格式的输入/输出 token 用量。

#### 18.5.2 流式响应

`stream: true` 时返回 `text/event-stream`，事件顺序使用 Anthropic Messages 语义：

1. `message_start`
2. 一个或多个 `content_block_start`
3. `content_block_delta`
4. `content_block_stop`
5. `message_delta`
6. `message_stop`

文本增量使用 `text_delta`；工具参数使用 `input_json_delta`。调用方必须按 `index` 合并内容块。

#### 18.5.3 Messages 错误格式

Messages 使用 Anthropic 风格错误：

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "..."
  }
}
```

鉴权失败的 `error.type` 为 `authentication_error`；限流为 `rate_limit_error`；上游或网关错误为 `api_error`。

### 18.6 图片

#### 18.6.1 图片生成

`POST /v1/images/generations`

| 字段 | 类型 | 必填 | 默认与限制 |
|---|---|---|---|
| `model` | string | 是 | `elysium-image` |
| `prompt` | string | 是 | 非空；支持中文 |
| `n` | integer | 否 | 大于 1 时拒绝；响应始终只有 1 张 |
| `size` | string | 否 | `宽x高`；默认或 `auto` 为 `832x1216` |
| `seed` | uint32 | 否 | 默认 `666` |

尺寸规则：

- 宽高必须是正数且均为 8 的倍数。
- 长边不超过 2048 时保持原值。
- 任一边超过 2048 时按比例缩小，使长边为 2048，并向下对齐到 8。
- 工作流内部向上对齐到 32 后居中裁剪，因此最终图片保持规范化后的请求尺寸。
- Playground 提供 `832x1216`、`1024x1024`、`1216x832` 三个选项。

图片工作流固定使用 25 步。

```sh
curl -sS "$GATEWAY_URL/v1/images/generations" \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "model":"elysium-image",
    "prompt":"雨后的上海街道，电影感摄影",
    "n":1,
    "size":"1024x1024",
    "seed":42
  }'
```

成功响应：

```json
{
  "created": 1790650000,
  "data": [{"url":"http://127.0.0.1:18090/v1/media/media_..."}]
}
```

插件读取 `data[0].url`，下载图片并转为 Base64，再解码交给现有本地保存流程。同源媒体下载使用生成时的 Bearer 密钥并禁止重定向；外部 HTTP(S) 地址不携带网关密钥。下载支持停止与超时，失败不重新提交生成。仍支持已有 `b64_json` 响应。

#### 18.6.2 图片编辑

`POST /v1/images/edits` 只接受 `multipart/form-data`。

| 表单字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | text | 是 | `elysium-image` |
| `prompt` | text | 是 | 编辑指令 |
| `size` | text | 否 | 规则与图片生成一致 |
| `image` / `image[]` | file | 是 | PNG/JPEG/WebP 图片文件；合计 1–10 张 |

Model 内部使用 Base64 data URL 传递参考图，网关适配层解码为图片文件后按顺序上传，不将 Base64 作为 multipart 文本字段提交。实际网关 playground 使用 file 输入；文本 image[] 会被拒绝。角色职责写在 prompt 正文中，不传 role 表单字段。

```sh
curl -sS "$GATEWAY_URL/v1/images/edits" \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -F model=elysium-image \
  -F 'prompt=保持主体与构图不变，将场景改为黄昏' \
  -F size=832x1216 \
  -F 'image[]=@reference-1.png' \
  -F 'image[]=@reference-2.jpg'
```

响应格式与图片生成相同。图片接口都是同步接口；网关没有公开图片任务查询或取消接口。

### 18.7 视频

#### 18.7.1 提交任务

`POST /v1/videos` 返回异步任务对象，HTTP 状态为 `200`。

JSON 请求字段：

| 字段 | 类型 | 必填 | 默认与限制 |
|---|---|---|---|
| `model` | string | 是 | `elysium-video` |
| `prompt` | string | 是 | 非空 |
| `seconds` | number/string | 否 | 默认 5，范围 1–15 |
| `size` | string | 否 | 默认 `576x768` |
| `seed` | uint64 | 否 | 省略时随机 |
| `input_reference` | string | 否 | 首帧图片，可为 Base64 data URL 或裸 Base64 |
| `last_frame` | string | 否 | 尾帧图片，可为 Base64 data URL 或裸 Base64 |
| `reference_images` | string array | 否 | 参考图片 data URL，最多 9 个 |
| `reference_videos` | string array | 否 | MP4 data URL，最多 3 个 |
| `reference_audios` | string array | 否 | WAV/MP3 data URL，最多 3 个 |

视频 JSON 使用严格字段校验，未知字段返回 `400`。

尺寸规则：

- 宽高必须为正数。
- 请求尺寸分别向上对齐到 32。
- 对齐后任一边不能超过 2048，总像素不能超过 `864 × 1184`。
- Playground 提供 `576x768`、`768x768`、`768x576` 三个选项。

视频固定使用 24 fps 和 8 步。帧数会调整为工作流要求的 `17k+5`，因此实际时长可能与请求秒数有轻微差异。

#### 18.7.2 素材规则

| 素材 | 支持格式 | 数量/时长 |
|---|---|---|
| 首帧、尾帧 | PNG、JPEG、WebP | 各最多 1 张 |
| `reference_images` | PNG、JPEG、WebP | 最多 9 张 |
| `reference_videos` | MP4 | 最多 3 个；每个 2–15 秒 |
| `reference_audios` | WAV、MP3 | 最多 3 个；每个 2–15 秒 |

组合限制：

- 首帧/尾帧模式不能与 `reference_images`、`reference_videos`、`reference_audios` 混用。
- 三类参考素材合计最多 12 个。
- 所有参考视频的时长合计最多 15 秒；所有参考音频的时长合计最多 15 秒。
- 每个参考视频不能长于本次生成视频的实际帧时长。
- HTTP(S) 素材 URL 不受支持，必须发送 Base64 data URL；首尾帧还允许裸 Base64。
- 网关会完整解码校验素材；视频会规范化为 24 fps，格式声明与实际内容不一致时返回 `400`。
- 单次请求全部原始素材及全部处理后素材各自受 256 MiB 内部预算约束，但外层 HTTP 请求仍先受 64 MiB 请求体限制。

#### 18.7.3 multipart 首尾帧

`POST /v1/videos` 也接受 multipart，但仅用于首尾帧文件上传：

| 表单字段 | 类型 | 说明 |
|---|---|---|
| `model`、`prompt`、`seconds`、`size` | text | 唯一允许的文本字段 |
| `input_reference` | image file | 可选，最多一个 |
| `last_frame` | image file | 可选，最多一个 |

文件必须是 PNG、JPEG 或 WebP。multipart 不支持 `seed` 和多模态参考数组；需要这些能力时使用 JSON。

```sh
curl -sS "$GATEWAY_URL/v1/videos" \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -F model=elysium-video \
  -F 'prompt=Subtle natural motion and a slow camera push-in.' \
  -F seconds=5 \
  -F size=576x768 \
  -F 'input_reference=@first.png' \
  -F 'last_frame=@last.png'
```

#### 18.7.4 JSON 示例

文生视频：

```sh
curl -sS "$GATEWAY_URL/v1/videos" \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "model":"elysium-video",
    "prompt":"Ocean waves rolling onto a beach at sunset, slow camera push-in.",
    "seconds":5,
    "size":"768x576",
    "seed":42
  }'
```

多参考素材使用 data URL：

```json
{
  "model": "elysium-video",
  "prompt": "Follow the visual identity and motion rhythm of the references.",
  "seconds": 5,
  "size": "576x768",
  "reference_images": ["data:image/png;base64,..."],
  "reference_videos": ["data:video/mp4;base64,..."],
  "reference_audios": ["data:audio/mpeg;base64,..."]
}
```

#### 18.7.5 任务对象

提交和查询都返回同一种对象：

```json
{
  "id": "video_...",
  "object": "video",
  "model": "elysium-video",
  "status": "queued",
  "created_at": 1790650000,
  "size": "576x768",
  "seconds": "5"
}
```

`seconds` 是字符串。失败对象额外包含：

```json
{"error":{"message":"..."}}
```

可能状态：

| 状态 | 含义 | 调用方行为 |
|---|---|---|
| `queued` | 已记录或等待上游处理 | 继续轮询 |
| `in_progress` | 上游处理中 | 继续轮询 |
| `completed` | 已完成 | 下载内容 |
| `failed` | 失败 | 停止轮询，读取 `error.message` |
| `cancelled` | 已取消的历史或上游状态 | 停止轮询；当前没有公开取消接口 |

### 18.8 视频查询与下载

#### 18.8.1 查询

```sh
curl -sS "$GATEWAY_URL/v1/videos/$TASK_ID" \
  -H "Authorization: Bearer $GATEWAY_API_KEY"
```

任务只对创建它的 API Key 可见。任务不存在或属于其他密钥都返回 `404 video not found`。建议每 3–5 秒查询一次。

#### 18.8.2 下载

```sh
curl -sS "$GATEWAY_URL/v1/videos/$TASK_ID/content" \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -o output.mp4
```

任务未完成时返回 `409 video is not ready`。完成后网关流式转发媒体，并透传以下响应头：

- `Content-Type`
- `Content-Length`
- `Content-Range`
- `Accept-Ranges`

`Range` 请求头会原样转发。上游可能返回 `206 Partial Content`，非法范围可能返回 `416`，不使用范围时通常返回 `200`。

完整轮询示例：

```sh
TASK_ID=$(
  curl -sS "$GATEWAY_URL/v1/videos" \
    -H "Authorization: Bearer $GATEWAY_API_KEY" \
    -H 'Content-Type: application/json' \
    --data-raw '{"model":"elysium-video","prompt":"Clouds moving over mountains","seconds":5,"size":"768x576"}' \
  | jq -r .id
)

while :; do
  TASK=$(curl -sS "$GATEWAY_URL/v1/videos/$TASK_ID" \
    -H "Authorization: Bearer $GATEWAY_API_KEY")
  STATUS=$(jq -r .status <<<"$TASK")
  case "$STATUS" in
    completed) break ;;
    failed|cancelled) jq . <<<"$TASK"; exit 1 ;;
  esac
  sleep 3
done

curl -sS "$GATEWAY_URL/v1/videos/$TASK_ID/content" \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -o output.mp4
```

视频提交超时且没有收到任务 ID 时，远端是否接收可能无法确定，不要立即盲目重提；先结合请求日志和业务幂等策略判断。拿到任务 ID 后，查询和下载可以安全重试。

### 18.9 错误与重试

#### 18.9.1 OpenAI 风格错误

除 Messages 外，JSON 错误格式为：

```json
{
  "error": {
    "message": "...",
    "type": "invalid_request_error"
  }
}
```

`4xx` 的 `type` 为 `invalid_request_error`；网关或上游 `5xx` 错误为 `upstream_error`。上游内部错误详情不会直接暴露给调用方。

#### 18.9.2 常见状态码

| 状态码 | 含义 | 是否重试 |
|---|---|---|
| `400` | JSON、字段、尺寸、素材或组合不符合约定 | 修正请求后再试 |
| `401` | API Key 无效 | 更换密钥，不自动重试 |
| `404` | 模型不存在，或视频任务不存在/不属于当前密钥 | 检查模型名、任务 ID 和密钥 |
| `409` | 视频尚未完成 | 继续轮询后再下载 |
| `413` | HTTP 请求体或媒体预算超限 | 缩小请求，不原样重试 |
| `429` | 聊天排队超时或上游限流 | 遵循 `Retry-After` 并退避 |
| `502` | 上游不可用、响应非法或网关无法完成上游操作 | 指数退避；视频提交先确认是否已有任务 ID |

#### 18.9.3 重试原则

- `GET /v1/models`、视频查询和视频下载可以安全重试。
- Chat 和 Messages 在尚未收到有效响应时可按业务需要重试，但工具调用场景应由调用方保证幂等。
- 图片生成和图片编辑是同步生成请求，自动重试可能重复计算。
- 视频创建是非幂等提交；没有任务 ID 时不要无条件自动重试。
- `400`、`401`、`404`、`413` 必须先修正请求或调用上下文。

### 会话步骤目标

会话制作先明确目标和完成标准，再使用 Harness get_goal/create_goal 与 todo_write（一步也一项）。具体执行范围以本次授权为准，不因依赖隐式扩展目标。stepCompleted 表示执行完成，reviewPassed 表示审核结论：只审核得到不通过结论也完成该目标；生成完成仅允许进入已授权的审核，不能当作下游制作已解锁。修订到通过须明确授权并最多两轮；全部完成后 update_goal complete，缺失条件或失败则 blocked。剧本方案/回写事务与媒体流程继续保留现有内部流程，不属于可拆分文本制作目标。

### 成片编译的角色引入顺序
每秒指令由 AI 返回 participants：每项 name、presence（visible/voice）、单段 outfit 及 costumeId（有服装目录的出镜角色必选本角色一套，声音/无目录为空）；新响应必须包含，空镜为空数组，独立旁白不列入。程序直接消费 visible 人物清单，再绑定这些实体的人物资料、Picture 和 Subject。旧 ID 指令按确定性标记兼容；新版自然称谓指令在生成提示词入口必须有 participants，缺失时要求补齐上游清单。历史提示词读取与校验仍兼容已保存的旧版本。摘要、声音与台词原文不新增视觉主体。画内说话人在对应时段使用视觉 Subject，角色原称谓与库名称统一发声身份；画外及内心声使用发声编号，不凭声音引入图片。原始每秒指令与台词保持不变。

### 角色声音资料与编译依赖
- 人物 `voiceDescription` 保存稳定音色、音高、口音、吐字与惯常语速；不进入 characterFactText/LookText 或生图请求。当句声音表演仍由 dialogues.performance 指定。
- 成片人物范围按每秒 participants 汇总；任一镜出镜则本集卡 presence=visible，全程仅声音为 voice。presence 属于本集，不写入项目库的全局出镜属性。voice 卡仅要求身份、声音，不强制外貌，也不进入 library-images.imageItems 的生图/缺图清单。仅声音库资料可编辑声线，不显示图片生成入口。
- 新人物生成响应要求声音字段；旧已保存卡缺失字段允许读取与复用。项目已有角色直接引用库声线（缺失允许沿用旧资料）；新增声线通过角色资料编辑维护。底层mergeLibraryGroup仍兼容旧完整资料发布时的一次性补齐。
- compileVideoPrompt 编译版本 2 保存 characterSnapshot（身份、称谓、外貌、声音）及 referenceSnapshot；新鲜度和视频提交同时核对这些依赖。声线与独立 S 编号在声音段对应，Subject/Picture 仅用于可见角色。声音编辑同步关联集并清理相关成片，保留指令和图片。历史编译版本1无新增声线仍兼容；引入声音资料后需要重新编排。

### 纯提示词任务与共享命名
- `film/parts=storyboard` 在规划和运行时检查中都不插入角色生成、角色自审或生图。`parts=video/tail` 同样不自动准备人物；未指定 parts 的完整成片同样直接匹配已有角色，不插入人物资料模型或生图。
- `shared/storyboard-characters.js:resolveStoryboardProject` 直接读取本镜 participants；当前卡及明确库关联优先，随后按库名称/别名匹配。只在编译副本绑定资料，原卡、库与每秒指令不写回；缺资料、失效关联、重名或同身份重复称谓给出具体镜号/人物。可见人物无图但有外貌可编译文字模式，仅声音人物不要求图片。
- `generateShotStoryboard` 顺序为匹配参与角色与既有资料 → 编排分镜提示词 → 校验分镜提示词；不读取模型路由、不创建模型请求记录。清单/资料预检失败保留旧提示词。预览、生成、新鲜度与提交通过同一编译解析规则核对依赖。
- `shared/run-names.js` 集中维护目标、模式、范围、步骤及内部动作名称；client 与 Harness 观察入口共同复用。纯提示词称“编排/重新编排分镜提示词”，程序结论称“校验通过/未通过”；详情区分“查看编排结果与绑定”及“查看模型输入”，不伪造模型或 HTTP 记录。
- 视频参考素材清单中的 localPath 表示读取来源；实际 HTTP `reference_images` 为按 Picture 顺序转换的 Base64 data URL，真实请求记录继续脱敏。传输测试经 submitVideo→submitFilm→submitGatewayVideo，在 fetch 替身处核对 MIME、顺序和解码字节，不能代替真实服务联调。

### 完整成片的直接角色复用与动态状态
- planRun 和运行时 checkStep 都不再自动安排人物生成/自审/角色图展开；显式人物与图片目标沿用原功能。人物图片不是成片的强制前置，有已知外貌时可用文字模式；旧场景/道具的显式图片前置保持原约定。
- 固定身份/外貌/声线属于角色资料，本镜服装穿脱、情绪和当下表演属于每秒分镜：action/space/endState 描述服装过程与状态，dialogues.performance 描述当句语气及嘴部。生成、修改及审核均遵循，不能凭空补服装变化或改写固定声线。
- 成片每个媒体步骤直接继承本镜基础依赖（含前镜尾帧），即使其编排步骤已跳过也不能越过前镜。视频 beforeStep 使用 storyboardReady 重新核对；失效时只插入本镜程序编排，完成后提交，不插入角色/图片模型。

### 人物删除与项目角色删除
- 本集卡及详情使用 character-delete 即时操作，仅面板可发起，持有项目锁并用项目视图原子保存。deleteEpisodeProjectCharacter先按ref/libraryId或名字/别名匹配项目角色，同步删除库及全部关联卡；无匹配只删当前卡。deleteEpisodeCharacter保留为全项目级联内部的本集删除规则，避免递归，组revision/check.revision同步。
- 角色库 entry-delete 可删除已关联人物；deleteProjectCharacter 删除库条目及全部关联集卡，并清理纯库编译的媒体依赖。场景/道具库仍保留原关联删除保护，角色若仍是库道具归属则拒绝删除。
- operationDeletes 调用同一共享 helper 的 preview 模式；确认列出项目级条目和每集受影响内容。当前 sourceName 对应参与清单别名时按它计算人物删除级联。v2 每秒正文和 participants 不改写，既有旧ID指令沿用级联规则。
- 按钮忙状态禁用、防重复点击，取消及失败恢复可用并显示错误；详情成功删除后返回列表。操作写入即时历史，不生成制作任务、模型请求或图片请求；共享媒体素材文件保留。

### 每秒参与人物着装字段
- 输出结构保持 version=2；participants 每项 `{name,presence,outfit}`。新 v2 生成/修订响应 visible outfit 为非空字符串，voice 固定空字符串；validateSeconds 历史读取允许缺字段，有字段则校验类型及presence用途。缺字段失败草稿可以保存但不能通过程序校验。旧v1响应维持现有兼容。
- outfit 是本镜动态着装段，变装时同段按顺序概括状态；动作过程、时点及末态继续写 action/endState。仅声音不推断着装，原称谓和台词保留，不把outfit写回角色卡或库；filmParticipants跨镜汇总只保留name/presence。
- secondsText 用于列表和单镜详情，逐个visible人物显示着装，旧字段缺失显示未记录。secondsHandoff 仅在有着装时附 outfits，保留旧交接对象形状；下一镜只承接末态。
- compileVideoPrompt 直接编排outfit，并在角色文字外貌有本镜着装时剔除固定服装/声音标签，不改变原卡；有服装目录的角色按costumeId绑定已确认穿搭图，同时确定固定身份和衣服外观；穿脱/破损状态服从本镜动作。无效ID或缺图阻止编排，旧指令不删除但须补齐选择，视频不临时生成人物图。编排保存outfitSnapshot，storyboardReady及filmSubmit核对；缺旧snapshot但当前outfit非空时必须重编，旧无outfit数据继续兼容。

### 人物提取的项目优先复用
- parseCharacters、checkCharacters将项目资料传入normalizeCharacters，已有角色在新字段校验前直接水合库引用，保留sourceName剧情称谓，忽略模型重写固定资料；新角色校验不变。
- 生成、修订及审核的库关联规则和协议区分已有简短引用/新完整资料；已有角色不按本集穿衣或声线表现重新设计。
- 人物图片展开使用generate，ready库图跳过、无图生成；显式图片regenerate和人工候选确认保持原行为。
- 提取开始的项目角色库 IDs 保存于人物节点 extractionLibraryIds，审核、修订和恢复以该目录区分本轮已有/新增；本轮新人物发布入库后仍须完整审核。旧节点无快照时按当前有效名称/库关联复用，不自动改写历史数据。
- 已有卡片保存完整固定资料及图片，待审与修订基稿通过 characterExtractionContent 投影为 name/presence/libraryId；审核目录与只读身份资料分开，不把程序读取的外貌声线判成模型重写。新增保留完整资料。提取边界核对 ID 与名称/登记别名，不接受任意称呼指向其他身份，失败引用原文仍可用于程序修复。

### 每秒人物范围限定本集角色卡
- secondsCharacterRoster只读本集plot.characters.items，输出name（sourceName优先）及aliases（卡名/sourceName/该卡明确库关联的登记别名），不包含固定外貌、身份、声音或ID，不从未关联库条目扩充。生成/修改/审核共用buildSecondsPrompts的本集人物清单，空目录也明确传[]。
- 新v2响应由requireParticipants核对人物属于唯一一张本集卡，同卡多称谓不得重复；有效卡外称谓在新v2解析前由normalizeSecondsParticipants排除；歧义、重复及卡内非法字段给出镜号和称谓，parseSecondsPartial保留草稿及失败理由，checkSeconds复用相同规则。卡外剧情人物允许保留上游动作和对白，不进入participants、不改NARRATOR、不自动建卡；卡内说话人仍必须列入清单。
- validateSeconds读取/编译历史数据不强加新白名单，v1兼容不变；参与者的visible/voice及单段outfit规则保持，独立旁白NARRATOR仍不建卡。角色删除后重新生成/修改指令时遵守当前本集清单。

### 卡外剧情对白与参与清单
- participants只覆盖本集卡内参与者，卡外剧情人物仍可按上游行动/出镜/发声。validateSeconds对白一致性校验只要求卡内人物列入清单；卡外对白保持实际speakerName及delivery，不伪装独立旁白。卡内画内对白必须visible，报错带人物和字段；明确登记别名允许对应同一卡。
- compileVideoPrompt允许无卡画内说话人以自然名称进入台词/声音段，不自动引入角色资料、Subject/Picture或未关联库图片。卡内说话人的别名通过同一roster绑定固定声线及S编号，原对白数据不写回。
- reviewStep合并模型/程序结果后按完整formatReviewIssue去重，不合并location/reason/requirement不同的问题；持久化、issues与reviewText一致。

### 参与清单的程序过滤
- normalizeSecondsParticipants对新v2响应只过滤有效卡外称谓，正文/对白/时间不改；非法条目保留校验，卡内缺着装/voice画内/同卡重复/歧义保持失败。v1及历史直接读取不自动迁移。
- parseSecondsResponse/Partial统一清理后返回；generateShotSeconds的review包装及reviewSeconds给模型清理后的待审稿，避免原始返回仍触发卡外清单语义失败。seconds-response保留原始返回不改。
- runContentReview针对seconds的已有存稿，仅当参与清单需清理时setContent更新revision，再保存审核结论；清理旧清单对应下游，其他正文不改。模型真实审核结论仍独立于程序清理。

### 角色提取一体化图片流程
- 全剧 project-characters 经审核发布后，运行时按本轮提取的可见角色展开库图片；不遍历未提取角色、不生成 voice 图片。剧集 characters 只补本集角色图片，两入口范围独立。
- 图片未全部保存时任务不完成；失败分支可重试，成功角色图片继续复用。applyLibraryImageDraft 是库图片人工确认与自动入库共用事务，校验快照及取消信号、同步关联集，失败清理新素材。


### 对白心声与默认着装

- 每秒指令复用 `dialogues.delivery` 区分 on（画内对白）、off（画外对白/独立旁白）、inner（心声）；`text` 仅保存观众应听到的原话，动作、心理叙述和语气放 action/performance，不把心理描述自动增写为独白，也不更改上游明确对白。视频编译对普通对白使用正常音调，心声在同一基础声线上降调并加轻微短混响，明确不动嘴、其他人物听不到，切回对白恢复正常音调。
- 新每秒指令按本镜明确剧情 → 最近已通过指令的可见穿着 → 首次默认服装选择。改变 currentCostumeId 时 `costumeEvidence` 必须逐字引用本镜原文；程序校验ID归属、引用和无依据变化，语义审核判断引用是否确实说明该人物服装。地点、职业、情绪和服装context不授权换装；明确换装后沿用新状态。
- 默认ID和服装集合修改不自动删除既有指令、分镜或成片；历史已保存内容不追加新响应的换装依据校验。迁移备份索引与剧集、读回核对并失败还原。
