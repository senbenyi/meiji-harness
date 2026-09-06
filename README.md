# llm-dsh-plugins

DeepSeek Harness 插件仓库。

## dsh-elysium

`dsh-elysium` 集成短剧生产编排、远程 ComfyUI 合同驱动，以及文件、编辑器、终端、Git、浏览器和侧边聊天能力。不需要再安装 `dsh-comfyui` 或 `dsh-better-sidebar`。

详见 [dsh-elysium/README.md](./dsh-elysium/README.md)。

```sh
cd dsh-elysium
pnpm install
pnpm build
pnpm test
node scripts/package-registry.mjs
dsh plugin --profile web add --workspace-root ./registry
```

## dsh-elysium-tools

`dsh-elysium-tools` 是独立安装的 Function Call 工具插件，直接调用服务器上的 `llm-ai-model` 脚本，
提供图片、视频、后处理、工作流和任务查询工具，
详见 [dsh-elysium-tools/README.md](./dsh-elysium-tools/README.md)。

## 服务器部署

从仓库根目录执行：先上传配置和脚本，再本地构建并上传插件产物，最后在服务器部署目录执行安装、重启和检查脚本。部署过程不运行测试。
此脚本独立部署工具插件、Harness 配置和技能，路径读取 `config/harness-settings.yaml`，无需本地模型仓库。
服务器上的 Harness、Elysium 核心插件和模型服务需预先安装。

```sh
/usr/bin/env bash scripts/deploy_dsh_elysium_tools.sh
```
