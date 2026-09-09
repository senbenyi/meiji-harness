# llm-dsh-plugins

DeepSeek Harness 插件、运行配置与部署脚本。

## 项目结构
- `dsh-elysium-tools/` — 工具注册、参数处理、任务调用与媒体卡片。
- `dsh-elysium-ui/` — 独立导演设置界面与提示词读取，不依赖工具插件。
- `dsh-elysium/` — 已废弃的旧插件，未经明确要求不修改或删除。
- `app/config/` — 可选服务器部署的运行参数与宿主设置。
- `dsh-elysium-tools/presets/elysium/` — 随包安装的 Agent preset、人格、协作指令和创作技能。
- `app/` — 部署入口；`app/common/` 提供配置解析、安装、启动和隧道脚本。

## 构建、开发命令

以下命令在 `dsh-elysium-tools/` 或 `dsh-elysium-ui/` 中执行，仓库根目录没有 `package.json`。修改源码，不直接修改 `lib/`、`registry/` 构建产物。

- `pnpm install --frozen-lockfile --ignore-scripts`：按锁文件安装依赖，不执行生命周期构建脚本。
- `pnpm test`：运行当前插件的测试。
- `pnpm build`：生成可分发的构建产物。
- `pnpm package:registry`：组装 registry 包。

## 部署与安全

- 远程部署入口：`app/deploy_dsh_elysium_tools.sh` 和 `app/deploy_dsh_elysium_ui.sh`，目标服务器为 `ssh veo-comfyui`。
- 部署先检查远端环境并完成本地测试、构建和打包，再镜像同步 `app/`（含 `app/config/`）和插件（含 preset、技能）；安装、应用配置和重启在服务器执行。
- `app/config/harness-settings.yaml` 仅管理部署运行值与宿主设置；独立安装必需的 Elysium 配置和技能由工具包提供，不写入全局 AGENTS.md。
- 构建、部署和重启按用户授权执行；镜像同步会删除远端对应目录中本地已移除的文件。
- 区分测试、构建、部署与运行验收；未验证的链路不标记为可用。
