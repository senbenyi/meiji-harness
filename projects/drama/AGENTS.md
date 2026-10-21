# drama 开发入口

- 遵守根 `AGENTS.md` 与 `.agents/agent-harness-dev.md`。
- 当前架构见 `docs/开发方向.md`；项目结构说明见 `docs/project_detail.json`，程序不得读取该文档作为运行时模板。
- 业务代码放 `src/`；公共规则与状态分别使用 `@agent-modules/prompt-composer`、`@agent-modules/task/models`。不导入 meiji 业务模块。
- 项目 JSON 经 `ProjectManager` / `ProjectModel.update()` 写入 `$DSH_HOME/storages/drama/projects/<id>/project.json`；工作区/会话及创建请求索引单独保存于 `bindings.json`。
- 根运行 `npm run test:drama`，跨插件/工程集成执行 `npm test`；计划和实施记录沿用根目录。
- GitNexus 使用根指引的 `agent-harness` 仓库配置；当前 MCP 注册名为 `meiji-harness`，CLI 使用 `.gitnexus/run.cjs`。

- 每次从 meiji 复用界面或业务代码，必须将实际源码复制到 drama，再改成 drama 内部依赖并独立维护。禁止引用、转发导出、运行时读取或符号链接到 meiji；meiji 也不得反向引用 drama。共享能力只能通过根 `packages` 的公开接口接入。
