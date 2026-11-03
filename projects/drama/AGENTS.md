# Drama 开发入口

遵守根 `AGENTS.md` 与 `.agents/agent-harness-dev.md`。使用中文；计划和实施记录放根 `docs/plans`、`docs/implement`。

## 当前改造边界

- 用户已确认清空全部旧Drama业务数据，不考虑迁移。新入口仅使用V2，不增加旧数据兼容、双写或迁移层。模型配置、宿主凭据和其他业务项目不在清理范围。
- 当前已接通V2全部制作阶段、共享图片库、原生工具循环与真实媒体剪辑/导出。阶段计划见根 `docs/plans/1028-计划-完整制作流程与左侧步骤面板.md`；最终业务方案见 `1028-计划-剧本到视频与共享图片库.md`。
- 当前数据契约、人工编辑矩阵和限制见 `docs/项目数据契约.md`。`docs/project_v2.schema.json`、`project_v2.example.json` 是文档快照，运行时不能读取文档作为模板。
- `docs/开发方向.md` 维护当前目录职责；`docs/project_detail.json` 是带中文字段说明的V2 Schema。V1入口、旧盒子和专属测试已清理，不重新注册。

## 新入口与分层

- 插件 `index.js` 组装 `ProjectWorkspaceService`、公共记录、设置和路由；`src/main_agent/session/index.js` 注册当前可执行工具，不向主Agent注入已退役节点指导。
- `src/project_runtime/project_document.js` 维护运行Schema和结构/引用校验；`project_document_store.js` 保存V2与不可变文件；`project_workspace_service.js` 提交Task、维护工作区/会话和请求幂等。
- `src/node_box/project/runtime/executor.js` 执行创建/导入/人工编辑等程序步骤，`src/main_agent/tools/project/fields.js`声明创建工具入参，创建工具与参数同属main_agent/tools/project，实际执行器仍归盒子，`ui/panel`保留共用项目弹框及原稿导入。Service创建/提交Task；Executor执行步骤；公共TaskManager负责状态、时间和任务数据库，不直接写Task表。一次业务操作一个Task，内部重试追加Step。
- `src/shared/production/production_stages.js` 是浏览器/服务端共用的阶段目录与产物投影。各步骤由ProductionService按executor_registry选择文本、图片、视频或程序执行器；不得将展示数据冒充实际生成结果。
- `src/node_box/`包含与十二阶段同名的十二个盒子及盒子专用共用目录`shared/`，`registry.js`装配节点接口。文本节点的`runtime/pipeline.js`维护单元、产物校验/保存/回读；故事节点`runtime/execution.js`维护前段衔接和相邻段复核。程序节点`runtime/execute.js`维护实际业务；图片/视频节点各自的`runtime/executor.js`维护对应生成步骤；`runtime/confirm.js`、`runtime/manual.js`维护节点确认和专属人工操作。
- `src/node_box/shared/production/{text,program}_executor.js`共用类型调度与文本审核/修订循环；图片、视频执行器由registry直接引用对应盒子。`unit_executor.js`仅共用Task/单元/检查点生命周期，`model_loop.js`只供文本执行器调用。`text_pipeline.js`只委派节点业务并共用候选保存状态；`timeline_renderer.js`、`media.js`、`audio_import.js`、`subtitles.js`提供通用媒体能力，不维护阶段产物。不得向共用执行器重新塞入节点业务分支。
- harness-http 路由只负责鉴权、请求/响应、静态资源及SSE，业务校验留Service/Store/Executor。面板与会话工具共用业务入口。
- 新建/导入原稿及原著解析均为纯程序步骤。原著解析默认不拆分，将整份原稿直接保存为一条id/sequence/title/body/summary记录，summary为空、事实与覆盖报告引用为空；不调用生成、审核、修订或记忆整理模型。正文由程序完整复制并逐字校验，不保存分段范围或正文引用。不可变原稿仍外置，后续模型按工具上限有界读取body；Task保存不可变输入与产物引用，不逐轮把整稿注入提示词。
- 新项目不提前分集；先原著解析、全篇联合改编指导，再故事自主分段定稿、文字分镜、素材准备与参考确认，后续分片/视频/剪辑，最后分集导出。联合改编只定全篇原则、人物动机关系成长、场景作用与团队指导，不写逐段计划；定稿直接读取原著与冻结指导，自行分段并写完整正文/衔接。旧段计划、提前声线和团队制服版本字段已删除，不做兼容或双写。
- 项目资产定义统一在asset_library；全局图片数据库仅id/url，生成/导入图片成功后立即入库。稳定声线与逐镜表演分离，音频不放图片表。

## 长期记忆

- 两层记忆只面向视频创作，domain固定video_production，不保存编码/技术选型/开发流程偏好。项目记忆仅当前项目，工程偏好只在Drama跨项目共享；存储由`src/memory/service.js`维护，不写入其他插件或Codex全局。项目JSON仍是实际产物权威。
- 主Agent工具、人工面板和独立记忆整理Task可维护长期记忆，保留用户原话来源；制作盒子只有冻结记忆的检索/读取权限。整理器仅提炼有原话证据的视频制作要求，独立复核后原子应用；AI推断、执行摘要和审核意见不能自动提升为用户决定。
- 本次明确目标优先于项目记忆，项目同主题key优先于适用工程偏好；按stages筛选。归档停止生效，删除移除当前及记忆历史正文，既有Task快照保持真实历史。
- 制作Task保存`memory_snapshot_ref`，生成/独立审核/修订共用同一冻结版本，失败续接沿用原快照；新Task读取更新版本。文本首轮仅索引与适用摘要，按需读取原文；图片/视频使用适用压缩摘要并保留决定/约束/未决问题原文，记录真实输入。
- `src/memory/conversations.js`按Drama已绑定会话增量保留可见用户/助手原文，`maintenance.js`/`ai.js`执行提炼、去重冲突核对和分块层级压缩；原文、原始记忆、旧Task不被摘要替换。新制作Task前长记忆自动压缩，版本变化使旧摘要失效。工程含糊冲突保留原偏好，候选留在整理任务的未决结果，不擅自覆盖；项目冲突另存open_question。具体阈值、预算和存储见数据契约。

## 规则与保存事实

- 所有步骤支持人工编辑。保存产物与审核通过独立；人工修改为待核对，保留意见、规则和历史。版本冲突、项目归属、活动Task、ID/引用及真实文件检查不能绕过。
- 不恢复input_hash/output_hash或按hash拒绝保存、自动标记下游/图片过期；是否重做按实际变化和用户目标判断。
- AI规则放在 `src/node_box/<节点>/skills/`：`<节点>-generate.md`、`<节点>-review.md`、`<节点>-revise.md`、`<节点>-output-format.json`，skills内直接放四文件，不再嵌套动作目录。六个AI节点使用此结构，程序节点不创建虚假的AI规则；辅助记忆整理规则放`src/memory/skills/memory_maintenance-*`。当前返回格式引用运行Schema，不复制项目字段定义。
- AI盒子每个动作维护一份完整skill（generate/review/revise），不拆成大量主题规则；首轮提供当前动作完整规则、返回契约和短单元资料；长资料按需读取；阶段内续接完整执行消息，审核与作者上下文独立。各轮候选及时保存、真实失败/取消事实不可丢失；不得伪造未执行审核、未生成图片或视频。
- 审核仅指出当前候选有据可核的阻断问题；历史意见需重新核实，允许有效内容保留。意见/规则/执行记录沿用现有交互风格。
- 盒子结束原因使用公共TASK_END_REASONS；网络连接失败只展示，不唤醒主Agent。已授权删除旧数据，不为旧记录增加迁移工作。
- 历史只从对应Task/Step/不可变文件恢复，不能读当前项目补造。展示与主Agent唤醒独立；首次成功/取消不自动唤醒，失败应如实展示。

## UI与工程边界

- 左侧纵向步骤tab，右侧产物；延续现有主题、卡片、按钮、意见与历史风格。人工编辑使用现有面板dialog，避免原生showModal阻塞整个宿主。
- 浏览器资源在 `src/harness_server/client_assets.js` 逐文件登记；不开放Service、Executor或Schema服务端源码。
- 业务放drama，不引用/转发/运行时读取/符号链接到meiji，反向依赖也禁止。共享能力仅通过根packages公开接口接入；从其他项目复用需复制实际源码并独立维护。
- 根运行 `npm run test:drama`；跨插件/工程整合运行 `npm test`；工程入口变化运行 `npm run verify:copy -- drama`。模拟模型验证不代表真实供应商生成通过。
- GitNexus使用根agent-harness索引（MCP注册名meiji-harness），CLI `node .gitnexus/run.cjs`；遵守根指引的impact、detect-changes与最终索引更新，UNKNOWN不解释为没有影响。

## 主Agent与盒子共用边界

- 主会话工具、Harness会话接入、用户目标、任务通知及主模型配置归`src/main_agent/`；主模型循环继续交给Harness。
- 盒子专用Agent循环、上下文、工具、产物契约、制作Service/执行器及后期辅助归`src/node_box/shared/`，它不是制作阶段。
- 真正同时服务多方的阶段目录、执行摘要、规则文件定位、原稿处理、基础媒体能力保留`src/shared/`；主Agent和面板调用同一业务服务，不复制执行/保存逻辑。
