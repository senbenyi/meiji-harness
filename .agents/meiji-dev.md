# meiji 开发指引

Meiji 是 DeepSeek Harness 外部插件。开发流程引用 [AGENTS.md](../AGENTS.md)。修改代码、配置或测试前必须完整阅读[制作工作流](../meiji/dev_docs/制作工作流.md)，作为当前业务规格入口；普通咨询和只读调研不要求通读。历史计划和实施记录只供追溯，不覆盖当前工作流。

逐镜节拍、视频类型编排及尾帧处理已接入；接口见[视频接口与成片编排设计](../docs/implement/1016-视频接口与成片编排设计.md)。角色子代理调度仍待后续明确。

## 项目配置

- 代码、配置、skill 和测试范围为 `meiji/`；计划使用 `docs/plans/MMDD-计划-*.md`，完整实施记录使用对应的 `docs/implement/MMDD-实施-*.md`。
- `meiji/docs/`、`meiji/reports/`、`meiji/dev_docs/` 和其他纯文档修改按文档流程处理，不要求开发计划。
- 不修改上游 Harness 源码。数据根为 `$DSH_HOME/storages/meiji/`，未设置 DSH_HOME 时为 `~/.dsh/storages/meiji/`。
- 同一个 DSH_HOME 只运行一个写入服务实例。项目级事务与制作任务串行；不同项目可独立运行。
- GitNexus 仓库名为 `meiji-harness`，索引放在 `$HOME/.gitnexus/indexes`。根目录执行 `node .gitnexus/run.cjs status`；更新执行同一 runner 的 `analyze --index-only`。索引符号身份异常时使用 `--force` 全量重建。MCP 可用时优先使用，UNKNOWN 必须补查实际源码与动态注册。
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
| `server/flow/tasks/task-manager.js`、`precheck.js` | 项目串行、组合顺序、按节点重试轮次修订、取消/中断/继续及执行时前置核验 |
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

`projects/<p_UUID>/` 作为宿主工作区目录，同时保存 `project.json` 项目镜像。项目 Model 存在 SQLite 的 `projects.data_json`，使用 `shared/models/*_model.js` 固定字段及 `node_state.{status,reason,fail_message,dependency_hash}`。当前 schema v21。v21新增项目共用场景库、剧集场景选择节点和镜头场景绑定；缺绑定的旧镜头表及下游过期，正文、媒体与历史保留。v20将旧character_binding移入镜头on_screen_characters，增加background_characters，旧镜头表及下游生成态过期，保留媒体/历史；退役识别任务不能恢复执行。v19 移除正式角色和服装资料的 number，保留原ID、媒体及绑定；按ID输入投影重写已生成节点依赖指纹，历史任务提示词与结果不改。剧本本身是节点（`script.node_state`）：v16–v18 归一为该形态，早期 v16 的独立 `script_review` 并入剧本状态，v17 的 `script.review` 结论字段移除，保留状态、原因与依赖指纹；更早版本的迁移在校验前同样先归一。v14 移除项目暂停字段；v15 将节点执行状态显式迁移为四种数据状态，保留正文、任务历史及审核原因，无法确认有效性的数据标为 expired。v9 删除项目 rules，v10 删除项目 output_language；两步都按新指纹重写已生成的角色识别、每秒分镜和文生提示词及其排队快照，不改写正文。v11 把失败节点的 `reason` 移到 `fail_message`。v8 及更早明确拒绝，不在运行时自动删除或兼容。模型配置和独立素材库保留。

项目、剧集、角色、服装、镜头、任务、组和步骤使用创建时生成的带前缀 UUID。角色和服装的AI输入输出、界面与正式引用统一使用创建时唯一ID，程序核对唯一性和归属；仅镜头保留S编号。重生成保留同一对象 ID，不按列表位置重建身份、不无声删除引用对象。独立素材继续使用原 `assets/<category>/<UUID>/metadata.json` 和 `original.<ext>` 文件格式；独立素材库的旧场景、道具及指导素材入口退出，但磁盘数据不会在启动时被删除。v21的项目场景库是制作资料，不恢复旧独立素材入口。

旧格式项目/旧会话不迁移、不适配。旧项目目录名称可以出现在片库拒绝提示中，不读取旧正文；只允许用户显式删除。历史任务保留原 ID 和执行时资料，不能按当前项目资料重建历史请求。

项目Model每次事务提交后，以临时文件原子替换 `projects/<项目ID>/project.json`，内容为完整project对象（不含任务/步骤/运行时或模型连接配置）。SQLite仍为唯一数据来源；启动从数据库补齐或修复镜像，删除项目一并删除。数据库回滚不发布JSON；数据库已提交而镜像写入失败时，更新返回storage_warning，内存仍保持已提交内容，幂等重试和重启可以修复。JSON不是反向导入入口。

v13迁移保留旧正文和历史，将缺交接的生成态每秒节点及相关下游标为过期并同步排队快照；按镜头顺序重生成。

task/group/step 创建时保存 name，后续资料改名不改历史；已有记录缺名称时只读补显；持久化任务必须有父组，运行时不创建虚拟组。角色新增明确服装后，原未绑定图片及其终态历史保留，只读展示，不加入新生成组。

## 状态、前置和任务

节点与任务状态、动作、步骤和任务组字段见 [step_model.md](../meiji/dev_docs/step_model.md)；制作顺序、审核与修订流程、项目执行与取消、删除规则和面板按钮见[制作工作流](../meiji/dev_docs/制作工作流.md)；各节点前置、重试与审核开关见 `shared/node-definitions.js`，依赖与过期传播见 `shared/node-dependencies.js`。本文不复述。

## 提示词与网关

规则唯一来源：发给 AI 的节点规则只写在 `meiji/server/prompts/models/<节点>.js`，多节点共用的句子在同目录 `common.js`；同一节点各动作引用文件顶部的 `generateRules`，不逐动作复制（`tests/stage30-rule-source.test.js` 守护）。输出契约只写在 `server/http/nodes/<节点>.js`，video 面板规则在其 `rules` 字段。单个节点的前置、重试、审核开关、依赖与保存以代码为准（`shared/node-definitions.js`、`shared/node-dependencies.js`、`server/http/nodes/`），不另写节点文档。`meiji/dev_docs/` 只给开发者阅读，程序代码不得读取（同一测试守护）；各类内容的唯一位置见制作工作流「文档」表。改规则时改所属位置的原文，不在文末追加补丁段落，改动经过写入 `docs/implement/`。

业务流程以制作工作流、step_model、project_detail 为开发依据；`server/http/nodes/` 按节点和动作定义业务输入与输出格式，提示词渲染、模型返回校验及人工编辑共用输出契约。`server/prompts/models/` 保存生成、审核、按意见重新生成要求，节点文件的 `compose` 编排该节点业务参数；视频使用 `http/video-request.js` 直接编排已审核三段，无 PromptModel，`render.js` 渲染正文。输出格式只在 system，user 的任务是 Model 固定正文。占位符缺失直接失败；注入资料不二次展开。配置变更不追溯改写历史。

文本按对应节点声明解析：项目/剧集摘要为纯文本，人物和切点等按 JSON 结构校验；分镜提示词保留其既定段落协议。可解析 JSON 缺少必填字段时由程序审核判 rejected 并按既有轮次修订，原始候选留任务历史；耗尽后保留旧正式内容和 hash，仅写节点未通过及原因。不属于缺字段的 JSON 结构/解析错误仍 failed 并保留旧内容；网络、接口异常仅记失败，不自动带入提示词；可用候选的业务审核未通过时按节点轮次修订，耗尽后将最后内容及 rejected 原因存正式节点，不刷新 hash、不传播、不派生。图片每次最多一张参考图，不附角色声线。视频最多九张角色/服装参考图；仅首尾帧类型使用前镜尾帧，节拍文本继承前镜交接资料。生成与下载阶段均保留HTTP详情。

文本由 `shared/models/settings_model.js` 的 SettingsModel 固定选择：独立 llm-server 提供的 `qwen3.5:27b` 或 `codex-gpt`。图片可选krea2 turbo V2.5或gpt-image；视频固定为MiniMax-H3，旧配置elysium-video映射到该模型。`elysium-chat`、`elysium-image` 已移出选项，保存或读取时按无效模型拒绝；旧配置用迁移脚本改为默认值。选择 Qwen、Codex 文本或 `gpt-image` 时，`textBaseUrl` 独立于媒体 `baseUrl/apiKey`。`POST /v1/chat/completions` 使用标准 messages、stream=false（生成/审核为 system/user，文本修订为 system/user/assistant/user）；Qwen 的 reasoning_effort=none、temperature=0.7、top_p=0.8、presence_penalty=1.5 默认参数已迁到独立 llm-server；不发送 max_tokens，不配置聊天 maxTokens；不发送 response_format 或不支持的模板参数。JSON 输出由节点路由契约注入提示词，并按同一契约进行本地校验。文本渲染追加资料边界与最终输出约定，图片/视频渲染保持原样。官方依据与隧道操作见 [README](../meiji/README.md)。

当前媒体接口按模型分派：gpt-image调用images/generations，krea调用images/comfy，MiniMax-H3调用videos/generations等待成功URL后下载；均为本机服务。参数、素材与取消边界以视频接口设计为准，不再使用旧网关视频提交/轮询/content协议。新增视频和合片按项目像素归一化、保留音轨，文件经FFprobe及FFmpeg解码校验。

配置为运行目录 `models.json`，默认值来自 `config/models.json` 和被忽略的 `config/models.local.json`；测试覆盖使用 `MEIJI_MODELS_LOCAL`。已有配置须显式运行 `meiji/scripts/migrate-settings-model.js`，先备份、保留连接与并发设置、将 chat/story 合并为 text，不在固定选项内的选择改为默认值，不用运行时旧配置兜底替代迁移。密钥不得写入 Git、浏览器响应或日志。设置页只显示语言与模型选项，选择自动保存，且不依赖已打开的项目。语言保存在 output_language，模型选择保存在 text/image/video.model；两者只作用于之后的生成。缺省语言为 zh-CN。聊天通过公开 credentials/settings 同步选中服务；Qwen 使用 ollama 与上下文 32768，网关使用服务端密钥与接口文档声明的 65536。`gpt-image` 走本地 `POST /v1/images/generations`，占位密钥 `ollama`，`size` 为 `auto`，画幅写入提示词；krea经本机images/comfy；MiniMax-H3经本机videos/generations。设置 API 仅公开和接收选择，不公开连接地址与凭据。

文本重新生成 task.action=regenerate 首轮调用 generate，仅 system/user，不带旧结果；本次意见作为生成要求。原结果修订 task.action=revise 必须有意见，单个文本节点可用，多轮 system/user/assistant/user；自动 revise 步骤同样多轮并使用本任务最近候选。公共文本节点已有结果且没有未结束任务时展示原结果修订，不限未通过状态。

Codex 制作模型：`codex-gpt` 使用本地 textBaseUrl 和 llmServerClient，但提示来源为 codex，首条为 developer，背景 JSON 放末尾；原结果修订保留 assistant 历史。设置选择 Codex 时 syncChatModel 不修改 Harness 工具会话，避免把工具流量送入纯文本桥接。图片 `gpt-image` 使用同一本地地址的文生图接口，不改变文本编排。llm-server 使用官方 App Server 的 ChatGPT 登录和 ephemeral 会话，测试及实施见 `docs/implement/1015-实施-GPT-Codex接入.md` 与 `docs/implement/1015-实施-GPT文生图接入.md`。

镜头表的可解析JSON在shots[]及内部对象出现未知字段（如reference_anchor.body）时，也沿用已有结构修订通路与两次预算，保留原候选；不静默搬移字段，不将该规则扩大到其他节点或根响应未知字段。出镜人物与服装使用分组DOM，服装与描述归属对应人物，ID存储结构不变。

修复链路公共规则见制作工作流：结构化上游问题停止下游自动修订；同一候选重复同一确定性程序错误提前结束，AI同文拒绝只加定向反馈。镜头修订优先按ID的mode=patch，增删拆并重排需显式mode=replace完整表，合并后再全表校验。明确对白和最终<d>序列做逐字检查，不按字数推算时间。以上提前结束保留旧正文与hash，候选及诊断留步骤历史，原有修订上限不变。

视频固定MiniMax-H3，发送到本机textBaseUrl的`/videos/generations`；编排与发送共用videoPayload。首尾帧用前镜尾帧作first_frame且ratio=adaptive，多模态按images顺序注明人物/稳定speaker_tag/服装。实际发送已保存编排正文，发送前核对三段与当前已审核正文一致。新HTTP使用duration/resolution/ratio而非内部兼容seconds/size。设计与验收限制见[视频接口与成片编排设计](../docs/implement/1016-视频接口与成片编排设计.md)。

同任务自动修订使用最近一次已完成生成或修订的原始返回；跨任务修改使用当前节点内容。基稿只在 assistant 出现一次，本轮意见只在最后 user。system 只保留规则、语言与输出格式，不再附加角色声明。提示词详情按实际 messages 顺序展示与复制；已有历史只读展示原记录。

待审核对象按完整JSON传递，保留空字符串、空数组、空对象和嵌套空值。空交接项表示无待续事项，不得在章节渲染时省略为缺字段。提示词模板的空补充要求仍可省略；候选内容与模板标题采用不同处理。

镜头表局部修订：生成仍返回完整shots。原结果修订及自动修订优先返回 `{"mode":"patch","shots":[{"id":"原镜头ID","changes":{"body":"新正文"}}]}`。程序从当前完整基稿按ID覆盖指定字段，未返回字段/镜头保持，合并后继续执行完整结构、角色服装、时长和AI审核。嵌套对象修改需提供该嵌套对象完整值。patch不能改ID、删除镜头、增加未知字段或重复ID；空patch表示无需修改。

需要新增、删除、拆并或重排镜头时，显式返回 `mode=replace` 和完整shots；无mode的片段不得隐式删除镜头。旧协议全表在镜头ID和顺序不变时仍可接受。请求/响应保留原patch，步骤result与后续审核使用合并后的完整候选。错误patch的下一轮修订仍读取完整基稿，不把错误片段当整表；取消或审核前停止不发布候选。

参考图以 data URL 放入 `images`，最多 5 张；定妆照节点仍最多一张。返回的 PNG 在 `data[0].b64_json`。Codex 订阅登录、默认可用模型、取消与超时由 llm-server 负责，应用不保存 Codex 登录令牌。文本输入与hash共用shared/shot-text-inputs.js，图片不影响文本。

## 双端与通知

三个工具为 meiji-context-query、meiji-project-command、meiji-task-command。HTTP 使用 `/api/meiji/` 的 context、project-command、task-command、events、media、library、models；写入校验宿主登录、同源标记和会话/项目绑定。AI 节点使用同一套 `/api/meiji/ai/<node>/<action>` 路由，query 的 session_id/project_id 通过绑定校验，正文只包含节点业务参数；返回候选，不直接写正式项目。任务 Handler 在进程内调用相同节点执行函数。不存在旧 run/operation 端点。

通知以稳定消息 ID 保存 outbox，并使用公开 `sessionController.resolveAgent` 和 `session.append(command/run、command/done)` 显示提示卡；不进入模型上下文、不唤醒 AI。会话断开/通知失败不撤销业务受理，返回 task/group ID 与独立通知错误，之后恢复时重试同一消息。投递期间新增通知继续在同次 drain 中处理。

面板上下文按 epoch、session、project、revision 拒绝晚到和乱序响应。后台标签页关闭 Meiji EventSource 并暂停刷新；重新可见时获取最新数据、恢复唯一订阅，卸载移除可见性监听。切换不取消后台任务，卸载关闭订阅与计时器。App 重新挂载时，首次快照中的当前项目运行和排队任务通过现有 cancel 命令取消；Model 结算并中止请求后重新读取再渲染，取消失败不伪造状态且允许再次刷新重试。并发首次刷新共享取消，普通刷新与可见性恢复不重复执行；全部未结束任务记为已取消，当前数组清空。此为服务端支持任务缓存恢复之前的临时策略。状态直接读取 Model；运行中冻结编辑与生成，查看及取消仍可用。保留项目概要、角色与服装、设置、历史、素材库；剧集四个标签为剧情、镜头表、成片、合成。镜头表直接读取项目角色库，不设本集人物资产节点。成片镜头详情只读展示镜头表出镜人物/服装及群演，执行每秒分镜、文本提示词、视频类型和适用参数编排；视频卡内显示只读尾帧，视频生成/重新生成按钮提交单镜完整成片组。删除场景、道具、技能、预览授权及续旧任务入口。

## 验证与运行

- 文本请求总时限与底层 HTTP 响应头/响应体超时为 60 分钟，请求级 dispatcher 透传宿主代理；GPU 浏览器/代理/SSH采样超时同为60分钟，5秒轮询间隔不变。

- 面板顶部导航“片库”前以 `GPU：30%` 展示 GPU 指标，通过已登录的 `GET /api/meiji/gpu` 代理 `textBaseUrl/gpu`；只使用 llm-server 的占位凭据，不传媒体密钥。可见时立即读取并每 5 秒轮询，隐藏/卸载中止请求、清理定时器；失败显示暂不可用，不影响项目刷新和任务状态。远端采样及 5 秒缓存由 llm-server 负责。

- 根目录：`cd meiji && npm test`；单阶段：`node --test tests/stage0N-*.test.js`。
- 测试从本次八阶段设计重新创建。HTTP/DOM/生命周期使用隔离 home；网关协议使用 mock，FFmpeg 使用真实临时文件。生产网关和真实 Harness 走查证据单独记录，不能混称自动测试全部覆盖生产模型质量。
- 收尾执行 `git diff --check`、入口依赖/旧文件检查、必要 shell 语法检查，再更新图谱。
- `configure-harness.sh` 链接插件并启动；`restart-harness.sh` 验证进程归属、停止旧实例并确认端口释放后启动。SQLite schema 升级由数据库启动事务自动执行；端口被非预期进程占用或旧进程不退出则拒绝启动新实例。
