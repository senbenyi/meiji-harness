# 仓库贡献指南

## 项目结构与模块组织

- `dsh-elysium/` 是 Harness 核心插件：`src/` 包含应用服务、ComfyUI 基础设施和 React 界面；`tests/` 存放领域测试；`templates/` 和 `docs/` 存放配套资源与文档。
- `dsh-elysium-tools/` 是函数调用工具插件：工具位于 `src/models/` 和 `src/workflows/`，测试位于 `tests/`。
- 每个包都有独立的清单和构建脚本。只编辑源码，不直接修改生成目录 `lib/` 或 `registry/`。
- 根目录 `scripts/` 存放部署脚本。修改核心插件前先阅读 `dsh-elysium/AGENTS.md`，其局部规则优先适用。

## 构建、测试与开发命令

使用 Node.js 20+ 和 pnpm，在对应包目录内执行命令：

- `pnpm install --frozen-lockfile --ignore-scripts`：按锁文件安装依赖，不执行生命周期构建脚本。
- `pnpm test`：运行当前包的 Node.js 测试套件。
- `pnpm build`：生成可分发的构建产物。
- 仅核心插件：`pnpm dev:ui` 监听前端修改；`pnpm dev:server` 监听服务端修改并重启 DSH。复用已有监听进程。
- 仅核心插件：`pnpm typecheck` 检查 TypeScript；`node scripts/package-registry.mjs` 组装 registry 包。
- 仅工具插件：`pnpm package:registry` 组装 registry 包。

构建与测试应串行执行，因为核心插件构建会删除 `lib/`。仅在获准完整交付核心插件时运行 `pnpm release:local`；它会测试、构建、安装并重启 Harness。

## 代码风格与命名约定

遵循相邻代码风格：两空格缩进、ES 模块、单引号字符串，通常不加分号。函数使用 camelCase，React 组件使用 PascalCase，工具文件使用含义明确的 kebab-case 名称。工具标识使用 snake_case，例如 `model_generate_minimax_h3_t2va`。保持导出、参数定义与 `dsh.plugin.json` 注册信息一致。两个包均未提供 lint/format 脚本，避免无关格式化。

## 测试规范

主要测试套件使用 `node:test` 和 `node:assert/strict`。测试文件命名为 `*.test.js`，核心插件按领域组织测试。根据需要补充聚焦行为的回归测试。当前未配置覆盖率数值门槛。交接时分别说明静态检查、测试、打包、运行时检查和 GPU E2E 的实际结果。

## 提交与合并请求规范

历史提交混用简短中文摘要和 `feat:` 前缀，尚无严格统一格式。提交信息应简洁、准确描述改动。PR 应说明行为变化、范围、验证结果与限制，关联相关问题；界面修改附截图。保留已有修改，仅在明确要求时提交或推送。

## 部署与安全

`scripts/deploy_dsh_elysium_tools.sh` 部署工具插件并重启远端 Harness。部署、重启和付费 GPU 测试需要明确授权。不得在提交或日志中包含凭据或私密配置。
