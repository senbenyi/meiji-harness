# Harness 命令禁用

仅禁用 `/feedback`：`harness/config/harness-commands.patch.yml` 保存 `command-feedback` 的 `disabled: true` 配置。`/compact` 等其他命令不变。

将该配置按 id 合并到本机 `~/.dsh/profiles/web/cordis.patch.yml`（本机已同步），并重启服务。脚本启动及直接使用 `dsh web` 均加载这个 profile。当前安装版本不支持命令行 `--patch` 参数。恢复时移除本机对应禁用设置，并更新仓库配置。
