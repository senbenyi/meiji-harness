# dsh-toonflow

DeepSeek Harness 的 AI 短剧可视化操作台。插件已内置原 `dsh-sidebar`
的完整侧边栏工作台，不再依赖或单独挂载 `dsh-better-sidebar`。

## 功能

- Toonflow：项目管理、角色、分镜、图片/视频生成、素材导入与导出界面。
- 侧边栏：文件树、编辑器、终端、Git、浏览器、后台任务、侧边对话、分栏和浮窗。
- 扩展服务：继续通过 `ctx.betterSidebar` 注册额外页签和文件查看器。
- 兼容入口：客户端继续提供 `dsh-better-sidebar` 模块别名，供现有侧栏扩展解析。
- 会话隔离：侧边栏布局、页签和终端按 DSH 会话管理。

## 源码结构

```text
src/index.ts                 # 合并后的 Host 入口
src/client/index.tsx         # 合并后的 Client 入口
src/toonflow/server/         # Toonflow API、存储与生成编排
src/toonflow/client/         # Toonflow 页签 UI
src/client/                  # 内置侧边栏 UI
skills/                      # Toonflow Agent 技能
tests/                       # Toonflow Host 测试
```

## 开发命令

```sh
pnpm install
pnpm build
pnpm test
```

构建会生成 `lib/` 发布产物。仓库内只维护 `src/` 下的源码，不要直接修改
生成后的客户端 bundle。

默认项目数据目录为 `./toonflow-workspace`，可通过插件配置的 `workspace`
改为稳定的绝对路径。生成模型在 `models.characterImage`、
`models.shotImage` 和 `models.shotVideo` 中配置。
