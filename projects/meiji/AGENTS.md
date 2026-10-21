# meiji 项目入口

本项目是 Agent Harness 的短剧制作业务插件。

- 通用流程遵守根 [AGENTS.md](../../AGENTS.md) 和[工作区指引](../../.agents/agent-harness-dev.md)。
- 修改业务代码、配置、skill 或测试前，阅读[meiji 开发指引](.agents/meiji-dev.md)及其中要求的[制作工作流](dev_docs/制作工作流.md)。只读咨询与纯文档修改按根规范分类。
- 当前目录包含业务规则、节点、任务系统、持久化和界面；公共 HTTP/编排通过包名导入，业务规则不放入 packages。
- 根运行 `npm test --workspace @meiji/harness-plugin` 验证本项目；跨公共边界变更运行根 `npm test`。
- 计划及实施记录使用仓库根 docs/plans、docs/implement；项目数据仍在 `$DSH_HOME/storages/meiji`，与本目录改名无关。

- meiji 与 drama 是独立项目，不能相互引用、转发导出、运行时读取源码、提供对方静态资源或建立跨项目符号链接。代码复用采用复制实际源码并改成本地引用；后续修改各自维护，共享能力只通过根 `packages`。
