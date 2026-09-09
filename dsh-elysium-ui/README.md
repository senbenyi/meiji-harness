# dsh-elysium-ui

独立的 Harness 导演管理插件。

源码目录发布准备：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm package:registry
dsh plugin --profile web add --workspace-root ./registry
```

打开「设置 → 极乐世界 → 导演设置」，编辑名称和提示词后保存；冲突时重新加载。默认启用、导演列表为空，可选 [配置示例](config/settings.example.yaml)。