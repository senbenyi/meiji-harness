# dsh-elysium-tools

Harness RunPod MiniMax H3 视频生成插件，自带任务卡和“极乐世界”预设。仅提供 `t2va`、`i2va`、`fl2va`、`fl2va-loop`、`r2va` 五种模式及原任务恢复。

## 1. 安装插件

需要 Harness、Node.js 20.16+、Python 3，以及已提供五份 MiniMax H3 工作流的 RunPod ComfyUI。本项目不下载、安装或检查模型文件。在本插件目录执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm package:registry
dsh plugin --profile web add --workspace-root ./registry
```

## 2. 手动复制配置

1. 在 `app/config/harness-settings.yaml` 中手工维护唯一的 `COMFYUI_URL`；API 和 `/view` 共用该地址。
2. 将 `.dsh/.agent-presets/elysium/` 完整复制到 `~/.dsh/.agent-presets/elysium/`。

