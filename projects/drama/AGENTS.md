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

- `src/harness_server/` 只提供harness-http路由、认证、静态资源和SSE，不承载盒子业务。根插件组装项目管理、剧本优化服务及共享记录；不设顶层service转发层，也不保留旧目录代理。HTTP分类和记录归属统一遵守根开发指引的“HTTP术语与记录归属”。

- 项目管理专属的输入字段、创建和编辑/导入校验分别在 `src/node_box/project/create_project.js`、`edit_project.js`。`src/project_runtime/`保留整个项目共享的Manager、Model和写入队列；其中 `project_manager.js`、`project_model.js` 不随盒子迁移。界面组件归 `src/client/`，服务端Schema和校验不当作UI迁入。

- 各AI节点的字段契约由 `src/node_box/<节点名>/definition.js` 独立维护；`src/node_runtime/node_definition_registry.js` 仅汇总，维持节点名和JSON Pointer。Schema工具在 `src/node_runtime/schema_builders.js`，通用审核与图片返回约定在 `shared_output_contracts.js`。定义文件只能依赖共享工具/契约，不导入汇总、Service或Executor；暂未实现的节点只有定义不代表可执行。

- `src/project_runtime/` 是整个项目共用的运行基础层，区别于业务盒子 `src/node_box/project/`；输出结构展开及规则引用渲染位于 `src/node_runtime/output_contract_renderer.js`。公共 `./project` 导出和实际项目数据存储路径不因源码目录改名而改变。

- 节点共用运行机制统一在 `src/node_runtime/`，职责与文件名见 `docs/开发方向.md` 的“节点运行层”；`node_initializer.js`初始化空节点，`output_response_parser.js`解析校验实际响应，`output_contract_renderer.js`选择/展开输出结构并渲染规则。`src/node_runtime/node_prompt_composer.js`继续负责提示词组装，不将这些机制复制到盒子或公共包。
