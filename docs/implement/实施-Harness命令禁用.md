# Harness 命令禁用

仅禁用 `/feedback`：在 `harness/.dsh/profiles/web/cordis.patch.yml` 中保存 `command-feedback` 的 `disabled: true` 配置。`/compact` 等其他命令不变。

安装脚本会将该配置覆盖到本机 `~/.dsh/profiles/web/cordis.patch.yml`，脚本启动及直接使用 `dsh web` 都会加载这个 profile。恢复时移除对应禁用项并重新安装配置。
