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
