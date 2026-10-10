# meiji 开发指引

Meiji 是 DeepSeek Harness 外部插件。开发流程引用 [AGENTS.md](../AGENTS.md)。每次修改 `meiji/` 代码前，必须先完整阅读这三份开发契约：[项目数据结构](../meiji/dev_docs/项目数据结构.md)、[任务步骤](../meiji/dev_docs/任务步骤.md)、[提示词编排](../meiji/dev_docs/提示词编排.md)，并以它们作为当前业务规格；未读完不得开始改代码。修改配置、skill 或测试也遵循同一要求。样例见 [project_detail.json](../meiji/dev_docs/project_detail.json) 和 [step_model.json](../meiji/dev_docs/step_model.json)。普通咨询和只读调研不要求通读。本次完整重构的依据和证据见 [计划](../docs/plans/1010-计划-分阶段开发总纲.md) 与 [实施记录](../docs/implement/1010-实施-分阶段开发总纲.md)。历史计划和实施记录仅用于追溯。

## 项目配置

- 代码、配置、skill 和测试范围为 `meiji/`；计划使用 `docs/plans/MMDD-计划-*.md`，完整实施记录使用对应的 `docs/implement/MMDD-实施-*.md`。
- `meiji/docs/`、`meiji/reports/` 和其他纯文档修改按文档流程处理。
- 不修改上游 Harness 源码。数据根为 `$DSH_HOME/storages/meiji/`，未设置 DSH_HOME 时为 `~/.dsh/storages/meiji/`。
- 同一个 DSH_HOME 只运行一个写入服务实例。项目级事务与制作任务串行；不同项目可独立运行。
- GitNexus 仓库名为 `llm-dsh-plugins`，索引放在 `$HOME/.gitnexus/indexes`。根目录执行 `node ../../.gitnexus/indexes/llm-dsh-plugins-995853d2d454/run.cjs status`；更新执行同一 runner 的 `analyze --index-only`。索引符号身份异常时使用 `--force` 全量重建。MCP 可用时优先使用，UNKNOWN 必须补查实际源码与动态注册。
- 根 `CLAUDE.md`、`.claude/AGENTS.md`、`.cursor/AGENTS.md` 引用通用规范；`.claude/meiji-dev.md`、`.cursor/meiji-dev.md` 链接本文。`.claude/guard.mjs` 的代码编辑提醒/计划检查不适用于普通咨询、只读调研和纯文档修改。

## 模块与唯一执行链

`index.js` 公布 runtime 并登记面板 HTTP；`session.js` 在短剧制作预设登记三个会话工具和 `meiji-workflow` 说明。服务必须先公布，再后台同步聊天模型，避免宿主 Loader 等待自身依赖。卸载注销入口、停止本地执行与通知投递。

`面板 / 会话 → app-runtime → TaskService → precheck / handler → gateway 或 media → ProjectModel.update → ModelRepository`。

| 路径（相对 meiji） | 职责 |
| --- | --- |
| `shared/task-contract.js`、`project-contract.js` | ID、命令、节点、task/step/group、项目契约和定位 |
| `shared/collection-identity.js` | 按编号合并角色/服装、替换镜头并保留已有 ID，核对删除引用 |
| `shared/node-state.js`、`node-dependencies.js` | 显式节点状态、有效输出校验、保留正文的过期传播 |
| `shared/task-plan.js` | 固定步骤；不自动安排上游任务 |
| `server/model/project-model.js` | 深拷贝读取与唯一事务提交入口 |
| `server/data/model-repository.js` | SQLite 存储、幂等受理、事务、不可变终态、变化事件 |
| `server/data/task-store.js` | 任务与组合任务只读视图 |
| `server/flow/tasks/task-service.js`、`precheck.js` | 项目串行、组合顺序、两轮修订、取消/中断/继续及执行时前置核验 |
| `server/handlers/` | 文本、媒体、人工、删除业务；返回内容，不自行结算任务 |
| `server/prompts/yaml-prompts.js` | 唯一 YAML 加载、结构校验、占位资料替换和自然语言渲染 |
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

`projects/<p_UUID>/` 仅作为宿主工作区目录。此次切换按用户要求删除旧项目及任务历史，不迁移、不提供迁移脚本或双写。首次启动自动创建数据库；发现未清理的 CURRENT 分代数据时明确拒绝启用。独立素材库和模型配置保留。

项目、剧集、角色、服装、镜头、规则、任务、组和步骤使用创建时生成的带前缀 UUID。AI 输入输出及资料界面使用编号，引用转换由程序核对唯一性和归属。重生成保留同一对象 ID，不按列表位置重建身份、不无声删除引用对象。独立素材继续使用原 `assets/<category>/<UUID>/metadata.json` 和 `original.<ext>` 文件格式；场景、道具及指导素材入口退出，但磁盘数据不会在启动时被删除。

旧项目/旧会话不迁移、不适配。旧项目目录名称可以出现在片库拒绝提示中，不读取旧正文；只允许用户显式删除。历史任务保留原 ID 和执行时资料，不能按当前项目资料重建历史请求。

## 状态、前置和任务

- 8 种节点状态为 empty、queued、running、generated、rejected、failed、cancelled、expired，原因和状态一同提交；剧本没有节点状态。
- 入队保存原状态/原因；排队取消或作废恢复快照。上游变化同步更新排队快照中的 generated→expired。正文和媒体地址保留。
- 仅 generated 且结构有效的节点可作为前置。执行时重读当前 Model；不足记录 failed/precheck，不调用 AI，不自动补上游。
- 剧情生成/重新生成：剧本模式只要求非空剧本，自由创作模式只要求非空 AI 创作方向；项目摘要不作为前置，也不注入剧情生成、修订或审核提示词。
- 单任务针对一个节点操作；文本 precheck→generate→review，最多两轮 revise→review；协议/结构/网络错误 failed，合法草稿审核耗尽 rejected，保留草稿与旧历史。自由创作剧本只在审核通过后发布版本。
- 图片/视频 precheck→generate；尾帧/合片也是独立媒体任务。人工编辑与 override 均为两步，不调用 AI；override 只允许结构有效的 rejected 文本。
- 删除任务 precheck→impact→apply。被本集资产、出镜/对白、规则或素材库引用的角色不能删除；默认/素材库引用服装不能删除；其他服装删除同次重绑为默认并使相关视频过期。
- 项目内执行串行；完成后自动下一项；failed/rejected/cancelled 停止队列。面板再次生成最新任务为失败、未通过、取消或作废的同一节点时，创建新任务并保留旧终态；`generate` 自动按 `regenerate` 通过前置检查。若该重试已排队则复用；无其他未结束任务时直接启动；有其他等待/运行任务时明确冲突，不误启动其他任务。开始/移除排队项、人工操作与删除只能从面板发起。
- 服务重启把所有 queued/running 旧任务统一结算为 superseded（已作废），未完成步骤同样作废，已完成步骤与历史终态保留；排队节点恢复快照，运行节点结算 cancelled 并保留内容。重启清除 queue_stopped，旧任务不重放，新任务可直接执行；晚到结果不得覆盖作废任务。
- 面板提交拆分剧集会直接恢复并执行该拆分（已有排队拆分复用）；存在其他未结束任务时明确拒绝，不带起其他暂停任务。面板同节点重试遵循相同直启规则；会话提交和其他普通提交仍遵循暂停队列规则。
- 成片使用 episode-film，按镜头表顺序逐镜 seconds（生成/审核/修订）→storyboard→video→tail；可选 shot_id 限定单镜，镜头必须属于指定剧集，opinion 保存到组内任务。episode-seconds 保留单项及历史契约，不再有独立标签入口。组合整组受理，冲突整组拒绝；停止后后序 superseded，继续新建组并保留旧终态。跳过有效节点时也计算上游重生成将造成的下游过期。
- 每镜视频完成后记录 FFprobe 实测的实际时长秒（保留一位小数），人工导入视频同样测量；镜头表时长秒作为参考预算不变。现有未测量的镜头暂不展示实际时长，不追溯重写已有媒体。
- 每次独立操作创建 single 组；角色提取、剧本生成创建 workflow 组，派生图片/摘要按 group_seq 追加到同组。父任务已完成不因子任务失败被改写。task/group/step 创建时保存 name，后续资料改名不改历史；已有记录缺名称时只读补显；持久化任务必须有父组，运行时不创建虚拟组。
- 任务历史以组为列表入口，组内直接排列各任务全部步骤。组状态只读聚合，部分完成加其余作废显示已作废；继续创建新组并链接原组，旧历史保留。人工/删除任务从原入口重新操作，不提供通用组继续。
- 按项目数据结构的过期表传播。拆分剧集整表替换剧集，不把旧节点标为过期。输出语言、画幅、规则、声音、默认服装配置只影响后续步骤，不使已有资源过期。面板修改必出会使角色图片过期；角色提取写回时必出变化不使图片过期。
- 每秒分镜的对白保存 `说话人id` 和 `说话人名称`；未建卡人物/独立旁白保留原称谓和空 id，不自动建卡。

## 提示词与网关

全部生产、审核、修订正文和输出结构来自 `dev_docs/in_puts/*.yaml`。`mark` 不进入请求，输出格式只在 system，user 的任务是模板固定正文。占位符缺失直接失败；注入资料不二次展开。规则以范围、适用业务、类别、必须/参考组织，配置变更不追溯改写历史。

文本返回按 JSON 解析并严格校验 YAML 键与类型，然后核对时长、覆盖和编号引用；不通过结构校验的结果不会覆盖节点。图片每次最多一张参考图，不附角色声线。视频最多九张角色/服装参考图，后续镜头使用前镜尾帧及交接资料；远端 ID 在提交后记录。

文本协议以[下游接入接口文档](../下游接入接口文档.md)第 4 节为准：`POST /v1/chat/completions` 使用 model/messages/stream=false，不发送未声明的 response_format；JSON 输出由 YAML 提示词要求和本地校验保证，不使用网关 JSON 模式替代校验。

当前网关图片协议为 `images/generations` 或 multipart `images/edits`；视频为 `videos` 提交、状态轮询与 content 下载；文本使用 chat/completions。沿用实际网关的地址和参数，不依赖旧 README 所述异步图片取消协议。网关不提供远端视频取消接口：取消停止本地等待并阻止晚到结果提交，如实保留远端可能继续运行的原因。新增视频/合片在本地保持比例缩放并填充到项目画幅的像素尺寸，保留音轨；网关请求仍使用兼容尺寸，旧媒体不追溯改写。生成文件须通过 FFprobe 及 FFmpeg 完整解码；不能只根据扩展名或 HTTP 成功判为有效。

配置为运行目录 `models.json`，默认值来自 `config/models.json` 和被忽略的 `config/models.local.json`；测试覆盖使用 `MEIJI_MODELS_LOCAL`。密钥不得写入 Git、浏览器响应或日志。聊天模型通过公开 credentials/settings 同步，制作模型由网关直接调用。

## 双端与通知

三个工具为 meiji-context-query、meiji-project-command、meiji-task-command。HTTP 使用 `/api/meiji/` 的 context、project-command、task-command、events、media、library、models；写入校验宿主登录、同源标记和会话/项目绑定。不存在旧 run/operation 端点。

通知以稳定消息 ID 保存 outbox，并使用公开 `sessionController.resolveAgent` 和 `session.append(command/run、command/done)` 显示提示卡；不进入模型上下文、不唤醒 AI。会话断开/通知失败不撤销业务受理，返回 task/group ID 与独立通知错误，之后恢复时重试同一消息。投递期间新增通知继续在同次 drain 中处理。

面板上下文按 epoch、session、project、revision 拒绝晚到和乱序响应。切换不取消后台任务，卸载关闭订阅与计时器。状态直接读取 Model；运行中冻结编辑与生成，查看及取消仍可用。保留项目概要、角色与服装、设置、历史、素材库；剧集五个标签为剧情、本集资产、镜头表、成片、合成。成片镜头详情顺序展示每秒分镜、文本提示词、视频、尾帧，视频生成/重新生成按钮提交单镜完整成片组。删除场景、道具、技能、预览授权及续旧任务入口。

## 验证与运行

- 根目录：`cd meiji && npm test`；单阶段：`node --test tests/stage0N-*.test.js`。
- 测试从本次八阶段设计重新创建。HTTP/DOM/生命周期使用隔离 home；网关协议使用 mock，FFmpeg 使用真实临时文件。生产网关和真实 Harness 走查证据单独记录，不能混称自动测试全部覆盖生产模型质量。
- 收尾执行 `git diff --check`、入口依赖/旧文件检查、必要 shell 语法检查，再更新图谱。
- `configure-harness.sh` 链接插件并启动；`restart-harness.sh` 验证进程归属、停止旧实例并确认端口释放后启动；不自动执行迁移。端口被非预期进程占用或旧进程不退出则拒绝启动新实例。
