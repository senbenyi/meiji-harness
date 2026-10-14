# meiji 开发指引

Meiji 是 DeepSeek Harness 外部插件。开发流程引用 [AGENTS.md](../AGENTS.md)。每次修改 `meiji/` 代码前，必须先完整阅读 [制作工作流](../meiji/dev_docs/制作工作流.md)，并以它作为当前业务规格入口；未读完不得开始改代码。修改配置、skill 或测试也遵循同一要求。普通咨询和只读调研不要求通读。项目级节点对齐的依据和证据见 [计划](../docs/plans/1013-计划-项目级节点对齐.md) 与 [实施记录](../docs/implement/1013-实施-项目级节点对齐.md)；剧集级见 [计划](../docs/plans/1013-计划-剧集级节点对齐.md) 与 [实施记录](../docs/implement/1013-实施-剧集级节点对齐.md)。历史计划和实施记录仅用于追溯。

镜头级下一阶段见[节点对齐开发计划](../docs/plans/1013-计划-镜头级节点对齐.md)，包含独立角色与服装识别、视频类型编排及尾帧并入视频任务；当前仅完成设计，正式结构、Model 与执行链须在实施阶段同步。

## 项目配置

- 代码、配置、skill 和测试范围为 `meiji/`；计划使用 `docs/plans/MMDD-计划-*.md`，完整实施记录使用对应的 `docs/implement/MMDD-实施-*.md`。
- `meiji/docs/`、`meiji/reports/`、`meiji/dev_docs/` 和其他纯文档修改按文档流程处理，不要求开发计划。
- 不修改上游 Harness 源码。数据根为 `$DSH_HOME/storages/meiji/`，未设置 DSH_HOME 时为 `~/.dsh/storages/meiji/`。
- 同一个 DSH_HOME 只运行一个写入服务实例。项目级事务与制作任务串行；不同项目可独立运行。
- GitNexus 仓库名为 `llm-dsh-plugins`，索引放在 `$HOME/.gitnexus/indexes`。根目录执行 `node ../../../.gitnexus/indexes/llm-dsh-plugins-033e0c85dfd2/run.cjs status`；更新执行同一 runner 的 `analyze --index-only`。索引符号身份异常时使用 `--force` 全量重建。MCP 可用时优先使用，UNKNOWN 必须补查实际源码与动态注册。
- 根 `CLAUDE.md`、`.claude/AGENTS.md`、`.cursor/AGENTS.md` 引用通用规范；`.claude/meiji-dev.md`、`.cursor/meiji-dev.md` 链接本文。`.claude/guard.mjs` 的计划检查不拦截 `meiji/dev_docs/`、`meiji/docs/`、`meiji/reports/`，也不适用于普通咨询、只读调研和纯文档修改。

## 模块与唯一执行链

`index.js` 公布 runtime 并登记面板 HTTP；`session.js` 在短剧制作预设登记三个会话工具和 `meiji-workflow` 说明。服务必须先公布，再后台同步聊天模型，避免宿主 Loader 等待自身依赖。卸载注销入口、停止本地执行与通知投递。

`面板 / 会话 → app-runtime → TaskService → precheck / handler → gateway 或 media → ProjectModel.update → ModelRepository`。

| 路径（相对 meiji） | 职责 |
| --- | --- |
| `shared/task_contract.js`、`project_contract.js` | ID、命令、节点、task/step/group、项目契约和定位 |
| `shared/collection-identity.js` | 按姓名合并角色、按服装名称合并服装，按编号替换镜头并保留已有 ID，核对删除引用 |
| `shared/node-state.js`、`node-dependencies.js` | 显式节点状态、有效输出校验、保留正文的过期传播 |
| `shared/task-plan.js` | 固定步骤；不自动安排上游任务 |
| `server/model/project-model.js` | 深拷贝读取与唯一事务提交入口 |
| `server/data/model-repository.js` | SQLite 存储、幂等受理、事务、不可变终态、变化事件 |
| `server/data/task-store.js` | 任务与组合任务只读视图 |
| `server/flow/tasks/task-service.js`、`precheck.js` | 项目串行、组合顺序、按节点重试轮次修订、取消/中断/继续及执行时前置核验 |
| `server/handlers/` | 文本、媒体、人工、删除业务；返回内容，不自行结算任务 |
| `server/http/nodes/`、`server/http/ai-routes.js` | 唯一节点输入/输出契约、节点参数编排和统一 AI 执行入口 |
| `server/prompts/models/`、`inputs.js`、`render.js` | 节点提示要求、公共输入映射和自然语言渲染 |
| `server/http/elysium/`、`llm-server/` | 两个文本来源的 HTTP 单例与独立参数组装 |
| `server/gateway/` | HTTP 协议、下载/轮询、纯请求记录及脱敏；不操作项目状态 |
| `server/media/` | 项目范围媒体路径、FFprobe/FFmpeg 校验、尾帧与合片 |
| `server/data/session-bindings.js` | 会话不可改绑；面板跨项目复用目标会话或新建目标工作区会话；不读取旧绑定 |
| `server/host/` | Harness 公开模型配置与直接通知、持久化 outbox 重试 |
| `server/runtime/app-runtime.js` | 组件组合、项目管理与同一任务入口 |
| `server/http/task-routes.js`、`tools/task-tools.js` | 鉴权/绑定、命令翻译、查询；不自建执行流程 |
| `client/task-client.js`、`task-panel.js`、`workbench.js`、`*-ui.js`、`*-forms.js` | 单一上下文、版本守卫、事件刷新、节点与历史、库/设置；保留面板 shell、DOM 与 CSS |
| `server/data/library-store.js` | 独立素材文件、元数据和引用保护 |

浏览器仅加载 `client/`、`shared/`，服务端不引用 client。共享领域模块不读写磁盘，不调用模型。旧 Run、即时操作、隐式上下文、jobs/goals 控制、生产 skill 与旧格式迁移脚本已经删除，不重新引入包装入口。

## 数据与提交

唯一数据库为 `$DSH_HOME/storages/meiji/meiji.sqlite`，使用 Node 内置 `node:sqlite`（^22.19.0 或 >=24）。`schema.sql` 定义 projects、task_groups、tasks、task_steps、command_requests、notification_outbox、schema_migrations 七表；任务必须归组，步骤必须归任务，顺序唯一且同项目最多一个 running 任务。`sqlite-store.js` 使用 WAL/foreign_keys/FULL、短同步事务及 revision 条件校验，变化记录增量写入；不在持锁期间调用模型或等待异步工作。ProjectModel 的写接口只允许 repository 提供的事务闭包，项目内容/任务/步骤/幂等/通知一起提交，事件发生在持久化后。卸载时等待任务和通知结束，再关闭连接。

`projects/<p_UUID>/` 仅作为宿主工作区目录。项目 Model 存在 SQLite 的 `projects.data_json`，使用 `shared/models/*_model.js` 固定字段及 `node_state.{status,reason,dependency_hash}`。当前 schema v9；本轮按用户要求清空旧项目、任务及关联文件，不迁移。首次启动建新库；旧版本明确拒绝，不在运行时自动删除或兼容。模型配置和独立素材库保留。

项目、剧集、角色、服装、镜头、规则、任务、组和步骤使用创建时生成的带前缀 UUID。AI 输入输出及资料界面使用编号，引用转换由程序核对唯一性和归属。重生成保留同一对象 ID，不按列表位置重建身份、不无声删除引用对象。独立素材继续使用原 `assets/<category>/<UUID>/metadata.json` 和 `original.<ext>` 文件格式；场景、道具及指导素材入口退出，但磁盘数据不会在启动时被删除。

旧格式项目/旧会话不迁移、不适配。旧项目目录名称可以出现在片库拒绝提示中，不读取旧正文；只允许用户显式删除。历史任务保留原 ID 和执行时资料，不能按当前项目资料重建历史请求。

## 状态、前置和任务

- 7 种节点状态为 empty、running、generated、rejected、failed、cancelled、expired，原因和状态一同提交；剧本没有节点状态。排队中只属于任务和任务组。
- 入队不改节点状态，只保存原状态/原因；排队取消或作废按快照写回。上游变化更新节点本身，并同步更新排队快照中的 generated→expired。正文和媒体地址保留。
- 仅 generated、结构有效且保存 hash 与当前依赖相符的节点可作为前置；空 hash 不视为有效。执行时重读当前 Model；不足记录 failed/precheck，不调用 AI，不自动补上游。
- 故事大纲（outline）是将已有本集剧情完整拆为故事小段，不生成新剧情；两种模式均要求本集 plot 非空，先完整分段再估算时长，生成/修订/审核都以原文逐项回查。任务名称统一为“故事大纲”。
- 剧本是制作工作流的输入资料；工作流包含提取剧集，不包含剧本生成或修改。
- 单任务针对一个节点操作；文本 precheck→generate→程序审核→AI 审核，节点没有的审核跳过。程序审核或 AI 审核未通过时，按该节点重试轮次 revise→再审核；修订次数用尽后才是 rejected。协议/结构/网络错误 failed，保留旧内容与历史。
- 图片 precheck→generate，无审核。当前逐镜实现仍将视频和尾帧分别执行；工作流要求尾帧并入视频、视频类型编排和视频程序审核，留待镜头级对齐。合片为程序任务，输入文件在 precheck 校验，无审核或自动修订。人工编辑与 override 均为两步、不调用 AI；manual_edit 校验结构，override 只对 rejected 文本跳过 AI 审核，结构及程序时长审核仍须通过。
- 删除任务 precheck→impact→apply。被镜头出镜/对白、规则或素材库引用的角色不能删除；默认/素材库引用服装不能删除；其他服装删除同次重绑为默认并使相关视频过期。
- 项目内执行串行；完成后自动下一项；failed/rejected/cancelled 停止队列。面板再次生成最新任务为失败、未通过、取消或作废的同一节点时，创建新任务并保留旧终态；有内容时 `generate` 按 `regenerate` 受理；首次无内容失败仍允许 `generate`。若该重试已排队则复用；无其他未结束任务时直接启动；有其他等待/运行任务时明确冲突，不误启动其他任务。开始/移除排队项、人工操作与删除只能从面板发起。
- 服务重启把所有 queued/running 旧任务统一结算为 superseded（已作废），未完成步骤同样作废，已完成步骤与历史终态保留；排队节点恢复快照，运行节点结算 cancelled 并保留内容。重启清除 queue_stopped，旧任务不重放，新任务可直接执行；晚到结果不得覆盖作废任务。
- 面板提交拆分剧集会直接恢复并执行该拆分（已有排队拆分复用）；存在其他未结束任务时明确拒绝，不带起其他暂停任务。面板同节点重试遵循相同直启规则；会话提交和其他普通提交仍遵循暂停队列规则。
- 成片使用 episode-film；当前逐镜任务为角色与服装识别→每秒分镜→分镜提示词→视频→尾帧，镜头级类型分支及尾帧并入视频仍待对齐。submit-group 的 action=generate 补齐无效节点，action=regenerate 重跑所选镜头；跳过有效节点前计算本次及已排队上游任务将造成的下游过期。可选 shot_id 限定单镜，镜头必须属于指定剧集，opinion 保存到组内任务且要求 regenerate。同集成片队列结束、本集全部视频有效时，最后完成组追加唯一合片；单镜组不代生成其他镜头，合片失败后继续只创建合片。episode-seconds 保留单项及历史契约，不再有独立标签入口。组合整组受理，冲突整组拒绝；停止后后序 superseded，继续新建组并保留旧终态。
- 每镜视频完成后记录 FFprobe 实测的实际时长秒（保留一位小数），人工导入视频同样测量；写回视频或替换镜头集合时，剧集实际时长立即累加各镜实测值。合片文件的实测值留步骤结果，不覆盖该累计值；参考预算不变。现有未测量的镜头暂不展示实际时长，不追溯重写已有媒体。
- 每次独立操作创建 single 组；角色提取、拆分剧集创建 workflow 组。角色提取只存资料；人物卡 submit-costumes 单独创建 workflow 组，按服装顺序生成全部定妆照，无服装生成一张；拆分剧集只包含拆分任务，写入各集剧情后完成，不自动派生每集摘要。父任务已完成不因子任务失败被改写。task/group/step 创建时保存 name，后续资料改名不改历史；已有记录缺名称时只读补显；持久化任务必须有父组，运行时不创建虚拟组。
- 删除整个项目不受制作进度限制，概要与片库的删除入口不随运行任务冻结。TaskService 删除入口先封闭该项目新增任务、暂停队列并取消未结束任务，abort 当前执行并等待本地清理完成，再串行删除项目及清除绑定；不等待项目制作完成，不影响其他项目。远端视频取消能力沿用网关现状。
- 角色卡按最新提取任务组（含续作组）显示聚合状态和原因；中途停止时提供继续。面板继续组在无其他未结束任务时直接启动，有其他排队或运行任务则冲突；会话来源仍按队列规则排队。
- 任务历史以组为列表入口，组内直接排列各任务全部步骤。组状态只读聚合，部分完成加其余作废显示已作废；继续从停点创建新组，组不保存来源组或意见；意见仅在对应任务，旧历史保留。人工/删除任务从原入口重新操作，不提供通用组继续。
- 按项目数据结构的过期表传播。拆分剧集整表替换剧集，不把旧节点标为过期。输出语言、画幅、规则、声音、默认服装配置只影响后续步骤，不使已有资源过期。图片依赖使用本节点实际提示资料：首套定妆照读取人物描述、服装和可选参考图，其余套另依赖首套定妆照；未参与提示的资料不触发图片过期。
- 每秒分镜的对白保存在 `dialogue[]` 的 `speaker_id` 和 `speaker_name`；未建卡人物/独立旁白保留原称谓和空 `speaker_id`，不自动建卡。

定妆照任务有服装时 `target_id=co_id`，定位该角色 `costume_images[costume_id=co_id]`；空服装时 `target_id=c_id`，定位唯一 `costume_id: ""` 条目，不建立假服装。角色新增明确服装后，原未绑定图片及其终态历史保留，只读展示，不加入新生成组。

## 提示词与网关

业务与输出结构以制作工作流、step_model、project_detail 和 dots 为开发依据；`server/http/nodes/` 按节点和动作定义业务输入与输出格式，提示词渲染、模型返回校验及人工编辑共用输出契约。`server/prompts/models/` 保存角色和生成、审核、按意见重新生成要求，节点文件的 `compose` 编排该节点业务参数；视频使用 `http/video-request.js` 直接编排已审核三段，无 PromptModel，`render.js` 渲染正文。输出格式只在 system，user 的任务是 Model 固定正文。占位符缺失直接失败；注入资料不二次展开。规则以范围、适用业务、类别、必须/参考组织，配置变更不追溯改写历史。

文本按对应节点声明解析：项目/剧集摘要为纯文本，人物和切点等按 JSON 结构校验；分镜提示词保留其既定段落协议。JSON 结构不可用时 failed 并保留旧内容；可用候选的业务审核未通过时按节点轮次修订，耗尽后将最后内容及 rejected 原因存正式节点，不刷新 hash、不传播、不派生。拆分只做程序审核，拒绝候选留任务历史且不替换剧集。定妆照的姓名、性别、年代、定位、年龄段、身材、发型、签名道具、不可改特征任一项去除首尾空白后非空即可生成；全部为空时拒绝。首套可有或没有用户参考图；后续定妆照固定且唯一地引用首套定妆照，所有生成/修订动作一致。图片每次最多一张参考图，不附角色声线。视频最多九张角色/服装参考图，后续镜头使用前镜尾帧及交接资料；远端 ID 在提交后记录。

文本由 `shared/models/settings_model.js` 的 SettingsModel 选择：`elysium-chat` 或独立 llm-server 提供的 `qwen3.5:27b`。图片、视频选项名分别为 `elysium-image`、`elysium-video`。选择 Qwen 时，`textBaseUrl` 独立于媒体 `baseUrl/apiKey`。`POST /v1/chat/completions` 使用标准 system/user、stream=false；Qwen 的 reasoning_effort=none、temperature=0.7、top_p=0.8、presence_penalty=1.5 默认参数已迁到独立 llm-server；不发送 max_tokens，不配置聊天 maxTokens；不发送 response_format 或不支持的模板参数。JSON 输出由节点路由契约注入提示词，并按同一契约进行本地校验。文本渲染追加资料边界与最终输出约定，图片/视频渲染保持原样。官方依据与隧道操作见 [README](../meiji/README.md)。

当前网关图片协议为 `images/generations` 或 multipart `images/edits`；视频为 `videos` 提交、状态轮询与 content 下载；文本使用 chat/completions。沿用实际网关的地址和参数，不依赖旧 README 所述异步图片取消协议。网关不提供远端视频取消接口：取消停止本地等待并阻止晚到结果提交，如实保留远端可能继续运行的原因。新增视频/合片在本地保持比例缩放并填充到项目画幅的像素尺寸，保留音轨；网关请求仍使用兼容尺寸，旧媒体不追溯改写。生成文件须通过 FFprobe 及 FFmpeg 完整解码；不能只根据扩展名或 HTTP 成功判为有效。

配置为运行目录 `models.json`，默认值来自 `config/models.json` 和被忽略的 `config/models.local.json`；测试覆盖使用 `MEIJI_MODELS_LOCAL`。已有配置须显式运行 `meiji/scripts/migrate-settings-model.js`，先备份、保留连接与并发设置、将 chat/story 合并为 text，不用运行时旧配置兜底替代迁移。密钥不得写入 Git、浏览器响应或日志。设置页只显示语言与模型选项，选择自动保存。语言保留项目 output_language，模型选择全局保存在 text/image/video.model。聊天通过公开 credentials/settings 同步选中服务；Qwen 使用 ollama 与上下文 32768，网关使用服务端密钥与接口文档声明的 65536；图片/视频保留原网关。设置 API 仅公开和接收选择，不公开连接地址与凭据。

## 双端与通知

三个工具为 meiji-context-query、meiji-project-command、meiji-task-command。HTTP 使用 `/api/meiji/` 的 context、project-command、task-command、events、media、library、models；写入校验宿主登录、同源标记和会话/项目绑定。AI 节点使用同一套 `/api/meiji/ai/<node>/<action>` 路由，query 的 session_id/project_id 通过绑定校验，正文只包含节点业务参数；返回候选，不直接写正式项目。任务 Handler 在进程内调用相同节点执行函数。不存在旧 run/operation 端点。

通知以稳定消息 ID 保存 outbox，并使用公开 `sessionController.resolveAgent` 和 `session.append(command/run、command/done)` 显示提示卡；不进入模型上下文、不唤醒 AI。会话断开/通知失败不撤销业务受理，返回 task/group ID 与独立通知错误，之后恢复时重试同一消息。投递期间新增通知继续在同次 drain 中处理。

面板上下文按 epoch、session、project、revision 拒绝晚到和乱序响应。后台标签页关闭 Meiji EventSource 并暂停刷新；重新可见时获取最新数据、恢复唯一订阅，卸载移除可见性监听。切换不取消后台任务，卸载关闭订阅与计时器。状态直接读取 Model；运行中冻结编辑与生成，查看及取消仍可用。保留项目概要、角色与服装、设置、历史、素材库；剧集四个标签为剧情、镜头表、成片、合成。镜头表直接读取项目角色库，不设本集人物资产节点。成片镜头详情顺序展示角色与服装识别、每秒分镜、文本提示词、视频、尾帧，视频生成/重新生成按钮提交单镜完整成片组。删除场景、道具、技能、预览授权及续旧任务入口。

## 验证与运行

- 根目录：`cd meiji && npm test`；单阶段：`node --test tests/stage0N-*.test.js`。
- 测试从本次八阶段设计重新创建。HTTP/DOM/生命周期使用隔离 home；网关协议使用 mock，FFmpeg 使用真实临时文件。生产网关和真实 Harness 走查证据单独记录，不能混称自动测试全部覆盖生产模型质量。
- 收尾执行 `git diff --check`、入口依赖/旧文件检查、必要 shell 语法检查，再更新图谱。
- `configure-harness.sh` 链接插件并启动；`restart-harness.sh` 验证进程归属、停止旧实例并确认端口释放后启动。SQLite schema 升级由数据库启动事务自动执行；端口被非预期进程占用或旧进程不退出则拒绝启动新实例。

逐镜文本：`shot-characters` 保存到 `shot.character_binding`，`has_result` 区分未识别与合法空绑定；编号由服务映射 ID。识别、每秒分镜及文生提示词要求有效角色库，不要求定妆照。`episode-seconds` 每镜依次识别→每秒分镜。文本输入与依赖 hash 共用 `shared/shot-text-inputs.js`，图片不影响文本。seconds 程序审核从 0 连续、正向、无重叠，末端误差 ±5 秒；与 AI 共用两次修订。
