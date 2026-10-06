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

依赖由 `tests/architecture.test.js` 检查：`http/tools → flow/operations → 文本执行/网关/提示词 → runtime → data → models/skills → shared`。存储和执行共用的叶子模块为 `runtime/task-context.js`、`task-state.js`、`operation-context.js`，只能依赖彼此或 shared，不能反向引用存储/执行器。`flow/steps/` 按业务动作集中具体步骤，`flow/tasks/` 组合步骤，runtime 不反向引用步骤层；media 仅依赖 Node 与 shared。服务端各层可引用这些叶子、`host`、`shared`；`host` 只向下依赖 `shared`，服务端、工具和脚本不得引用 `client`。

| 位置 | 职责 |
|---|---|
| `index.js` | 组合入口：接入 Harness、处理遗留任务、检查 FFmpeg、创建操作管理器、注册面板及公开 meiji 服务；会话工具不在主机全局注册 |
| `session.js` | 短剧制作预设的子插件，等待主机 ready 后注册 12 个 operation- 业务工具与会话说明，释放时撤销登记 |
| `server/host/harness-jobs.js` | 通过公开 jobs 登记操作观察与占用、图片、剧本等待，模型停止守卫与 owner 脱离 |
| `server/data/script-store.js` | 剧本版本、待确认方案与原子提交 |
| `shared/library-rules.js` | 三类库、变体、关联及跨集同步；库目录只含文字和有图标记 |
| `client/` | 原生 ES 模块面板，通过 `panel-api.js` 访问同源接口 |
| `shared/` | 可用于前后端的纯领域规则：模型、剧集构造与视图、语言、素材保留、节点补充、分镜编辑、门禁、步骤状态及下游删除；不读写文件 |
| `server/http/`、`tools/` | 面板与会话入口，复用服务端流程；鉴权与同源检查在 HTTP 层 |
| `server/flow/operations/` | 操作层：manager 统一发起、占用与停止；runner 展开任务并记录；registry 登记操作，generate/ 只声明任务顺序，direct/ 实现人工操作 |
| `server/flow/tasks/` | 任务层：task-registry 登记职责、队列、节点与修订上限；text/、media/ 组合具体业务步骤并保存目标结果；task-queue 限流，task-interrupt 处理重启取消 |
| `server/flow/shared/` | 任务执行器及任务共用的数据协调；图片、视频等具体步骤与公共执行机制归 steps/，不导出旧操作入口 |
| `server/gateway/` | 文本/图片/视频网关适配、文本请求入口、视频轮询、请求快照和日志 |
| `server/media/` | 图片解码/文件处理/压缩，FFmpeg 检查、尾帧提取与视频拼接；不依赖操作、提示词或任务执行 |
| `server/prompts/` | Model 编排提示词，interfaces 赋值，`prompt-request.js` 统一请求结构，preview 复用实际入口 |
| `server/flow/steps/` | 每个业务步骤一个 step 文件（生成大纲、提取人物/场景/道具、审核大纲、修订大纲、生成镜头表、生成图片、提交视频、生成视频、提取尾帧等）；公共机制放 shared/；步骤只执行自身，不安排后续，重新生成复用生成、复审复用审核 |
| `server/runtime/` | 任务/步骤通用生命周期、上下文、状态与记录基础设施；task-context 管内存，task-state 管无 IO 的规则，task-execution 管执行生命周期 |
| `server/data/` | 文件与记录持久化、内容快照、剧集存储视图及封面；`projectStore` 管项目保存，`project-files.js` 独占存储布局；不放执行器或纯数据规则 |
| `server/host/` | Harness 公开接口适配、工作区与会话查询、日志及归属明确的历史提示词读取 |
| `models/`、`config/`、`skills/` | 模型路由与默认配置、生产规则、审核规则及会话说明 |

生成主链：`面板/会话 → operation-manager.start → operation-runner 展开任务 → 各任务进入对应队列 → task-executor → 网关/媒体 → 保存结果`。直接操作也走 start，立即执行并等待结果。操作按实际写入范围持有项目或剧集占用直到全部任务结束；不能在页面或工具中另建执行通路。

## 2. 提示词 Model

- 按独立生成目标设计 Model，同类步骤复用 Model 与配置；Model 只编排输入和提示词，不调用 API、不保存项目。
- 资料使用 `{ task, review, facts }` 等结构化对象传入。生成、修订和审核分别编排；修订携带基稿与意见，审核只检查待审结果，不执行生成指令。
- 角色、任务、事实、参数、规则、意见和输出协议各有明确位置，避免重复。空上下文省略；输出语言由代码确定，不让模型选择默认值。
- 单段资料（本集摘要、项目摘要、剧本）在具名标题下直接放正文；已有结构化资料直接序列化为 JSON，不重复套包装字段。任务中说明各资料的用途；基稿和待审内容保留实际数据结构，列表用具名集合。
- system 放角色、基础及补充规则、输出协议；user 按本次任务 → 本次要求 → 具名资料 → 基稿及意见/待审内容排列。本次要求集中写代码已确定的输出语言、适用时长、风格与画幅，不输出默认值选择说明。
- 大模型文本生成、修订和审核统一返回 JSON 对象并启用 `json_object` 模式。解析字段后再保存与展示正文，字符串转义还原成真实换行；不能直接展示响应对象外壳。图片和视频接口沿用各自媒体协议。
- 文本请求由 `prompt-request.js` 分开组装 system 规则与 user 资料；图片接口接收完整 prompt，参考图 Base64 另传，不写入正文。
- 预览与提交复用同一组装入口；历史展示实际请求快照，不用当前资料重建。
- 大纲审核的 system 只放角色、审核原则、节点审核标准及补充、返回协议；资料用途及修订对照范围放 user。程序检查 JSON 结构，模型检查有证据的剧情问题，不审核展示标题或强求无依据的弱点、微动作。

参考：`server/prompts/models/`、`server/prompts/interfaces/`、`server/prompts/prompt-request.js`。

## 3. 操作、任务与节点

- 操作表示一次用户发起，任务表示独立职责，节点记录任务内部的生成、自审、修订等工作。内容节点是项目资料，和执行节点分开。
- 操作开始就建立全部任务记录；逐个任务独立进入 text/image/video 队列。直接操作不排队，但同样遵守占用与留痕。
- 状态统一由 `shared/task-nodes.js` 自下而上推导。任一任务失败、审核未通过或停止，取消后续任务，已完成结果保留。
- 面板文本任务使用 `flow/tasks/text-workflow.js` 的 `runTextNodes`：生成 → 自审；失败时动态追加修订 → 复审，默认最多 2 轮。会话文本制作按 mode 只执行 generate/regenerate（生成）、modify（修订）或 review（审核），每次一个节点；story 必填 only，seconds 必填 track。生成及修订保存正文但 check.passed=null，独立审核不改写正文或删除下游；通过审核的卡片可发布库关联。程序与媒体任务上限为 0。
- 操作 ID 由 manager 生成，任务 ID 由 runner 生成。每个任务独立上下文、提示词和产物，不用 scope 伪装多个任务。
- 图片为生成、下载转 Base64、保存候选；视频为提交、生成保存、提取尾帧。后台工作完成后才释放任务队列名额。

- 同项目生成互斥（含排队），不同项目独立。项目锁与项目内任意操作互斥；剧集直接操作仅与同集或项目锁冲突。summary/story 固定项目锁，关联卡片操作在占用前从已提交存储确认关联后选择项目锁，不升级在途锁。
- 面板剧集摘要发生变化后，父操作先保存并释放，再自动启动一次独立 script-sync；会话步骤不会自动回写，需在目标授权范围内显式调用 operation-sync-script；失败、取消或遇忙保留回写依据。待回写、待确认方案、待回写删除记录阻断剧情层，镜头、指令、图片和成片仍按自身门禁执行。
- 会话和面板生成登记 Harness job，job 只观察业务操作。面板 job 通知标明单次操作，终态结果携带 initiator=panel、nextAction=end；模型读取结果并简短汇报后结束，不规划、重试或发起后续步骤。会话仅继续用户明确授权的步骤。面板生成通过公开 Harness goals 服务创建单次操作目标，执行期间 disarm，成功 complete、失败或取消 blocked，然后 job 才通知会话。operation.goalRef 持久化关联；已有其他目标或被用户修改的目标不覆盖，自有已结束目标可在下次点击时结算或清理。普通 job_kill 经 manager.cancel 停止；模型不能停止面板发起的 job。owner/service 销毁只脱离观察，不取消业务。图片与剧本处理后由事件解除等待，不空转轮询。

接口与存储见第 16 节。

## 4. 重新生成与按意见修改

- **重新生成**使用当前指定的上游资料，不带目标旧稿及历史意见。`outline/regenerate` 在请求前清空本集 plot、shots、assembly、pendingImages，即旧大纲、人物/场景/道具及图片关联、候选图、镜头和合成；失败或取消也不恢复旧数据，只保留本轮已保存结果。
- 清空剧情不删除摘要、节点补充、其他剧集、全局素材文件或任务历史。对应实现为 `server/runtime/review-checks.js` 的 `prepareChecks` 与 `server/flow/shared/task-executor.js` 的 `releaseOperation`。
- **按意见修改**提供基稿和本次意见，只改受影响内容及必要关联；自动修订使用本轮失败稿与审核意见，下游不继承上游意见。
- 成功后只清理已提交的意见，失败保留，不能清除执行期间新输入的意见。其他操作沿用各自保存、回退和下游删除规则。

## 5. 面板交互

- 生成入口保持可见，前置条件不足时禁用并说明节点与原因；门禁复用 `shared/generation-gates.js`。
- 每个实际操作提供对应范围的任务历史：操作 → 任务列表 → 步骤详情。详情显示状态、审核与失败原因、时间、内容快照和实际提示词；复用事件推送与任务查询及时更新。
- 剧情顶部查看整次操作；大纲、人物、场景、道具区块各有按 target 查看任务历史与 skill 的入口。人物/场景详情合并文字和图片历史；图片、每秒指令及成片卡按自身 ID 过滤，成片也保留整集入口。
- 节点 skill 页为「基础 skill / 补充 skill」两个 tab：基础只读，补充整段编辑，空文本保存即清空；切换保留草稿，保存失败保留输入。实际提示词在任务步骤中查看。
- 意见是本次修订输入，补充 skill 是节点持续规则，分开保存。辅助入口放标题区，不单独占行；窄面板自然换行。
- 图片候选支持确定/放弃，生成中禁用确认，刷新后可恢复待确认项；放弃保留已用图片，选图不改变文字剧情审核结论。人物附属素材不再单独生成，道具图在道具卡操作。
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
- 草稿保存与审核通过分开，后续失败不抹掉已通过阶段。审核问题和执行错误分别保留，界面不重复显示同一原因；没有可用正文时仍展示失败原因，禁用按意见修改与人工放行。
- 人工忽略自审仅限面板、仅对当前版本有效，不能忽略格式错误。每秒指令的草稿保存边界见第 10 节。

## 8. 项目修改核对

- 从实际入口核对 Model、接口、执行步骤、保存、下游清理与调用方；涉及页面时核对任务历史、意见和 skill 入口。
- 覆盖生成、修订、审核与失败路径，确保提示词、解析、保存及展示一致。
- 后端改动后重启 Harness 并刷新面板，确认服务加载新代码。验证记录按 [AGENTS.md](../AGENTS.md) 执行。

## 9. 运行数据与请求边界

- 会话与项目按需关联：仅 session-projects 显式选择有效，新会话不继承工作区项目。绑定后会话只处理本视频相关请求；无关内容、另建或打开其他项目时提示「请切换工作区或新建会话」，项目工具拒绝自动更换绑定。会话工具创建或打开仅绑定当前会话；面板创建项目始终在该项目工作区新建会话并切换，旧会话及其关联保持不变。面板打开已有项目继续绑定当前会话，无会话时才新建。旧 workspace-links 映射退出执行路径，原文件不删除，未显式选择的历史会话需重新打开项目。
- 删除项目同步注销该项目 workspaceId 对应的 Harness 工作区并清理 session-projects 选择记录，保留旧会话本身及其他工作区。仅删除当前会话关联项目成功后创建不带 workspaceId 的新会话，面板切换到新会话；删除其他项目不新建或切换会话；工作区注销失败时保留项目，已不存在的工作区允许继续删除。删除剧集不触发上述切换。
- 用户数据根为 `$DSH_HOME/storages/meiji/`，DSH_HOME 默认 `~/.dsh`；源码与数据分离，迁移备份放 `$DSH_HOME/backups/`。
- 项目索引只保存剧集文件引用，每集独立存储。创建保存标题、模式、风格、画幅及模式对应的必填资料，没有创建前摘要草稿或 project-drafts。任务、内容和提示词快照放项目 history；步骤保存引用与时间，列表不携带完整提示词、密钥或图片 Base64；提示词读取校验任务归属。
- 图片候选放 `image-drafts/`，确认后入全局素材库；导入先暂存。素材库和任务历史不因重新生成而删除。
- 素材库七类卡片的删除走面板 `library-delete` 直接操作，仅原子写入素材元数据 `removedAt` 并从列表排除；原文件与 `file/script` 按 ID 读取保留，项目已有引用及历史不变，不释放磁盘空间。该可选字段无需旧数据迁移。
- Harness 会话默认模型由 `server/host/harness-chat-model.js` 同步到 meiji-gateway，使用相同 baseUrl、chat.model 与凭据；启动与模型保存共用入口。凭据仅写 credentials 服务，配置用引用；模型目录用当前 settings.describe，写入用 mutate/update，不使用已移除的 get。
- layout=2、schemaVersion=2 的旧项目离线运行 `scripts/migrate-project-v3.js`：只补索引，备份、读回验证，失败还原，不改剧集文件。
- 运行模型配置为 `storages/meiji/models.json`；仓库默认配置为 `config/models.json`，本地覆盖为被 git 忽略的 `config/models.local.json`。密钥不返回浏览器、不写日志或文档。
- gateway 校验生成请求的地址、密钥和当前模型；轮询、下载不要求生成模型。第三方图片下载不附网关密钥，不做缺密钥时的隐式后端回退。

## 10. 生成流程约束

### 摘要与剧情

剧本素材存 `assets/scripts/`，支持 UTF-8 TXT/TEXT，最多 1 MB、200000 字符。项目持久化 `mode: free | script`，创建默认 free，暂不支持创建后切换。自由模式必填 AI 创作方向（premise，最多 1000 字），禁止导入剧本；剧本模式必填 script 或 scriptAssetId，禁止设置方向，不预生成摘要。导入剧本建立第 1 版，素材原文保持不变；自由模式首次回写建立分节剧本。scriptKind 仅区分 imported 原始剧本与 assembled 自动回写记录，方向是否参与生成由 mode 决定。自由模式方向持续指导每集摘要，自动回写不改变模式；本次 requirements 选填，不代替方向、不自动保存为方向。方向仅由人提供与编辑，会话不可修改，新方向用于之后生成；本次要求与已发生事实优先于方向，方向优先于回写参考与项目摘要。剧本模式隐藏方向，提示词不注入 premise，方向编辑接口拒绝写入。自由方向禁止清空，剧本模式编辑、方案确认及版本恢复禁止清空剧本。剧本是参考，沿情节顺序并以已发生剧情为准，审核不因剧本外事件直接判失败。

项目摘要由当前剧本与适用的 AI 创作方向生成，最多 1000 个非空白 Unicode 字符，记录剧本依据版本；版本增加后待更新，创作方向变化本身不删除数据。生成剧集摘要/剧情前按需更新，失败取消后续任务；面板按原参数重试，会话说明要求自动重试一次。不能手改项目摘要，只能附意见重新生成。

剧本保存先落版本记录再原子提交项目，读取排除未被提交引用的孤立记录。回写仅追加时自动保存新版本；修改旧正文时建立绑定剧本与摘要依据的逐条方案，部分确认或放弃不解除待回写，旧依据确认被拒。人工编辑、按要求修改、恢复旧版本都保留历史；恢复产生新版本。删除剧集保留删除回写事实，重启后仍可重试。scriptBlockers/scriptFreshness 提供派生提示，不写过期标记。

剧集摘要草稿保留，复用任务、队列与历史，用户保存才执行 episode-add/edit。默认参考时长 150 秒，可设 1–86400 整数秒；剧集摘要非空、不限字数。人工修改后显示独立回写进度和方案选择。


剧情依次生成并审核大纲、人物、场景、道具，前项未通过停止后项。大纲依据当前本集摘要，项目摘要与剧本作背景、前后集作衔接，不提前演出后集事件；返回七个固定中文字段的 JSON 对象：主角动机、世界规则、因果剧情、情绪线索、对白节拍、结尾状态、结尾关键画面；值为非空正文字符串。对象直接存 `plot.outline.content`，审核、提取与镜头规划直接使用；展示时才加【字段名】，编辑按字段保存。卡片基于本轮通过的大纲，返回完整 items JSON；目标为 outline/characters/scenes/props，四类资料分别保存快照，不再记录 story 聚合快照。

镜头表返回 `{"shots":[{"shotId":"S01","durationSeconds":12,"title":"剧情标题","content":"条目正文"}]}`，编号连续、秒数为 1–15 的整数。单镜修订使用同一结构，只返回指定镜头，编号和时长不变。解析后按现有镜头卡片存储标题与正文；非法结构不覆盖有效内容。

人物只提取实际可见身体，场景描述无人物环境。道具须为本集主要且反复使用的物件，或已在项目库中；一般服装写角色造型，不另建道具。道具存 `plot.props`，类别为 clothing/mount/weapon/accessory/prop，程序分配 P 编号；允许空集合通过。人物/场景目录用于匹配 ownerId，不从外观补造道具；修改保留同名实体 ID，新实体递增。

### 三类项目库

角色、场景、道具分别存项目 library；条目含名字、别名、身份字段与多个变体，变体含外貌/状态/样式字段及图片节点。审核通过的提取卡片才并库；有效 ID 显式关联，其次名字/别名匹配默认变体，否则建新条目，明显变化通过新变体表达。关联卡片字段与图片以库为准，图复用无需生成/确认。

修改关联卡片写回库并同步全部关联剧集，保存前显示同步集数与删除清单；本集新变体不影响旧关联。图片确认同步库及关联卡片，删除引用该实体镜头的分镜、视频及合成。导入照片来源为 photo，AI 候选必须人工确认。可改关联、解除、合并迁移；有关联条目/变体不能删除。必须出场的角色进入剧情上下文。下游仍使用剧集卡片 ID，关联列表临时派生，不持久化。

### 每秒指令与视频提示词

每秒指令按镜头顺序逐镜生成，每次返回仅含当前镜头的 shots JSON（version: 1），保持上游镜头 ID 与时长；beat 使用正整数 durationMs，由程序累计时间，dialogues 独立保存、beat 引用事件 ID，ambient/music 带时间。`shared/seconds-content.js` 管校验与可读正文，实体标记使用“名字【名字|ID】”，不依赖图片 ID。

程序检查结构、实体、时长与对白，模型审核语义。`seconds-feedback.js` 区分程序问题、语义问题和人工意见并去重；每镜独立任务生成、自审、至多两轮自动修订与复审，通过并保存后才继续下一镜。失败或取消停止后镜，已完成前镜保留。前镜更新同次删除后镜指令、分镜、视频和合成；清空后的旧稿只留历史。能唯一对应上游的镜头保留正文与失败原因；不可解析或无法对应上游时只存未发布 artifact，不覆盖旧镜头。生成/修订原始响应另存 seconds-response 快照。

最终视频提示词由 `compileVideoPrompt` 直接编译为有图六字段或无图三字段，不调用模型重写。referenceSnapshot 固定 Picture 顺序，Subject 表示实体，服装共享所属角色 Subject、武器独立；sourceMap 记录来源，人工编辑后移除。人工编辑仍需格式与语义审核。版本或素材变化需重新组装；图片在视频提交时按快照读取本地文件并转 Base64。

### 图片与视频

人物、场景及道具图片与文字提取分开，通过对应 Model 编排；道具使用 `image:Pnn` 目标，`part-image` 仅是基础 skill ID。场景图只使用实际场景资料，未指定视向时用中性建立视图。候选图必须人工确认后入库。

视频保存后提取尾帧；FFmpeg 失败保留视频并报错，tail-frame 可单独重试。整集/逐镜制作发现已有视频缺尾帧时只补提取。

## 11. 编码规则

- 按实际调用链组织代码：同一生命周期集中维护，固定顺序用直接调用和条件分支表达，不另建通用步骤调度器；删除纯透传函数和中转导出，调用方直接引用职责模块。校验、快照、并发、记录与持久化等实际业务边界保留。
- 按第 1 节分层；`client/`、`shared/` 使用平铺 `.js/.css`，不引入 JSX、bundler 或构建步骤。shared 不引用 Node 专属模块、client 或 server。
- Harness 接入只经 `server/host/` 的公开接口，不读取上游存储文件。
- 生成操作在 generate/ 声明 tasks，任务在 task-registry 登记队列、target、nodes、maxRevisions、run。直接操作在 direct/ 登记；人工专属操作标 agent:false。任务不引用操作定义，不增加旧操作别名或中转导出。
- 文件参照 skills 使用小写连字符命名，优先「动作 + 对象」或「对象 + 职责」，如 `operation-generate-story.js`、`task-outline.js`、`project-store.js`，避免孤立的 `run.js`、`request.js` 等泛名。会话业务工具统一使用 `operation-` 前缀及小写连字符，工具名与对应实现文件主体一致，例如 `operation-generate-story` 对应 `operation-generate-story.js`。迁移脚本使用 `migrate-` 前缀，测试按对应模块或明确主题命名。保留 `index.js`、`README.md` 等标准入口。
- skill 分工与登记规则见第 6 节。

## 12. 数据规则

- JSON 通过临时文件 + rename 原子替换，权限 `0600`；素材导入经 `.upload/` 暂存后重命名。
- 项目读写只经 `projectStore`，布局只由 `project-files.js` 处理；save 按 revision 串行提交，只写变化剧集，最后替换索引。
- 领域 schemaVersion 为 3，存储 layout 为 2，任务 schemaVersion 为 3（nodes）。拒绝旧结构，不做运行时兼容。默认离线备份迁移；用户明确授权删除时使用 reset-runtime-data.js，停止服务后清空项目与生成文件，保留素材库和系统配置。
- 摘要、大纲、人物、场景、道具补充存每集 `supplementalSkills`；其他阶段补充与指导素材暂存项目 `skills`。剧集不接受 customSkills/guidanceAssets，旧数据通过 `migrate-custom-skills.js` 迁移。技能修改层只经 `skill-store.js` 读写。
- 旧字符串大纲通过 `scripts/migrate-story-outline.js <DSH_HOME>` 离线转换，先备份索引和剧集再写入并读回核对；失败还原，缺少小节保留正文并标为未通过，不修改历史请求。启动与重启脚本自动检查。
- 新生成素材不覆盖旧素材，参考图变化后按 R6 删除引用实体镜头的分镜、视频与合成；剧情重新生成的清空边界见第 4 节。
- 发起请求校验会话，返回 operationId；查看/停止请求携带对应 ID，剧集范围操作携带 episodeId；密钥边界见第 9 节。

<a id="test-environment"></a>

## 13. 测试环境与命令

- 代码、配置、skill 和测试修改前运行全量测试并记录基线，每阶段运行相关测试，完成后运行全量测试；相关测试必须通过，全量不得新增失败，同时记录通过、失败与 cancelled 数。纯文档修改只检查内容、链接与差异。
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

`StoryModel` 通过 `storyKinds` 区分 outline、characters、scenes、props；`StoryOutlineModel/StoryCharacterModel/StorySceneModel/StoryPropsModel` 是指定 kind 的子类。大纲携带摘要、背景与前后集资料，提取模型以已通过大纲为事实来源，避免重复携带无关上下文。

两类 Model 都提供 `toGenerateMessages/toReviseMessages/toReviewMessages` 和对应 `to*Segments`。生成/修订分别输出摘要 summary 对象、大纲 outline 对象或卡片 items 对象；审核一律输出 `{ passed, issues }`。生成与修订读取 task 规则，审核读取 review 规则。

修订参数包括 baseContent、opinion；自动修订使用 `automatic: true`，humanOpinion 保留仍有效的人工要求。复审核对最新失败稿及本轮意见，不把历史失败直接当成新结论。剧情正常执行四次生成、四次审核，失败时按第 3、7 节决定修订与停止。重新生成和修改的素材保留边界见第 4 节。

| 镜头任务 | 主要输入顺序 |
|---|---|
| 镜头表 | 大纲 → 本集时长、允许范围与风格 → 人物/场景/道具卡 → 实体引用清单 |
| 每秒指令逐镜编排 | 本镜镜头表 → 上一镜本轮通过的完整每秒指令（首镜无此项） → 本镜关联人物/场景/道具资料 → 剧情大纲整体参考；另附本镜时长、项目风格及实体引用清单 |

镜头表先估算大纲各小剧情的必要动作、完整对白与转场时间，再分配整集预算并拆为 1–15 秒片段。同一小剧情超过 15 秒拆段时，标题使用相同基础名称加 1、2…，例如「发现旧信1」「发现旧信2」；S 编号仍按整集连续递增。

镜头表只写分段剧情、时间、人物地点、必要环境、分段依据及剧情起止状态。每秒指令依据本镜关联资料设计机位、景别、构图、剪辑与具体空间调度，承接上一镜指令；保留上游明确事实，不以镜头表未写摄影细节判失败。生成、修订、审核和输出协议都遵守此分工。

同一地点、同一目标的连续行动优先合在可容纳的 1–15 秒视频片段，摄影切镜、反应与微动作不自动拆片段。每秒 beat 按必要变化划分，可覆盖整镜，不设 1–5 秒范围或固定字数；审核接受合理合并，不要求补齐无因果作用的微动作。编号、时长、剧情状态与时间校验仍保持。

镜头表基础容量不足时主动丰富现有事件的动作、反应与环境互动，必要时增加有作用的旁白以达到本集预算；不改变主线、结果、人物地点、关键物件或跨集边界。审核接受合理扩充，每秒指令完整继承本镜确定内容。独立旁白存 dialogues，speakerId 为 NARRATOR、delivery 为 off，只作为声音，不建人物卡或图片引用；已有角色画外声使用人物 ID。明确禁旁白/所有人声时改用可见行动补时。

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

操作记录含 taskIds；任务记录含 operationId、type、target、nodes、artifacts/latestOutputs 和冻结的 skill 版本。节点 status 表示执行情况，verdict 表示审核结论：自审不通过为 completed + fail，接口失败为 failed。最新复审结论替代旧结论。

任务状态由 nodes 推导；操作状态由任务状态推导，失败和审核未通过优先于连带取消。内容状态只经 `shared/content-state.js` 及模型基础转换函数更新；不把操作状态直接覆盖到内容。

| 记录 | projects/<项目 ID>/history/ 下的路径 |
|---|---|
| 操作 | operations/<operationId>.json |
| 任务 | tasks/<taskId>.json，schemaVersion:3、nodes |
| 内容快照 | artifacts/<artifactId>.json，target、version、taskId/nodeId、content、published |
| 实际请求 | prompts/<promptId>.json，关联 taskId/nodeId |
| 原始返回 | responses/<responseId>.json，步骤引用，HTTP 状态、耗时、完整脱敏正文/异常；视频只存最终轮询 |
| 剧本版本 | script-revisions/<revision>.json，先落记录后提交；恢复不覆盖历史 |
| 剧本方案 | artifacts/<proposalId>.json，项目持有依据与处理状态 |

快照先写入，项目原子保存后发布；不承诺跨文件事务。大纲、人物、场景、道具分别留版本，图片变化不新增文字版本。非法原文和未发布草稿只存 artifact；所有失败请求仍可查看。无项目归属或删除所属目录的操作不留项目历史。

实际提示词在发出请求前保存，读取严格校验项目、任务、节点归属，不用当前资料重建或从会话日志猜测。密钥、请求头与参考图 Base64 不存入快照。每个任务启动时冻结自己的规则；在途编辑仅影响之后启动的任务。

以下接口统一加 `/plugins/meiji` 前缀并校验项目/会话：

| 接口 | 用途 |
|---|---|
| GET /operations/current | 当前操作、任务、节点与排队位置，含直接操作 |
| GET /operations?targets=... | 按内容范围过滤操作历史 |
| GET /operations/:id | 操作及全部任务 |
| GET /tasks?target=... | 按内容范围过滤任务历史 |
| GET /tasks/:id | 独立任务详情，可回到所属操作 |
| GET /tasks/:id/nodes/:nodeId/prompts | 节点实际完整提示词 |
| GET /tasks/:id/nodes/:nodeId/responses | 节点脱敏原始返回 |
| GET /artifacts/:id | 内容快照 |
| POST /operations/cancel | 停止整个操作，可用其任务 ID 定位 |

发起接口等全部任务记录建立后返回 operationId，不等待模型生成。详情、当前任务及历史共用 `client/task-detail.js` 和 `task-nodes.js`，收到 events 后刷新，保留展开状态。失败查看定位最新失败节点，不重复显示原因。

会话操作工具按 registry 的 session 元数据派生，批量图片考虑库图与候选，单卡图片仅面板可用。工具返回 jobId 后使用 Harness job_wait/job_read/job_output；占用、图片与剧本处理分别登记等待 job。上下文查询包含剧本版本、方案、阻断、摘要新鲜度和三类库目录。会删除已有产物时无 confirmDelete 只返回清单，不启动操作。人工忽略自审只作用于当前有效版本，不改历史任务，不能忽略格式错误。

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
| `image` / `image[]` | file / text | 是 | 既有参考图为文件；人物修改为 PNG/JPEG/WebP 的 Base64 data URL 文本；合计 1–10 张 |

人物修改按用户要求提交 Base64 字符串；以下文件示例描述既有参考图请求。角色职责写在 prompt 正文中，不传 role 表单字段。真实服务 Base64 文本输入尚未联调。

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
