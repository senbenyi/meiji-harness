# dsh-elysium-tools

Harness 图片与视频生成插件，自带任务卡和创作预设。

## 安装

需要 Harness、Node.js 20.16+、Python 3、FFmpeg、FFprobe，以及具备所需模型和节点的 ComfyUI。在本插件目录执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm package:registry
dsh plugin --profile web add --workspace-root ./registry
```

## 覆盖配置

[.dsh/profiles/web/cordis.patch.yml](.dsh/profiles/web/cordis.patch.yml) 对应主机 `~/.dsh/profiles/web/cordis.patch.yml`，已保留当前本机其他配置；ComfyUI 地址已填 `http://127.0.0.1:6016`，需确保该地址可访问。

预设目录 `.dsh/.agent-presets/elysium/` 对应主机 `~/.dsh/.agent-presets/elysium/`。安装插件后复制：

```sh
mkdir -p "${DSH_HOME:-$HOME/.dsh}/.agent-presets"
cp -R .dsh/.agent-presets/elysium "${DSH_HOME:-$HOME/.dsh}/.agent-presets/"
cp .dsh/profiles/web/cordis.patch.yml "${DSH_HOME:-$HOME/.dsh}/profiles/web/cordis.patch.yml"
```

主机配置后续有改动时，先合并再覆盖。模型沿用主机已有设置。

重新加载 Harness，新会话选择“极乐世界”。素材放在 `~/.dsh/elysium/artifacts`（设置 DSH_HOME 时使用该目录），输入绝对路径；中断后查询、恢复原任务。
