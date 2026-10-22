# Agent Harness 开发指引

通用协作流程见 [AGENTS.md](../AGENTS.md)。本仓库由 npm workspaces 管理 `packages/*` 和 `projects/*`。

## 边界

- `packages/`：可独立安装的公共包，不导入 `projects/`、宿主私有模块或业务配置，不内置业务规则。各包维护自己的 package.json、公开 exports、说明和测试。
- `projects/`：业务插件、规则、数据、界面、模型选择及测试。项目之间必须独立，禁止相互 import、re-export、运行时读取源码、提供对方的静态资源路由或建立跨项目符号链接。复用现有项目代码时复制实际源码到目标项目并改为目标项目内部引用；只有 `packages` 公共能力允许共享。修改业务前读取该项目 AGENTS.md 及其指向的业务规格。当前项目见 [meiji](../projects/meiji/AGENTS.md)。
- 根目录与 `scripts/`：工作区、项目选择、宿主配置和验证，不硬编码具体业务包名。
- `meiji-server` 与 `deepseek-harness` 是外部服务/宿主。日常项目开发不修改它们的源码，不把供应商凭据放入仓库。

## HTTP 术语与记录归属

后续开发文档、方案、代码说明、日志说明及对用户的沟通，统一使用以下名称；不得仅用“HTTP”“本地 HTTP”“远端 HTTP”指代其中某一类。描述具体请求时明确类别，按接口实际用途分类，不按服务器名称或部署位置分类。

| 名称 | 职责 | 示例 |
|---|---|---|
| `harness-http` | 浏览器面板与 Harness 的通信，由 Harness 接收并交给项目路由和 Service | 创建项目、导入剧本、删除项目、查询任务或调用记录 |
| `llm-http` | 主 Agent 或盒子调用模型及生成服务的请求 | 主 Agent 会话请求、盒子子 Agent 提取摘要、文本生成、图片生成、视频生成 |
| `service-http` | 调用其他服务的普通接口，不执行模型推理或生成 | 素材查询、文件上传下载、普通媒体处理 |

同一个 meiji-server 可以同时提供 `llm-http` 和 `service-http` 接口；即使该服务部署在本机，分类也不变。普通文件下载归 `service-http`，不因下载模型生成的图片或视频而归入 `llm-http`。浏览器通过 Harness 查询调用记录的请求本身仍是 `harness-http`。

调用链统一表述为：

```text
面板 → harness-http → 项目路由 → Service → 盒子 → llm-http / service-http
主 Agent → Tool → Service → 盒子 → llm-http / service-http
主 Agent 会话理解、工具决策和回复 → llm-http
```

路由、Tool、Service、盒子之间的进程内函数调用不称为 HTTP 调用。`llm-http` 包含主 Agent 自身的模型请求，不仅指盒子请求。

记录设计统一遵循：

- 面板和会话共用 Service 的业务任务入口，由 Service 建立任务及记录上下文，盒子通过该上下文关联步骤和实际调用；记录来源区分面板、会话。
- 主 Agent 的 `llm-http` 记录归主 Agent；盒子内部子 Agent 的 `llm-http` 记录归对应盒子，即使任务由会话发起也不改变归属。
- 调用记录页面展示 `llm-http`、`service-http`，明确标识类别和调用方；`harness-http` 访问请求不混入业务调用记录。
- 盒子调用记录关联任务、步骤；会话触发的任务额外关联源会话及 Tool 调用 ID。同一次实际请求只保存一份，通过关联关系追踪，不重复记录。

以上为统一术语与后续实现约定，不代表现有代码已完成对应分类字段或记录链路改造；具体实现状态以源码和实施记录为准。

## 文档维护

- 仓库不再维护根目录及各子目录分散的README文件，除非用户明确要求，不新增README。
- 开发入口与约定维护在根及各项目AGENTS.md、.agents开发指引中；业务设计和接口说明维护在既有docs/dev_docs中，避免同一内容多处重复维护。
- 更新源码职责时修改对应现有开发文档，移除指向已删除README的引用，不为补充目录说明重新创建README。

## 安装与验证

- 在根执行 `npm ci`，仅维护根 package-lock.json；不提交项目子锁文件或 node_modules。
- 业务依赖公共包的版本应与本工作区包匹配，npm 自动链接源码。公共包为 `@agent-modules/http-client`、`@agent-modules/prompt-composer`、`@agent-modules/setting`、`@agent-modules/task`、`@agent-modules/ui`。ui 提供独立的通用toast等展示能力。setting 只校验调用方提供的语言和模型目录；task 的节点类型和隔离 scope 由业务注册/传入，项目字段放 metadata。
- 根 `npm test` 运行工作区与工程测试；单包使用 `npm test --workspace <包名>`。
- 工程调整还验证 `npm run verify:copy`；包 exports/分发调整验证 `npm run verify:install`。测试均使用模拟模型，真实模型调用单独记录。
- 启动/重启用 `npm run configure -- <项目目录名>`、`npm run restart -- <项目目录名>`；唯一项目自动选择，多项目显式选择，或使用 AGENT_PROJECT。复制模板无需改根脚本。
- 计划、实施记录分别在根 docs/plans、docs/implement，遵守 AGENTS.md 命名。
- `.claude/guard.mjs` 覆盖 packages/projects/工程脚本，纯文档豁免；新项目把业务指引放进自身目录。

## 代码图谱

仓库标识为 `agent-harness`；根运行 `node .gitnexus/run.cjs status`，更新用同一 runner 的 `analyze --index-only`。索引默认放 `$HOME/.gitnexus/indexes`。迁移后需新路径完整建图；包外动态加载由清单、源码和入口测试补查。提交或最终验收前按根规范执行 detect_changes，不能把 UNKNOWN 或被截断结果解释为无影响。
