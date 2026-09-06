# dsh-elysium-ui

Harness 设置 → 极乐世界 → 导演设置。

- 启用开关控制导演管理界面的显示。
- 新增、修改、删除导演名称和提示词，点击保存后写入 Harness 原生设置。
- 保存带版本检查；其他页面修改后需重新加载，避免覆盖。
- 不注册聊天工具、生成接口、项目工作台或 ComfyUI 驱动。
- 导演提示词仅保存配置，当前不自动注入对话。

配置命名空间为 `dsh-elysium-ui`，字段为 `enabled` 和 `directors`。
部署脚本完整覆盖 Harness 设置时，应在 `config/harness-settings.yaml` 中管理同名配置，否则界面保存值会被覆盖。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm package:registry
```

独立安装 `registry/`；工具插件部署脚本不负责部署本 UI。

## 本机部署

在仓库根目录执行：

```sh
bash scripts/deploy_dsh_elysium_ui_local.sh
```

需要 Node.js 20+、pnpm 和已安装的 `dsh`。脚本依次安装依赖、测试、构建、打包，注册到本机 `web` profile，重启本机 Harness 并检查 HTTP。默认使用 `~/.dsh`，可通过绝对路径 `DSH_HOME` 指定已有 Harness 配置目录；保留现有设置。

访问 `http://127.0.0.1:3080/`，刷新后打开「设置 → 极乐世界 → 导演设置」。`23080` 是服务器隧道，与本机实例分开。启动日志位于 `$DSH_HOME/logs/dsh-elysium-ui-local.log`；若 3080 被其他程序或启动管理器占用，先手动停止。工作目录为本仓库，因此会加载仓库内适用的指令和技能。脚本通过链接安装 `registry/`，安装后请保留此目录。
