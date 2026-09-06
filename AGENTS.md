# llm-dsh-plugins

DeepSeek Harness 插件、运行配置与部署脚本。

## 编码任务
1. 在完成功能的前提下精简实现，清理本次改动涉及的冗余，避免重复实现。
2. 优先遵循 `andrej-karpathy-skills` 的编码准则（本地技能名：`karpathy-guidelines`）。
3. 修改前确认入口、引用关系和验证方式。
4. 移动或重命名文件时，同步更新代码、测试和文档中的引用。
5. 核心改动在 `docs/` 中更新对应文档或新增文档，避免重复记录。
6. 表达式优先单行；复杂逻辑按可读性换行，避免压缩多条语句。

## 项目结构
- `dsh-elysium-tools/` — 工具注册、参数处理与任务调用。
- `dsh-elysium-ui/` — 页面与设置界面。
- `dsh-elysium/` — 已废弃的旧插件，未经明确要求不修改或删除。
- `config/` — Harness 设置、Agent 指令与系统提示词。
- `.dsh/skills/` — 按任务加载的技能说明。
- `scripts/` — 部署入口；`scripts/common/` 提供配置解析、安装、启动和隧道脚本。

## 构建、开发命令

以下命令在 `dsh-elysium-tools/` 或 `dsh-elysium-ui/` 中执行，仓库根目录没有 `package.json`。修改源码，不直接修改 `lib/`、`registry/` 构建产物。

- `pnpm install --frozen-lockfile --ignore-scripts`：按锁文件安装依赖，不执行生命周期构建脚本。
- `pnpm test`：运行当前插件的测试。
- `pnpm build`：生成可分发的构建产物。
- `pnpm package:registry`：组装 registry 包。

## 部署与安全

- 工具插件部署入口：`scripts/deploy_dsh_elysium_tools.sh`，目标服务器为 `ssh veo-comfyui`。
- 部署先镜像同步 `.dsh/`、`config/`、`scripts/`，再本地构建并上传插件；安装、应用配置和重启在服务器执行。
- `config/harness-settings.yaml` 管理运行设置，`config/harness-agent.md` 定义通用指令，`config/system-prompt.yaml` 定义系统提示词；任务操作细节放在技能中。
- 构建、部署和重启按用户授权执行；镜像同步会删除远端对应目录中本地已移除的文件。
- 区分测试、构建、部署与运行验收；未验证的链路不标记为可用。
