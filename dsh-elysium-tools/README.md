# dsh-elysium-tools

Harness 图片与视频生成插件，自带任务卡和创作预设，可独立安装。

## 安装

需要 Harness、Node.js 20.16+、Python 3、FFmpeg、FFprobe，以及具备所需模型和节点的 ComfyUI。在本插件目录执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm package:registry
dsh plugin --profile web add --workspace-root ./registry
```

## 配置

将 [连接配置](config/cordis.patch.example.yml) 合并到 `~/.dsh/profiles/web/cordis.patch.yml`；设置了 `DSH_HOME` 时使用该目录。

填写 `comfyUrl`（Harness 可访问）和 `publicUrl`（浏览器可访问）。默认使用 `python3`、`ffmpeg`、`ffprobe`，素材目录为 `$DSH_HOME/elysium/artifacts`（默认 `~/.dsh/elysium/artifacts`）。

模型沿用 Harness 设置；需要新增时参考 [模型配置示例](config/harness-settings.example.yaml)。

## 使用

配置后重新加载 Harness，新会话选择“极乐世界”，描述生成目标。输入素材放在上述素材目录，使用绝对路径；中断后查询、恢复原任务，避免重复生成。
