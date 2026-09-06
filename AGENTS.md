# 仓库贡献指南

## 项目结构与模块组织

- `dsh-elysium-tools/` 是函数调用工具插件：工具位于 `src/functions/` 和 `src/workflows/`，测试位于 `tests/`。
- `dsh-elysium-ui/` 是独立导演设置插件，只提供 Harness 原生设置页面，不注册生成工具。
- 每个包都有独立的清单和构建脚本。只编辑源码，不直接修改生成目录 `lib/` 或 `registry/`。
- 根目录 `scripts/` 存放部署脚本。

## 构建、测试与开发命令

使用 Node.js 20+ 和 pnpm，在对应包目录内执行命令：

- `pnpm install --frozen-lockfile --ignore-scripts`：按锁文件安装依赖，不执行生命周期构建脚本。
- `pnpm test`：运行当前包的 Node.js 测试套件。
- `pnpm build`：生成可分发的构建产物。
- `pnpm package:registry` 组装 registry 包。

构建与测试应串行执行；构建、部署和重启须获得授权。

## 代码风格与命名约定

遵循相邻代码风格：两空格缩进、ES 模块、单引号字符串，通常不加分号。函数使用 camelCase，React 组件使用 PascalCase，工具文件使用含义明确的 kebab-case 名称。工具标识使用 snake_case，例如 `model_generate_video`。保持导出、参数定义与 `dsh.plugin.json` 注册信息一致。两个包均未提供 lint/format 脚本，避免无关格式化。

## 测试规范

主要测试套件使用 `node:test` 和 `node:assert/strict`。测试文件命名为 `*.test.js`。根据需要补充聚焦行为的回归测试。当前未配置覆盖率数值门槛。交接时分别说明静态检查、测试、打包、运行时检查和 GPU E2E 的实际结果。

## 提交与合并请求规范

历史提交混用简短中文摘要和 `feat:` 前缀，尚无严格统一格式。提交信息应简洁、准确描述改动。PR 应说明行为变化、范围、验证结果与限制，关联相关问题；界面修改附截图。保留已有修改，仅在明确要求时提交或推送。

## 部署与安全

`scripts/deploy_dsh_elysium_tools.sh` 部署工具插件并重启远端 Harness。部署、重启和付费 GPU 测试需要明确授权。不得在提交或日志中包含凭据或私密配置。
