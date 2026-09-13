# dsh-elysium-tools

视频生成插件。提供 `t2va`、`i2va`、`fl2va`、`fl2va-loop`、`r2va` 五种模式及任务恢复。

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

或在仓库根目录使用统一部署脚本安装 Harness 配置并注册插件：

```sh
node harness/scripts/install.mjs
```

## 工作流同步

`src/workflows/templates/minimax-h3/` 是五套 MiniMax H3 UI/API 图及 Harness 绑定的唯一事实源。

```sh
pnpm workflow:sync       # 从 RunPod ComfyUI 同步 UI 图，编译 API 图并更新 SHA-256
pnpm workflow:check      # 只读核验，不修改文件
node --test tests/runpod-workflow-sync.test.js
```
