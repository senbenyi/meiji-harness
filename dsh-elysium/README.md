# dsh-elysium

DeepSeek Harness 的 AI 成人短剧生产工厂，内置完整侧边栏能力。生产入口通过
`dsh-comfyui` 调用远程 ComfyUI 合同工作流，固定执行 12 镜、2 个六锚点视频块和不少于 40 秒成片。

## 核心能力

- 项目、角色、分镜和素材管理
- 生产单创建/检查、启动、断点续跑、单项重试、成片 QC 和人工验收
- 图片与视频生成、导入和导出
- 文件、编辑器、终端、Git、浏览器及后台任务
- 分栏、浮窗、侧边对话和会话隔离
- `ctx.betterSidebar` 页签与文件查看器扩展服务

聊天框统一使用 `_dsh_external_dsh_elysium_factory`。Elysium 持久化生产状态，
通过 `dsh-comfyui` 的 `generate/job` 合同调用远程 Qwen Image 和 Wan2.2；本机只做
产物归档、FFmpeg 标准化拼接、FFprobe 时长 QC 和人工验收记录。

生产顺序固定为：12 张镜头图 → `shot-01..06` 与 `shot-07..12` 两个 SVI 视频块 →
720×1280、24fps、H.264 成片。成片少于 40 秒时不会进入人审状态。

## 开发命令

```sh
pnpm install
pnpm build
pnpm test
```

源码位于 `src/`，构建产物输出到 `lib/`。

默认数据目录为 `./elysium-workspace`。可通过 `workspace` 修改路径，通过
`models.characterImage`、`models.shotImage` 和 `models.shotVideo` 配置生成模型。
