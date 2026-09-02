# dsh-toonflow

DeepSeek Harness 的 AI 短剧可视化工作台，内置完整侧边栏能力。

## 核心能力

- 项目、角色、分镜和素材管理
- 图片与视频生成、导入和导出
- 文件、编辑器、终端、Git、浏览器及后台任务
- 分栏、浮窗、侧边对话和会话隔离
- `ctx.betterSidebar` 页签与文件查看器扩展服务

## 开发命令

```sh
pnpm install
pnpm build
pnpm test
```

源码位于 `src/`，构建产物输出到 `lib/`。

默认数据目录为 `./toonflow-workspace`。可通过 `workspace` 修改路径，通过
`models.characterImage`、`models.shotImage` 和 `models.shotVideo` 配置生成模型。
