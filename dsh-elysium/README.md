# dsh-elysium

DeepSeek Harness 的单插件 AI 短剧生产工厂，内置单集工作台、ComfyUI 驱动和
持久化生产编排。

## 核心能力

- 项目、单集、故事、规划和产物统一管理
- 按目标时长动态拆章，每章使用 1 张文生图起始帧和 5 张后续关键帧
- 自动生产、重启恢复、局部重试、版本保留、成片 QC 和人工终审
- 图片与视频生成、导入和导出
- 文件、编辑器、终端、Git、浏览器及后台任务
- 分栏、浮窗、侧边对话和会话隔离
- `ctx.betterSidebar` 页签与文件查看器扩展服务

聊天框统一使用 `_dsh_external_dsh_elysium_factory`。Elysium 持久化单集、任务和生产状态，
由 Elysium 内部驱动调用远程 Qwen T2I、Qwen Image Edit 和 Wan2.2 Remix；本机只做
产物归档、FFmpeg 标准化拼接、FFprobe 时长 QC 和人工验收记录。

生产顺序为：故事规划 → 每章起始帧 → 5 张连续关键帧 → 六锚点章节视频 →
720×1280、24fps、H.264 成片。成片未达到单集目标时长时不会进入人审状态。

产品需求见 `docs/elysium-product-requirements.md`，代码结构和实施边界见
`docs/elysium-technical-design.md`。

## 开发命令

```sh
pnpm install
pnpm build
pnpm test
```

源码位于 `src/`，构建产物输出到 `lib/`。

默认数据目录为 `./elysium-workspace`。可通过 `workspace` 修改路径，通过
`comfyui.baseUrl` 配置隧道地址，通过 `models.characterImage`、`models.shotImage` 和
`models.shotVideo` 配置生成模型。工作流合同保存在 `templates/comfyui/`，运行时复制到
Elysium 工作区后管理；不需要安装 `dsh-comfyui`。
