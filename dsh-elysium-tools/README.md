# dsh-elysium-tools

Harness RunPod MiniMax H3 视频生成插件。提供 `t2va`、`i2va`、`fl2va`、`fl2va-loop`、`r2va` 五种模式及任务恢复。

预设模式、部署方式和 Harness 配置见 [项目 README](../README.md)。

## 三档创作入口

Harness 创作 preset 使用 `creation-preview`（预览）、`creation-regular`（常规）、`creation-hd`（高清），旧 `creation-video` 已移除。三者分别调用同一工具的 `profile=preview`、`regular`、`high-quality`。省略 profile 或使用 `standard` 兼容原生规格流程，不等同于新常规档。

完整技能路径、规格、恢复方式与验收见 [三档入口与全链路](../docs/implement/实施-视频创作三档入口与全链路.md)。

## 短剧快速预览

调用 `workflow_generate_video` 时增加 `profile: "preview"`，支持 `t2va` 或带 `first_frame` 服务器图片 URL 的 `i2va`。当前预览为 H3、384×512、73 帧、24fps、8 步，约 3.04 秒，保留联合音频并跳过 RIFE。省略 profile 或使用 `standard` 恢复原工作流。

配置位于 `src/workflows/profiles/preview.json`；具体验收、三镜头样片、恢复方式及限制见 [快速预览说明](../docs/implement/实施-AI短剧快速预览.md)。

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
