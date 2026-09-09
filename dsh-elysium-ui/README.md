# dsh-elysium-ui

独立的 Harness 导演管理插件；不依赖 tools 插件、Elysium 预设、ComfyUI 或仓库 `app/`。媒体生成和任务卡由 tools 插件提供。

安装交付包后重新加载 Harness：

```sh
dsh plugin --profile web add --workspace-root /absolute/path/to/package
```

源码目录发布准备：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm package:registry
dsh plugin --profile web add --workspace-root ./registry
```

打开「设置 → 极乐世界 → 导演设置」，编辑名称和提示词后保存；冲突时重新加载。默认启用、导演列表为空，可选 [配置示例](config/settings.example.yaml)。

任意预设均可使用宿主已有模型，通过 `elysium_read_director` 按 ID 读取导演。会话只注入名称、ID 和版本索引，正文按需读取；同版本复用，关闭或删除后停用。保存不触发生成，短视频不自动读取导演。
