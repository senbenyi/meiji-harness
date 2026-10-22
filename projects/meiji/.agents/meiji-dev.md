# meiji 开发指引

通用开发流程遵守根 [AGENTS.md](../../../AGENTS.md) 和[工作区开发指引](../../../.agents/agent-harness-dev.md)。

## 当前范围

- meiji 保留为待重构的独立业务项目；本文件已清除旧业务规则、旧模型/接口约定、旧节点流程及实现路径要求，避免干扰后续设计。
- 后续需求以用户当前明确要求和核实后的源码为准。历史 `dev_docs`、规则与方案仅供追溯，不自动作为有效规格；引用前重新确认其适用性。
- drama 与 meiji 独立维护。复用代码必须复制实际源码并改成本地引用，不能跨项目导入、转发、读取源码或使用符号链接。通用能力通过 `packages` 的公开接口接入。
- 不修改外部 Harness、meiji-server 源码，不把供应商凭据写入仓库。HTTP术语统一遵守工作区开发指引。

## 开发与验证

- 根目录安装依赖，使用根 package-lock.json；项目入口与依赖以本项目 package.json 为准。
- 项目运行数据位于 `$DSH_HOME/storages/meiji`。重构或迁移前先核实数据及调用关系，不自动覆盖现有用户数据。
- 项目测试：根目录执行 `npm test --workspace @meiji/harness-plugin`；涉及公共包或工程集成时按根开发规范选择相应检查。
- 启动/重启：根目录执行 `npm run restart -- meiji`，配置入口为 `npm run configure -- meiji`。
- 代码图谱、计划和实施记录沿用工作区约定；不新增分散的README。
