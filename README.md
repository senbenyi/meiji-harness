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

`dsh-elysium-tools` 是独立安装的 Model API 工具插件。当前只提供
`model_generate_image`，详见 [dsh-elysium-tools/README.md](./dsh-elysium-tools/README.md)。
