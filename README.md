# llm-dsh-plugins

DeepSeek Harness 的单插件 AI 短剧工厂仓库。

## dsh-elysium

`dsh-elysium` 是唯一安装单元，内部集成短剧生产编排、远程 ComfyUI 合同驱动，以及文件、编辑器、终端、Git、浏览器和侧边聊天能力。不需要再安装 `dsh-comfyui` 或 `dsh-better-sidebar`。

详见 [dsh-elysium/README.md](./dsh-elysium/README.md)。

```sh
cd dsh-elysium
pnpm install
pnpm build
pnpm test
node scripts/package-registry.mjs
dsh registry install ./registry
dsh registry enable dsh-external/dsh-elysium
```
