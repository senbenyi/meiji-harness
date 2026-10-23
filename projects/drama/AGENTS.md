# drama 开发入口

- 遵守根 `AGENTS.md` 与 `.agents/agent-harness-dev.md`。
- 当前架构见 `docs/开发方向.md`；项目结构说明见 `docs/project_detail.json`，程序不得读取该文档作为运行时模板。
- 业务代码放 `src/`；公共规则与状态分别使用 `@agent-modules/prompt-composer`、`@agent-modules/task/models`。不导入 meiji 业务模块。
- 项目 JSON 经 `ProjectManager` / `ProjectModel.update()` 写入 `$DSH_HOME/storages/drama/projects/<id>/project.json`；工作区/会话及创建请求索引单独保存于 `bindings.json`。
- 根运行 `npm run test:drama`，跨插件/工程集成执行 `npm test`；计划和实施记录沿用根目录。
- GitNexus 使用根指引的 `agent-harness` 仓库配置；当前 MCP 注册名为 `meiji-harness`，CLI 使用 `.gitnexus/run.cjs`。

- 每次从 meiji 复用界面或业务代码，必须将实际源码复制到 drama，再改成 drama 内部依赖并独立维护。禁止引用、转发导出、运行时读取或符号链接到 meiji；meiji 也不得反向引用 drama。共享能力只能通过根 `packages` 的公开接口接入。

- 会话共享工具与项目创建/剧本优化指导在 `src/session/index.js`，通过包的 `./session` 导出注册；主Agent调用的Tool统一放在 `src/tools/`，Service、执行器及盒子内部代码归入 `src/node_box/<盒子名>/`；项目管理服务为 `src/node_box/project/service.js`，创建执行器为同目录 `executor.js`；剧本优化服务为 `src/node_box/script_revision/service.js`。面板和Tool直接调用对应盒子Service，跨盒子共用 `src/project_runtime/write_queue.js` 的一个队列实例。

- 剧本优化入口为 `src/tools/optimize_script_tool.js`，执行器为 `src/node_box/script_revision/executor.js`；运行用独立有界模型请求，生成/本地审核/修订使用文本模型，项目审核使用主Agent模型。

- 故事大纲入口为 `src/tools/generate_story_outline_tool.js`，Service/Executor位于 `src/node_box/story_segments/`；面板及会话共用生成入口。输入为basic_info（仅actual_script/summary/estimated_duration_seconds）、current_outline、instruction、output_language，与规则中的basic_info.actual_script路径一致。优化剧本可选，有工作稿即可生成。完整集合严格校验且拒绝空集合、重复段/锚点ID，每次结构有效的生成/修订立即替换segments并同步Task；本地内容问题最多修订3轮，失败/取消保留最新已保存结果与各轮记录。意见、规则、记录、结束摘要、下游过期及专属UI见开发方向“故事大纲生成”。

- `src/harness_server/` 只提供harness-http路由、认证、静态资源和SSE，不承载盒子业务。根插件组装项目管理、剧本优化服务及共享记录；不设顶层service转发层，也不保留旧目录代理。HTTP分类和记录归属统一遵守根开发指引的“HTTP术语与记录归属”。

- 项目管理专属的输入字段、创建和编辑/导入校验分别在 `src/node_box/project/create_project.js`、`edit_project.js`。`src/project_runtime/`保留整个项目共享的Manager、Model和写入队列；其中 `project_manager.js`、`project_model.js` 不随盒子迁移。节点专属界面归 `src/node_box/<节点>/ui/panel/`（右侧面板）与 `ui/conversation/`（会话）；公共组件、样式、全局片库/设置与历史适配归 `src/client/ui/`。`src/client/` 保留工作台、项目视图/阶段编排及会话挂载控制器。服务端Schema和校验不当作UI迁入。

- 各AI节点的字段契约由 `src/node_box/<节点名>/definition.js` 独立维护；`src/node_runtime/node_definition_registry.js` 仅汇总，维持节点名和JSON Pointer。Schema工具在 `src/node_runtime/schema_builders.js`，通用审核与图片返回约定在 `shared_output_contracts.js`。定义文件只能依赖共享工具/契约，不导入汇总、Service或Executor；暂未实现的节点只有定义不代表可执行。

- `src/project_runtime/` 是整个项目共用的运行基础层，区别于业务盒子 `src/node_box/project/`；输出结构展开及规则引用渲染位于 `src/node_runtime/output_contract_renderer.js`。公共 `./project` 导出和实际项目数据存储路径不因源码目录改名而改变。

- 节点共用运行机制统一在 `src/node_runtime/`，职责与文件名见 `docs/开发方向.md` 的“节点运行层”；`node_initializer.js`初始化空节点，`output_response_parser.js`解析校验实际响应，`output_contract_renderer.js`选择/展开输出结构并渲染规则。`src/node_runtime/node_prompt_composer.js`继续负责提示词组装，不将这些机制复制到盒子或公共包。

- 盒子步骤结束后将完整结果写入任务固定所属会话，仅展示、不进入模型上下文。审核有问题显示红色“未通过”，保留每轮修改及复审；面板受理、各步骤和盒子终态各用稳定ID去重。面板操作统一展示请求、聚合执行组及最终保存结果，空/正常会话复用client/ui/task-operation组件，失败终态单独挂载client/ui/failure-decision卡片，显示真实保存事实与用户操作；正常会话附加于对应原生command公开座位并仅隐藏本组原生展示，不伪造聊天轮次。盒子输入取metadata.input_snapshot，步骤输入取step.prompt.input；完整内容随会话首次加载预载，eager/after轮询只补新增详情及pending任务终态；展开优先同步使用缓存，compact消息列表不携带正文/规则/输出，历史不读取最新项目补造。展示和主Agent通知独立持久化与重试：成功/取消不唤醒AI，最终rejected/failed才发drama-box-report规划消息，但终态content_issue或执行failed只展示并等待用户选择继续修改、停止或重新生成，不唤醒主Agent；中间审核失败仅展示。不创建任务专用或失败兜底会话；创建尚未产生项目会话时归来源会话，创建成功后归项目会话。详见开发方向“面板任务与会话交接”。

- 原稿展示摘要由项目盒子summary_extractor.js一次llm-http提取：创建有稿/导入后执行，无稿跳过，无审核或自动修订；按project/definition.js契约保存basic_info.summary及estimated_duration_seconds，创建状态使用basic_info.create_project_node；失败仅警告、不撤回主操作。优化稿继续随正文返回摘要和估时，并在审核通过后同步到basic_info，不新增摘要调用。

- 盒子执行边界：Service创建/提交Task并返回结果；Executor注册节点、声明/追加Step并使用执行上下文记录提示词和调用；公共TaskManager统一写状态、时间与步骤结果，双方不直接写任务数据库。一次业务盒子执行一个Task，内部修订追加Step，重新派发才新建Task；TaskGroup只是任务组织容器。项目盒子的ProjectExecutor与创建程序子执行器位于project/executor.js，Service仅提供受理及数据读写能力。

- 原稿入库及沙盒来源文件由project/script_files.js维护；创建和导入保留原始文件名并自动入素材库，basic_info.original_script_file_path只保存沙盒相对路径，正文初始化basic_info.actual_script。后续生产和按意见优化统一使用当前工作正文，不回读原文件作为模型输入。原始查看由鉴权harness-http读取项目内文件，禁止任意路径读取。

- 项目实例不保存output包装；AI意见、动作规则、补充能力集中于node_state.opinion/rules/supports_supplement。剧本优化状态在basic_info.script_revision_node，其余生产节点使用各自node_state；公共RulesModel通过node_runtime/node_state.js的nodeRules适配。
- 优化的每次有效输出自动提交actual_script、summary、estimated_duration_seconds并记录Task；审核失败/取消保留最新已保存结果，不撤销写入。保存与审核通过独立，只有审核通过才清除对应意见。last_execution以Task终态为事实，经node_runtime/execution_state.js统一投影并共用项目写队列落盘，读取时补齐遗漏摘要。轻量轮询接口为harness-http的/api/drama/node-states；完整加载仍使用project接口。

- 会话项目归属由ProjectService.projectIdForSession统一判断：保留显式绑定；宿主刷新恢复同项目工作区另一会话时，基于workspaceRegistry公开成员关系和已完成项目登记的工作区ID/path解析，不按名称猜测，不关联未完成/删除项目。snapshot、编辑、删除、优化共用该判断，同工作区SSE更新亦可同步。

- 删除项目完成后，使用项目请求行持久化的deleted_session_request_id接续startSession，创建/复用独立cwd且不关联任何项目或项目工作区的空会话。面板切换到返回会话；创建失败仍保留删除事实并提供同请求重试。删除失败不建会话；用户已切换时不抢切。旧会话、文件和执行记录保留。

- 节点UI通过 `src/client/ui/node-registry.js` 注册 panel/conversation；业务输入、结果和操作归节点，共享时间线、审核状态、loading、折叠、复制及未知类型完整记录兜底归公共层。节点UI只能依赖浏览器可用代码，不导入Service、Executor或服务端定义。历史投影为各节点ui/conversation/history.js中的纯函数，经公共task-presentation适配供浏览器/会话记录复用。生产节点未接执行器时，展示已有数据不代表可执行；没有现成UI的图片节点不建空占位模块。浏览器资源在harness_server/client_assets.js逐文件登记，沿用鉴权，不开放node_box服务端源码。

- 原生侧栏全局新会话在Drama挂载期间走独立startSession入口，不复用当前/最近项目工作区。仅限定公开可访问名称的原生新建按钮，保持业务创建与工作区内加号；快速连点合并、失败同请求重试、成功后再次点击新建；切换/销毁后迟到结果不抢切，卸载解除监听。不创建业务项目、不改宿主源码。

- 创建交接通过project响应头游标接续SSE，校验来源和导航后立即切换，迟到快照不抢切。模型响应先严格解析，仅在失败时无损归一化字符串内部原始LF/CR/TAB，再严格解析及Schema校验；保留原始调用记录，不补结构或字段。详见开发方向“创建交接与模型响应解析”。
