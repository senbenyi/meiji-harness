# Agent Harness 开发指引

通用协作流程见 [AGENTS.md](../AGENTS.md)。本仓库由 npm workspaces 管理 `packages/*` 和 `projects/*`。

## 边界

- `packages/`：可独立安装的公共包，不导入 `projects/`、宿主私有模块或业务配置，不内置业务规则。各包维护自己的 package.json、公开 exports、说明和测试。
- `projects/`：业务插件、规则、数据、界面、模型选择及测试。项目之间必须独立，禁止相互 import、re-export、运行时读取源码、提供对方的静态资源路由或建立跨项目符号链接。复用现有项目代码时复制实际源码到目标项目并改为目标项目内部引用；只有 `packages` 公共能力允许共享。修改业务前读取该项目 AGENTS.md 及其指向的业务规格。当前项目见 [meiji](../projects/meiji/AGENTS.md)。
- 根目录与 `scripts/`：工作区、项目选择、宿主配置和验证，不硬编码具体业务包名。
- `meiji-server` 与 `deepseek-harness` 是外部服务/宿主。日常项目开发不修改它们的源码，不把供应商凭据放入仓库。

## 安装与验证

- 在根执行 `npm ci`，仅维护根 package-lock.json；不提交项目子锁文件或 node_modules。
- 业务依赖公共包的版本应与本工作区包匹配，npm 自动链接源码。公共包为 `@agent-modules/http-client`、`@agent-modules/prompt-composer`、`@agent-modules/setting`、`@agent-modules/task`。setting 只校验调用方提供的语言和模型目录；task 的节点类型和隔离 scope 由业务注册/传入，项目字段放 metadata。
- 根 `npm test` 运行工作区与工程测试；单包使用 `npm test --workspace <包名>`。
- 工程调整还验证 `npm run verify:copy`；包 exports/分发调整验证 `npm run verify:install`。测试均使用模拟模型，真实模型调用单独记录。
- 启动/重启用 `npm run configure -- <项目目录名>`、`npm run restart -- <项目目录名>`；唯一项目自动选择，多项目显式选择，或使用 AGENT_PROJECT。复制模板无需改根脚本。
- 计划、实施记录分别在根 docs/plans、docs/implement，遵守 AGENTS.md 命名。
- `.claude/guard.mjs` 覆盖 packages/projects/工程脚本，纯文档豁免；新项目把业务指引放进自身目录。

## 代码图谱

仓库标识为 `agent-harness`；根运行 `node .gitnexus/run.cjs status`，更新用同一 runner 的 `analyze --index-only`。索引默认放 `$HOME/.gitnexus/indexes`。迁移后需新路径完整建图；包外动态加载由清单、源码和入口测试补查。提交或最终验收前按根规范执行 detect_changes，不能把 UNKNOWN 或被截断结果解释为无影响。
