# dsh-elysium-tools

Harness RunPod MiniMax H3 视频生成插件。提供 `t2va`、`i2va`、`fl2va`、`fl2va-loop`、`r2va` 五种模式及任务恢复。

预设模式、部署方式和 Harness 配置见 [项目 README](../README.md)。

## 构建

需要 Node.js 20.16+、pnpm，以及已提供五份 MiniMax H3 工作流的 RunPod ComfyUI。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm package:registry
dsh plugin --profile web add --workspace-root ./registry
```

或使用自动化脚本一键构建、注册和重启：

```sh
SKIP_COMFYUI_CHECK=1 bash app/common/deploy_plugin.sh tools
```

## 工作流同步

`src/workflows/templates/minimax-h3/` 是五套 MiniMax H3 UI/API 图及 Harness 绑定的唯一事实源。

```sh
pnpm workflow:sync       # 从 RunPod ComfyUI 同步 UI 图，编译 API 图并更新 SHA-256
pnpm workflow:check      # 只读核验，不修改文件
python3 -m unittest tests/test_runpod_workflow_sync.py
```
