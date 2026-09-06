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

从仓库根目录执行，完成 `dsh-elysium-tools` 构建打包、上传、服务器注册和
Harness 重启；部署过程不运行测试。服务器需已安装 Harness 和模型运行环境。
此脚本仅部署工具插件，`dsh-elysium` 和 `llm-ai-model` 需分别部署。

```sh
/usr/bin/env bash scripts/deploy_dsh-elysium_tools.sh
```
