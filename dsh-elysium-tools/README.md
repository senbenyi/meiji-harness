# dsh-elysium-tools

Harness 图片与视频生成插件，自带任务卡和“极乐世界”预设。

## 1. 安装插件

需要 Harness、Node.js 20.16+、Python 3、FFmpeg、FFprobe，以及具备所需模型和节点的 ComfyUI。在本插件目录执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm package:registry
dsh plugin --profile web add --workspace-root ./registry
```

## 2. 手动复制配置

1. 确认 `.dsh/profiles/web/cordis.patch.yml` 中两个 ComfyUI 地址可用。
2. 将 `.dsh/.agent-presets/elysium/` 完整复制到 `~/.dsh/.agent-presets/elysium/`。

## 3. 重新加载

重新加载 Harness，新会话选择“极乐世界”。素材放在 `~/.dsh/elysium/artifacts`（使用自定义 DSH_HOME 时随之调整），输入绝对路径；中断后查询、恢复原任务。
