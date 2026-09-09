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

## 2. 手动复制配置步骤

1. **打开源目录和目标目录。** 源目录为本插件的 `.dsh/`，目标目录为主机 `~/.dsh/`；设置了 `DSH_HOME` 时使用该目录。macOS 访达按 `Command + Shift + .` 显示隐藏目录。

2. **核对连接地址。** 打开源目录的 `profiles/web/cordis.patch.yml`，确认 `comfyUrl`（Harness 访问）和 `publicUrl`（浏览器访问）。当前均为 `http://127.0.0.1:6016`，需已有可用 ComfyUI 或隧道，否则改为实际地址。

3. **复制完整预设。** 将源目录的 `.agent-presets/elysium/` 复制到目标目录的 `.agent-presets/elysium/`。目标父目录不存在时先创建；已有预设先备份，再合并目录并覆盖同名文件。不要只复制 `agent.cordis.yml`。

4. **复制插件配置。** 先备份目标目录的 `profiles/web/cordis.patch.yml`，核对其中是否有源文件未包含的配置，有则先合并进源文件；再用源目录的 `profiles/web/cordis.patch.yml` 覆盖它。不要使用插件根目录的同名文件。

5. **检查最终路径。** 默认主机目录应如下，不要多套一层 `.dsh/`，也不要替换整个主机目录：

   ```text
   ~/.dsh/
   ├── profiles/web/cordis.patch.yml
   └── .agent-presets/elysium/
       ├── agent.cordis.yml
       ├── preset.yml
       ├── persona.md
       ├── rules.md
       └── skills/
   ```

## 3. 重新加载

重新加载 Harness，新会话选择“极乐世界”。素材放在 `~/.dsh/elysium/artifacts`（使用自定义 DSH_HOME 时随之调整），输入绝对路径；中断后查询、恢复原任务。
