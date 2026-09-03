# dsh-elysium

DeepSeek Harness 的单插件 AI 短剧生产工厂，内置单集工作台、ComfyUI 驱动、
持久化生产编排和完整 Better Sidebar 平台能力。安装时只有 `dsh-elysium` 一个单元。

## 核心能力

- 项目、单集、故事、规划和产物统一管理
- 按目标时长动态拆章，每章使用 1 张文生图起始帧和 5 张后续关键帧
- 自动生产、重启恢复、局部重试、版本保留、成片 QC 和人工终审
- 图片与视频生成、导入和导出
- 文件、编辑器、终端、Git、浏览器及后台任务
- 分栏、浮窗、侧边对话和会话隔离
- `ctx.betterSidebar` 页签与文件查看器扩展服务

Elysium 持久化单集、任务和生产状态，
由 Elysium 内部驱动调用远程 Qwen T2I、Qwen Image Edit 和 Wan2.2 Remix；本机只做
产物归档、FFmpeg 标准化拼接、FFprobe 时长 QC 和人工验收记录。

原 ComfyUI 插件的检查、生成、任务恢复、模板和 LoRA 管理能力统一为该工具下的
`comfyui_*` 动作，不再注册第二组聊天工具。

生产顺序为：故事规划 → 每章起始帧 → 5 张连续关键帧 → 六锚点章节视频 →
720×1280、24fps、H.264 成片。成片未达到单集目标时长时不会进入人审状态。

产品需求见 `docs/elysium-product-requirements.md`，代码结构和实施边界见
`docs/elysium-technical-design.md`。

## 目录说明

```text
dsh-elysium/
├── src/                                      # 插件源码根目录
│   ├── plugin/                               # 轻量插件入口、统一配置和模块装配
│   │   └── server.ts                         # 组合 Sidebar 与视频生产模块
│   ├── config/                               # 插件统一配置
│   │   └── index.ts                          # 配置结构、默认值和校验
│   ├── sidebar/                              # 内置 Better Sidebar 工作台与扩展服务
│   │   ├── server.ts                         # 路由、文件、终端、Git、聊天和生命周期
│   │   └── client/                           # Sidebar 前端界面、组件和交互逻辑
│   ├── videos/                               # AI 短视频生产业务域
│   │   ├── client/                           # 单集工作台、生产状态、素材和人工验收界面
│   │   └── server/                           # 服务端入口、接口注册和业务能力装配
│   │       ├── application/                  # 故事规划、生产调度、生成、重试、拼接和 QC
│   │       ├── episode/                      # 单集、章节、任务、状态、版本和依赖规则
│   │       ├── project/                      # 项目、镜头、素材和旧工作台兼容能力
│   │       └── infrastructure/               # 持久化、文件系统和外部服务适配
│   │           └── comfyui/                  # 工作流校验、参数注入、提交、恢复和产物下载
│   └── client/                               # 对外稳定的客户端兼容入口
├── templates/                                # 随插件发布、运行时可复制的模板资源
│   └── comfyui/                              # ComfyUI 工作流、合同和模型目录模板
├── tests/                                    # 按职责组织的自动化测试
│   ├── production/                           # 短剧规划、生产状态机和项目领域
│   ├── comfyui/                              # 工作流、合同、模板和驱动适配
│   ├── platform/                             # 客户端 API 与插件产物装配
│   ├── security/                             # 请求鉴权、文件类型和路径边界
│   └── legacy/                               # 旧素材工作台兼容行为
├── scripts/                                  # 构建辅助、静态检查、打包和节点更新脚本
├── docs/                                     # 产品需求、技术设计、迁移和实施文档
├── lib/                                      # 编译产物，不直接修改
├── registry/                                 # 本地安装或发布生成的注册暂存目录
├── node_modules/                             # 本地依赖，不提交、不直接修改
└── elysium-workspace/                        # 本地项目、任务和产物数据，不属于源码
```

`src/` 根层文件只保留稳定导出和兼容入口；新界面实现应进入对应的业务目录。
`lib/`、`registry/`、`node_modules/` 和 `elysium-workspace/` 都不是源码维护入口。

维护边界：视频生产业务放入 `src/videos/`，通用工作台能力放入
`src/sidebar/`，插件组合入口是 `src/index.ts`，统一配置入口是 `src/config.ts`；工作流资源放入
`templates/`，不要硬编码到业务实现中。

## 开发命令

```sh
pnpm install
pnpm build
pnpm test
```

默认数据目录为 `./elysium-workspace`。可通过 `workspace` 修改路径，通过
`comfyui.baseUrl` 配置隧道地址。托管生产使用 `models.characterImage`、
`models.startFrame`、`models.keyframeImage` 和 `models.chapterVideo`；旧素材工作台继续使用
`models.shotImage` 与 `models.shotVideo`，两套入口都保留。工作流合同保存在
`templates/comfyui/`，运行时复制到 Elysium 工作区后管理；不需要安装
`dsh-comfyui` 或 `dsh-better-sidebar`。
