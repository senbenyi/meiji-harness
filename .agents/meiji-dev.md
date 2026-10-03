# meiji 开发指引

meiji 是 DeepSeek Harness 外部插件。本文记录模块边界、业务约束与开发规则；两步流程及模板见 [development.md](development.md)，仓库接入与 GitNexus 要求见 [AGENTS.md](../AGENTS.md)。文中源码路径均相对 `meiji/`，不维护目录树。原 `meiji/docs/` 的有效内容统一维护于本文：第 16 节为提示词接口与 Model，第 17 节为任务记录，第 18 节为历史迁移记录，第 19 节为网关接口参考。

## 1. 模块职责与调用链

依赖由 `tests/architecture.test.js` 检查：`http/tools → flow/operations → 文本执行/网关/提示词 → runtime → data → models/skills → shared`。存储和执行共用的叶子模块为 `runtime/task-context.js`、`task-state.js`、`operation-context.js`，只能依赖彼此或 shared，不能反向引用存储/执行器。`runtime/text-generation.js` 是上层文本编排，其他 runtime 模块不能反向引用它；media 仅依赖 Node 与 shared。服务端各层可引用这些叶子、`host`、`shared`；`host` 只向下依赖 `shared`，服务端、工具和脚本不得引用 `client`。

| 位置 | 职责 |
|---|---|
| `index.js` | 组合入口：接入 Harness、处理遗留任务、检查 FFmpeg、创建任务管理器、注册面板与四个会话工具、校验并注册会话 skill |
| `client/` | 原生 ES 模块面板，通过 `panel-api.js` 访问同源接口 |
| `shared/` | 可用于前后端的纯领域规则：模型、剧集构造与视图、语言、素材保留、节点补充、分镜编辑、门禁、步骤状态及下游失效；不读写文件 |
| `server/http/`、`tools/` | 面板与会话入口，复用服务端流程；鉴权与同源检查在 HTTP 层 |
| `server/flow/operations/` | 操作层：`operation-manager.js` 是面板与会话、生成与直接操作的唯一入口（start 排队执行、run 直接执行、current/list/get/wait、cancel），写操作记录；`operation-occupancy.js` 剧集占用（唯一一把锁，同集同时只允许一个操作，含排队中）；`operation-cancel.js` 停止；`operation-registry.js` 汇总各文件导出的操作定义（label、scope、queue、agent、maxRevisions、plan/step、stage/run）；`direct/operation-*.js` 每个直接操作一个文件；`tasks/` 为生成操作的现有实现（阶段 C 拆为 generate/operation-* 与 flow/tasks/task-*）；`run-operation.js` 执行一个任务（上下文、准备分派、结束释放）。迁移计划见 `docs/plans/计划-操作任务节点三层模型.md` |
| `server/flow/tasks/` | 任务层：`task-queue.js` text/image/video 全局限流；`task-interrupt.js` 服务重启时取消遗留的操作与任务（阶段 C 起每种任务一个 `task-*.js`） |
| `server/gateway/` | 文本/图片/视频网关适配、文本请求入口、视频轮询、请求快照和日志 |
| `server/media/` | 图片解码/文件处理/压缩，FFmpeg 检查、尾帧提取与视频拼接；不依赖操作、提示词或任务执行 |
| `server/prompts/` | Model 编排提示词，interfaces 赋值，`prompt-request.js` 统一请求结构，preview 复用实际入口 |
| `server/runtime/` | 任务/步骤执行、操作上下文和自审状态协调；`text-generation.js` 复用文本生成/自审/修订，调用 prompts 和 gateway；task-context 管内存，task-state 管无 IO 的步骤规则，task-execution 管执行生命周期 |
| `server/data/` | 文件与记录持久化、内容快照、剧集存储视图及封面；`projectStore` 管项目保存，`project-files.js` 独占存储布局；不放执行器或纯数据规则 |
| `server/host/` | Harness 公开接口适配、工作区与会话查询、日志及归属明确的历史提示词读取 |
| `models/`、`config/`、`skills/` | 模型路由与默认配置、生产规则、审核规则及会话说明 |

生成主链：`面板/会话工具 → operation-manager.start（剧集占用、操作记录）→ queue → runOperation（任务记录、步骤）→ executeOperation → 领域操作（含业务生成） → 网关/媒体 → 保存结果`。面板编辑、删除、图片确认及会话创建等经 `operation-manager.run` 直接执行（同样占用剧集、写操作记录）；打开项目由 `workspace-links` 处理。不能在页面、网络层或工具中另建生成通路。

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

## 3. 任务与步骤

registry 定义操作；任务记录一次执行；步骤记录具体工作并关联内容节点。可独立调用、审核或保存的工作拆为独立步骤，后续步骤使用本轮最终结果。

- 任务状态统一由 `shared/task-steps.js` 的 `deriveTaskStatus` 推导，持久化 status 是缓存，不另设状态判定分支。各目标最新审核结论统一由 `reviewPassed/reviewFailures` 读取。
- 步骤由 `server/runtime/task-execution.js` 的执行器运行，创建与终态规则在 `task-state.js`；文件读写位于 `server/data/task-store.js`，内容版本及草稿快照位于 `content-records.js`；操作计划与 `runStep` 的 target 保持一致，计划外步骤会标记 `unplanned`。
- 文本流程复用 `runTextSteps`，在同一函数中直接执行：生成 → 自审 → 不通过时最多自动修订一次 → 复审；程序检查和模型审核按流程独立配置，未配置不执行、不伪造通过。
- 图片拆为请求、下载转换、保存候选；视频拆为提交、生成保存、提取尾帧，不机械套用文本审核。
- 逐镜制作的子操作共用外层任务，以 scope 区分，不重复建任务或提前结束外层任务。任务管理器等待图片与视频后台工作结束后释放队列名额。

具体状态、步骤和历史结构见[第 17 节](#task-records)。

## 4. 重新生成与按意见修改

- **重新生成**使用当前指定的上游资料，不带目标旧稿及历史意见。`outline/regenerate` 在请求前清空本集 plot、shots、assembly、pendingImages，即旧大纲、人物/场景/道具及图片关联、候选图、镜头和合成；失败或取消也不恢复旧数据，只保留本轮已保存结果。
- 清空剧情不删除摘要、节点补充、其他剧集、全局素材文件或任务历史。对应实现为 `server/runtime/review-checks.js` 的 `prepareChecks` 与 `server/flow/operations/run-operation.js` 的 `releaseOperation`。
- **按意见修改**提供基稿和本次意见，只改受影响内容及必要关联；自动修订使用本轮失败稿与审核意见，下游不继承上游意见。
- 成功后只清理已提交的意见，失败保留，不能清除执行期间新输入的意见。其他操作沿用各自保存、回退和下游失效规则。

## 5. 面板交互

- 生成入口保持可见，前置条件不足时禁用并说明节点与原因；门禁复用 `shared/generation-gates.js`。
- 每个实际操作提供对应范围的任务历史：操作 → 任务列表 → 步骤详情。详情显示状态、审核与失败原因、时间、内容快照和实际提示词；复用事件推送与任务查询及时更新。
- 剧情整包的提取历史在顶部生成操作处查看；大纲、人物、场景、道具各节点保留独立 skill 入口。图片历史和 skill 在对应图片详情查看。
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

任务开始时冻结 skill 内容与来源版本，编辑只影响后续任务。节点补充按项目、剧集、节点校验归属；保存位置见第 13 节，不根据目标名称自行扩展支持范围。技能修改只经面板同源接口，会话工具不提供修改能力。

## 7. 结果与审核一致性

- 输出协议、解析、校验、保存和展示一起修改；ID、路径与素材关联由程序管理。
- 模型审核统一使用 `shared/review-result.js` 的 JSON `{ passed, issues }`：问题必须有非空 location/reason/requirement；通过时 issues 为空，不通过必须有问题。拒绝旧 PASS/FAIL、围栏和矛盾结论。
- 程序检查与模型审核记入同一自审步骤的 attempts，任一不通过即自审未通过。接口故障或审核协议错误属于执行失败，不触发内容自动修订。
- 草稿保存与审核通过分开，后续失败不抹掉已通过阶段。审核问题和执行错误分别保留，界面不重复显示同一原因；没有可用正文时仍展示失败原因，禁用按意见修改与人工放行。
- 人工忽略自审仅限面板、仅对当前版本有效，不能忽略格式错误。每秒指令的草稿保存边界见第 10 节。

## 8. 修改时核对

1. 按第 11 节选择档位，并执行 `development.md`。
2. 从入口核对 Model、接口、步骤、保存、下游清理与调用方；涉及页面时核对历史、意见和 skill 入口。
3. 覆盖生成、修订、审核及失败路径，按第 14 节记录验证结果。
4. 后端改动需重启 Harness 并刷新面板，确认运行服务加载新代码；同步相关文档，按仓库要求更新 GitNexus。

## 9. 运行数据与请求边界

- 用户数据根为 `$DSH_HOME/storages/meiji/`，DSH_HOME 默认 `~/.dsh`；源码与数据分离，迁移备份放 `$DSH_HOME/backups/`。
- 项目索引只保存剧集文件引用，每集独立存储。任务、内容和提示词快照放项目 history；步骤保存引用与时间，列表不携带完整提示词、密钥或图片 Base64；提示词读取校验任务归属。
- 图片候选放 `image-drafts/`，确认后入全局素材库；导入先暂存。素材库和任务历史不因重新生成而删除。
- 运行模型配置为 `storages/meiji/models.json`；仓库默认配置为 `config/models.json`，本地覆盖为被 git 忽略的 `config/models.local.json`。密钥不返回浏览器、不写日志或文档。
- gateway 校验生成请求的地址、密钥和当前模型；轮询、下载不要求生成模型。第三方图片下载不附网关密钥，不做缺密钥时的隐式后端回退。

## 10. 生成流程约束

### 摘要与剧情

剧集摘要草稿 `episode-summary-draft` 复用任务、队列与历史，产物为未发布 artifact，用户保存才执行 episode-add/edit。默认参考时长 150 秒，可设 1–86400 整数秒，不由字数推断。剧集摘要非空、不限字数；项目总摘要上限仍为 10000 字。

剧情依次生成并审核大纲、人物、场景、道具，前项未通过停止后项。大纲依据当前本集摘要，项目摘要与剧本作背景、前后集作衔接，不提前演出后集事件；返回七个固定中文字段的 JSON 对象：主角动机、世界规则、因果剧情、情绪线索、对白节拍、结尾状态、结尾关键画面；值为非空正文字符串。对象直接存 `plot.outline.content`，审核、提取与镜头规划直接使用；展示时才加【字段名】，编辑按字段保存。卡片基于本轮通过的大纲，返回完整 items JSON；目标为 outline/characters/scenes/props，历史保留 story 聚合快照。

镜头表返回 `{"shots":[{"shotId":"S01","durationSeconds":12,"title":"剧情标题","content":"条目正文"}]}`，编号连续、秒数为 1–15 的整数。单镜修订使用同一结构，只返回指定镜头，编号和时长不变。解析后按现有镜头卡片存储标题与正文；非法结构不覆盖有效内容。

人物只提取实际可见身体，场景描述无人物环境。道具存 `plot.props`，类别为 clothing/mount/weapon/accessory/prop，程序分配 P 编号；允许空集合通过。人物/场景目录用于匹配 ownerId，不从外观补造道具；修改保留同名实体 ID，新实体递增。

### 每秒指令与视频提示词

每秒指令按镜头顺序逐镜生成，每次返回仅含当前镜头的 shots JSON（version: 1），保持上游镜头 ID 与时长；beat 使用正整数 durationMs，由程序累计时间，dialogues 独立保存、beat 引用事件 ID，ambient/music 带时间。`shared/seconds-content.js` 管校验与可读正文，实体标记使用“名字【名字|ID】”，不依赖图片 ID。

程序检查结构、实体、时长与对白，模型审核语义。`seconds-feedback.js` 区分程序问题、语义问题和人工意见并去重；每镜独立生成、自审、至多一次自动修订与复审，通过并保存后才继续下一镜。失败或取消停止后镜，已完成前镜保留。前镜更新使后镜旧指令过期并清除受影响分镜/视频，旧稿仍可用于修改。能唯一对应上游的镜头保留正文与失败原因；不可解析或无法对应上游时只存未发布 artifact，不覆盖旧镜头。生成/修订原始响应另存 seconds-response 快照。

最终视频提示词由 `compileVideoPrompt` 直接编译为有图六字段或无图三字段，不调用模型重写。referenceSnapshot 固定 Picture 顺序，Subject 表示实体，服装共享所属角色 Subject、武器独立；sourceMap 记录来源，人工编辑后移除。人工编辑仍需格式与语义审核。版本或素材变化需重新组装；图片在视频提交时按快照读取本地文件并转 Base64。

### 图片与视频

人物、场景及道具图片与文字提取分开，通过对应 Model 编排；道具使用 `image:Pnn` 目标，`part-image` 仅是基础 skill ID。场景图只使用实际场景资料，未指定视向时用中性建立视图。候选图必须人工确认后入库。

视频保存后提取尾帧；FFmpeg 失败保留视频并报错，tail-frame 可单独重试。整集/逐镜制作发现已有视频缺尾帧时只补提取。

## 11. 流程

修改 `meiji/` 下代码、配置、skill 或测试（`docs/`、`reports/` 除外），先读本文与 `development.md`，回复开头写明档位及理由：

- **完整流程**：新功能、根因未知的 Bug、数据结构/存储/接口/门禁/生成流程改动，或涉及至少 3 个文件。
- **小改动**：文案、样式、单处根因明确的修改，且不超过 2 个文件。拿不准按完整流程。

执行“调研与计划 → 实施与验证”，具体文档要求见 `development.md`；修改业务代码前必须有 `docs/plans/计划-*.md`。只回答问题、只调研或只改文档不要求计划。

## 12. 编码规则

- 按实际调用链组织代码：同一生命周期集中维护，固定顺序用直接调用和条件分支表达，不另建通用步骤调度器；删除纯透传函数和中转导出，调用方直接引用职责模块。校验、快照、并发、记录与持久化等实际业务边界保留。
- 按第 1 节分层；`client/`、`shared/` 使用平铺 `.js/.css`，不引入 JSX、bundler 或构建步骤。shared 不引用 Node 专属模块、client 或 server。
- Harness 接入只经 `server/host/` 的公开接口，不读取上游存储文件。
- 新操作在领域文件登记 `{ stage, run }`，在 registry 登记 label/scope/queue/agent 及 plan 或 step，不在 run 入口加业务分支。人工专属操作标 `agent: false`；步骤规则见第 3 节。
- 文件参照 skills 使用小写连字符命名，优先「动作 + 对象」或「对象 + 职责」，如 `story-text-operations.js`、`project-store.js`、`character-image-interface.js`，避免孤立的 `run.js`、`request.js` 等泛名。迁移脚本使用 `migrate-` 前缀，测试按对应模块或明确主题命名。保留 `index.js`、`README.md` 等标准入口。
- skill 规则见第 6 节；改正文时用 `tests/fixtures/prompt-scenarios.js` 采集改前/改后请求，运行 `scripts/prompt-diff.js`，核对删除语句的去向或理由。
- 只改需求范围内代码，同步受影响调用方、测试和文档，不做无关重构。

## 13. 数据规则

- JSON 通过临时文件 + rename 原子替换，权限 `0600`；素材导入经 `.upload/` 暂存后重命名。
- 项目读写只经 `projectStore`，布局只由 `project-files.js` 处理；save 按 revision 串行提交，只写变化剧集，最后替换索引。
- 领域 schemaVersion、存储 layout、任务 schemaVersion 当前均为 2；拒绝旧结构，变更需提供先完整备份、再迁移并读回核对的脚本，不做运行时兼容，不直接改用户数据文件。
- 摘要、大纲、人物、场景、道具补充存每集 `supplementalSkills`；其他阶段补充与指导素材暂存项目 `skills`。剧集不接受 customSkills/guidanceAssets，旧数据通过 `migrate-custom-skills.js` 迁移。技能修改层只经 `skill-store.js` 读写。
- 旧字符串大纲通过 `scripts/migrate-story-outline.js <DSH_HOME>` 离线转换，先备份索引和剧集再写入并读回核对；失败还原，缺少小节保留正文并标为未通过，不修改历史请求。启动与重启脚本自动检查。
- 新生成素材不覆盖旧素材，参考图变化后关联视频与合成标 stale；剧情重新生成的清空边界见第 4 节。
- 面板写请求携带 operationId 并校验会话，剧集范围操作携带 episodeId；密钥边界见第 9 节。

## 14. 测试

- 改代码前运行 `cd meiji && npm test` 记录基线；改后相关测试必须通过，全量不得新增失败，同时检查通过、失败与 cancelled 数。
- 新功能或修复提供对应测试；无法执行时说明原因并标「未验证」。纯文档修改检查内容、链接与差异，不要求业务测试。
- 测试固定使用 `tests/fixtures/models.local.json` 的测试密钥，不读真实密钥；UI 测试从同级 deepseek-harness 或 HARNESS_DIR 加载 jsdom。
- 收尾运行 `git diff --check`，检查本次差异无无关改动或凭据，不覆盖工作区已有修改。

## 15. 外部边界

- 不修改上游 Harness 源码；`configure-harness.sh` 负责插件链接、迁移与启动，`restart-harness.sh` 校验链接后重启，生成的 `cordis.patch.yml` 不手改。
- 制作顺序由 `shared/generation-gates.js` 的上游资料与自审条件控制，不要求逐阶段人工审核；图片候选的“确认使用”仅用于素材选用与入库（见第 5、10 节）。
- 网关没有取消接口：停止、关闭或重启只取消本地任务，远端可能仍运行；不续查、不自动恢复，重试重新提交。
- 网关没有文件接口：图片以本地 localPath/assetId 为准，视频参考图按 Picture 顺序提交 Base64，文本请求不传图片。
- 生成任务经全局队列限流，并发上限来自 `config/models.json` 的 concurrency 配置。

<a id="prompt-models"></a>

## 16. 提示词接口与 Model 参考

### 16.1 修改入口

`server/prompts/interfaces/prompt-interfaces.js` 只选择接口，未知接口报错，不补默认模板。下表路径相对 `server/prompts/`。

| 任务 | 实际编排入口 |
|---|---|
| 剧集摘要 | `episode-summary-prompts.js` → `interfaces/episode-summary-interface.js` → `models/episode-summary-model.js` |
| 大纲、人物、场景、道具 | `story-prompts.js` → `interfaces/story-content-interface.js` → `models/story-model.js` |
| 镜头表、单镜修订、单镜每秒指令、图片提示词改写 | `interfaces/prompt-interfaces.js` → `models/text-step-model.js` 的配置与 `stepInterface` |
| 最终文本分镜 | `video-prompt-renderer.js` 程序编译；人工编辑的模型审核用 `models/text-storyboard-model.js` |
| 人物图、场景图 | `interfaces/character-image-interface.js`、`scene-image-interface.js` → 对应图片 Model |
| 道具/附属素材图、铅笔分镜 | `interfaces/prompt-interfaces.js` 直接调用 `models/part-image-model.js`、`pencil-storyboard-model.js` |

`generationParts/reviewParts` 提供任务冻结的规则、节点补充、素材、语言和协议片段；Model 选择资料并经 `generationRequest/reviewRequest` 组装。`text-prompts.js` 负责分发和序列化，`server/gateway/model-gateway.js` 的 `runTextRequest` 负责一次网络请求、日志与取消。不能直接读内置 Markdown 绕过技能快照。

文本接口返回 system/user 分段数组，序列化请求为 `{ skill, system, user, json, segments }`；审核请求标记 `skill: review`。分段保留来源信息；system 为空时可仅发送 user。图片输出单段 prompt，图片字节单独交给生成层。

### 16.2 摘要与剧情 Model

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

用户提交每秒指令走批量入口，内部逐镜执行，历史步骤和内容快照关联 seconds:Snn；不能因内部存在单镜编排而另开放已被 registry 拒绝的 `shot-seconds` 面板操作。

### 16.3 人物与场景图片 Model

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

## 17. 任务记录与状态参考

### 17.1 操作、步骤与节点

操作是 registry 定义，任务是一次执行，步骤是具体工作，内容节点是项目中可被多次任务写入的资料。一次任务可更新多个节点；节点当前是否有效与历史任务是否成功分别记录。

registry 字段为 label、scope、queue、agent、plan/step，以及是否允许经任务管理器启动的 task。`agent: false` 禁止会话工具发起；`task: false` 的操作只能直接执行。计划形式为 `[{ kind, target }]`，单步操作默认 execute，人工保存通常为 save。

| 流程 | 步骤 |
|---|---|
| 文本 | generate → review → 必要时 revise → re_review |
| 程序文本分镜 | generate → review，phase 为 reference-binding；无模型生成或自动修订 |
| 图片 | image_generate → image_download → image_save；无需下载的响应在结束时跳过下载步骤 |
| 视频 | video_submit → video_generate → tail_frame |
| 单镜/逐镜制作 | 程序文本分镜 → 视频与尾帧，按当前内容跳过已完成部分 |
| 人工操作 | save、override、confirm；assemble 用于拼接，check 记录未被现有步骤覆盖的内容校验失败 |

步骤字段包括 id/kind/target/label/status/verdict/reasons/error/actor、attempts、inputs/outputs、startedAt/endedAt、scope，按需附 remoteId、saved、apiFailure、preparing、unplanned、prompts。status 表示执行结果，verdict 表示审核结论；自审不通过是 completed + fail，不等同接口失败。

入队写完整计划，出队按最新内容重建计划；`runStep` 按 kind + target 匹配首个未执行步骤，计划外步骤标 unplanned。preparing 与 finished 只是过程标记。嵌套操作共用外层任务，scope 隔离草稿与失败回退判断，不另加锁或提前收尾。

### 17.2 状态与结束处理

`deriveTaskStatus` 按以下优先级计算：

| 步骤情况 | 任务状态 |
|---|---|
| 无步骤或全部 pending | queued |
| 有 running | running |
| 有 waiting（预留，不代表要求人工审核） | waiting |
| 有 cancelled | cancelled |
| 有 failed | failed |
| 仍有 pending | running |
| 各目标最新已完成审核中存在 fail | review_failed |
| 其余 | completed |

`reviewPassed` 无审核结论时为 null，否则按各目标最新结论判断；复审通过替代旧失败，未执行复审不参与。查询返回步骤副本，不暴露可变内部对象。

`finalizeSteps` 将中止落为取消；内容校验失败但尚无 fail 结论时补 check；其他异常且尚无 failed 步骤时标记当前或首个未执行步骤失败；剩余未执行步骤收尾为 skipped。服务重启中止未结束任务，远端处理规则见第 15 节。

人工“忽略自审”是可选的 override 操作，不是制作必经审批：只更新当前版本节点，不改原失败任务；保留原自审理由，内容为空、格式错误、生成中或过期时不可忽略，再生成/编辑后重新审核。

### 17.3 历史与提示词快照

以下路径均位于用户数据根 `storages/meiji/`。

| 记录 | 路径与主要内容 |
|---|---|
| 任务 | `projects/<projectId>/history/tasks/<taskId>.json`：schemaVersion 2、项目/剧集/会话、action/source/actor、mode/requirements/opinion、状态缓存、步骤、时间、错误、artifacts/latestOutputs、技能版本 |
| 内容 | `projects/<projectId>/history/artifacts/<artifactId>.json`：target、version/previousArtifactId、taskId/stepId、content/createdAt、published/baseline |
| 提示词 | `projects/<projectId>/history/prompts/<promptId>.json`：请求发出前保存的完整 messages 或媒体 prompt；步骤仅保存 `{ id, kind, createdAt }` 引用 |

内容快照先以 published=false 落盘，项目原子写入后标记发布并加入步骤 outputs；跨文件不承诺事务。baseline 表示首次留痕前已有内容，不伪造历史任务。保存粒度包括 summary、story（含道具）、shots、seconds、storyboard:Sxx、film:Sxx、assembly；seconds-response 另存模型原始响应。不可发布的草稿只在历史中查看。

无项目归属或会删除所属目录的操作不留项目任务记录。删除项目/剧集同时清理所属历史和提示词；视频快照保留不可变本地文件名。旧 schemaVersion 1/nodes 任务报 OLD_TASK_RECORDS，使用 `scripts/migrate-task-steps.js` 备份迁移，不做运行时兼容。

同一步的多次实际请求分别保存，失败后仍可查看；不保存密钥、请求头和参考图 Base64。读取校验项目、会话、任务与步骤归属。旧步骤无快照时，仅在所属会话公开 snapshotEvents 存在明确任务边界、步骤类型唯一且无并发归属歧义时读取脱敏日志；否则明确无完整记录，不推测、不用当前资料重建。

任务技能在 startExecution 冻结，嵌套子操作沿用；记录 id/layers/hash 及节点来源，编辑不影响在途任务。当前基础生产和审核规则独立只读，节点补充规则见第 6、13 节，不恢复旧的通用/生成/修订字段编辑模式。

### 17.4 查询入口与验证

- `GET /plugins/meiji/tasks/current?projectId&episodeId&sessionId`：当前与排队任务、步骤及队列位置。
- `GET /plugins/meiji/tasks?projectId&sessionId`：未结束任务；POST 用于停止任务。
- `GET /plugins/meiji/history?projectId&episodeId&sessionId[&artifactId]`：任务历史或指定内容快照。
- 当前任务与历史复用 `client/task-steps.js`，按目标分组；收到 events 推送后刷新，展示状态、结论、失败原因、时间、尝试与远端任务编号。

重点测试：`task-steps`、`task-store`、`tasks`、`model-ui`、`api-failure-state`、`node-skills`、`guidance`、`video-prompt-renderer` 和相应迁移测试。完整验证命令见第 14 节。

<a id="model-migration-history"></a>

## 18. 历史迁移记录

本节从原 model-refactor-execution 文档归档，只说明 2026-09-27 当时的实施记录，不作为当前结构、测试数量或部署状态的依据。

当时完成共享 Drama/Episode/Plot/Shot Model、意见版本保护、响应式 UI、素材引用显示及离线迁移。原记录报告 148 项测试通过，迁移 4 部剧、5 集、53 个镜头、33 张人物/场景卡、23 份文本分镜及 14 条视频记录；备份位置记录为仓库根目录下 `.dsh/backups/model-v2-2026-09-27T00-20-11-110Z/`。本次文档合并未重新核验该备份和历史数量。

原记录还包含 Harness 重启及浏览器人工检查，未调用付费生成接口，模型链路仅以注入响应验证。当前模型后来增加了道具、尾帧、结构化每秒指令和独立剧集文件等变更，应以第 9、10、13 节及源码为准。保留的长期要求是：迁移先备份并读回核对、不丢用户数据，运行时不兼容旧布局，意见草稿和页面输入不因异步响应丢失。

<a id="gateway-api"></a>

## 19. 网关 API 参考

以下保留原 gateway-api 文档的接口字段与示例。插件适配已对照 `server/gateway/model-gateway.js` 核查；远端网关源码不在本仓库，本次未重新验证部署地址、公开模型、容量、并发和上游限制。以下“当前”描述均指原接口文档记录，接入时以目标网关部署为准，不视为 meiji 的业务规范。运维命令在网关仓库执行。

### 19.1 接入信息

#### 19.1.1 地址

| 环境 | Base URL | Playground |
|---|---|---|
| 本地 | `http://127.0.0.1:18090` | `http://127.0.0.1:18090/playground` |
| 服务器 | `http://43.154.247.11` | `http://43.154.247.11/playground` |

示例统一使用：

```sh
export GATEWAY_URL=http://127.0.0.1:18090
export GATEWAY_API_KEY=sk-替换为实际密钥
```

#### 19.1.2 鉴权

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

#### 19.1.3 通用约定

- JSON 请求使用 `Content-Type: application/json`。
- 图片编辑以及视频首尾帧文件上传使用 `multipart/form-data`。
- 当前 HTTP 请求体上限为 **64 MiB**，超出返回 `413`。Base64 会增加请求体体积。
- 每个响应都会带 `X-Request-ID`；调用方提供该头时网关沿用，否则自动生成。
- 时间戳均为 Unix 秒。
- 对外模型名不会替换成内部模型名。
- 客户端断开会取消当前同步请求，但不会取消已经成功提交的视频任务。

### 19.2 接口总表

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

### 19.3 模型与运维

#### 19.3.1 健康检查

```sh
curl -sS "$GATEWAY_URL/health"
```

成功响应：

```json
{"status":"ok"}
```

该接口只说明网关进程可以响应，不检查模型上游是否可用。

#### 19.3.2 模型列表

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

### 19.4 OpenAI Chat Completions

#### 19.4.1 请求

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

#### 19.4.2 流式响应

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

#### 19.4.3 并发与后台工作负载

当前聊天并发槽为 2。普通请求最多排队 2 分钟；需要低优先级排队时添加：

```http
X-Elysium-Workload: background
```

后台请求最多排队 30 秒。排队超时返回 `429`、`Retry-After: 5`，并在 `Server-Timing` 中返回排队耗时。当前聊天总时限为 15 分钟。

### 19.5 Anthropic Messages

#### 19.5.1 请求

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

#### 19.5.2 流式响应

`stream: true` 时返回 `text/event-stream`，事件顺序使用 Anthropic Messages 语义：

1. `message_start`
2. 一个或多个 `content_block_start`
3. `content_block_delta`
4. `content_block_stop`
5. `message_delta`
6. `message_stop`

文本增量使用 `text_delta`；工具参数使用 `input_json_delta`。调用方必须按 `index` 合并内容块。

#### 19.5.3 Messages 错误格式

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

### 19.6 图片

#### 19.6.1 图片生成

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

#### 19.6.2 图片编辑

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

### 19.7 视频

#### 19.7.1 提交任务

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

#### 19.7.2 素材规则

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

#### 19.7.3 multipart 首尾帧

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

#### 19.7.4 JSON 示例

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

#### 19.7.5 任务对象

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

### 19.8 视频查询与下载

#### 19.8.1 查询

```sh
curl -sS "$GATEWAY_URL/v1/videos/$TASK_ID" \
  -H "Authorization: Bearer $GATEWAY_API_KEY"
```

任务只对创建它的 API Key 可见。任务不存在或属于其他密钥都返回 `404 video not found`。建议每 3–5 秒查询一次。

#### 19.8.2 下载

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

### 19.9 错误与重试

#### 19.9.1 OpenAI 风格错误

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

#### 19.9.2 常见状态码

| 状态码 | 含义 | 是否重试 |
|---|---|---|
| `400` | JSON、字段、尺寸、素材或组合不符合约定 | 修正请求后再试 |
| `401` | API Key 无效 | 更换密钥，不自动重试 |
| `404` | 模型不存在，或视频任务不存在/不属于当前密钥 | 检查模型名、任务 ID 和密钥 |
| `409` | 视频尚未完成 | 继续轮询后再下载 |
| `413` | HTTP 请求体或媒体预算超限 | 缩小请求，不原样重试 |
| `429` | 聊天排队超时或上游限流 | 遵循 `Retry-After` 并退避 |
| `502` | 上游不可用、响应非法或网关无法完成上游操作 | 指数退避；视频提交先确认是否已有任务 ID |

#### 19.9.3 重试原则

- `GET /v1/models`、视频查询和视频下载可以安全重试。
- Chat 和 Messages 在尚未收到有效响应时可按业务需要重试，但工具调用场景应由调用方保证幂等。
- 图片生成和图片编辑是同步生成请求，自动重试可能重复计算。
- 视频创建是非幂等提交；没有任务 ID 时不要无条件自动重试。
- `400`、`401`、`404`、`413` 必须先修正请求或调用上下文。
