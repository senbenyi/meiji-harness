# dsh-elysium

DeepSeek Harness 的单插件 AI 短剧生产工厂，内置单集工作台、ComfyUI 驱动、
持久化生产编排和完整 Elysium 平台能力。安装时只有 `dsh-elysium` 一个单元。

## 核心能力

- 项目、单集、故事、规划和产物统一管理
- 按目标时长动态拆章，每章使用 1 张文生图起始帧和 5 张后续关键帧
- 自动生产、重启恢复、局部重试、版本保留、成片 QC 和人工终审
- 图片与视频生成、导入和导出
- 文件、编辑器、浏览器及后台任务
- 分栏、浮窗和会话隔离
- `ctx.betterSidebar` 页签与文件查看器扩展服务

Elysium 持久化单集、任务和生产状态，
由 Elysium 内部驱动调用远程 RealVisXL、IP-Adapter 和 Wan2.2 Remix v3；本机只做
产物归档、FFmpeg 标准化拼接、FFprobe 时长 QC 和人工验收记录。

原 ComfyUI 插件的检查、生成、任务恢复、模板和 LoRA 管理能力统一为该工具下的
`comfyui_*` 动作，不再注册第二组聊天工具。

生产顺序为：Qwen3.8 剧本与分镜规划 → 角色定妆图 → 每章文生图起始帧 →
人物一致性首帧 → SVI2Pro 连续章节视频 → 静音拼接 → MMAudio 同步环境音与拟音 → 25fps、H.264 成片。
支持 9:16 和 16:9；合成时使用运动插帧并精确裁切目标时长，缺少音轨或时长偏差超过
QC 容差时不会进入人审。MMAudio 不生成对白、旁白、配音或音乐。

产品需求见 `docs/elysium-product-requirements.md`，代码结构和实施边界见
`docs/elysium-technical-design.md`。

## 目录说明

```text
dsh-elysium/
├── src/                                      # 插件源码根目录
│   ├── bootstrap/                            # 组合根：装配配置、服务、路由和插件生命周期
│   │   ├── plugin.ts                         # 唯一运行时装配入口
│   │   └── config.ts                         # 单插件统一配置实现
│   ├── domain/                               # 与界面和外部服务无关的短剧核心规则
│   │   ├── episode.js                        # 单集、规划、锚点和任务依赖规则
│   │   ├── project.js                        # 项目与镜头数据规则
│   │   └── errors.js                         # 领域错误模型
│   ├── application/                          # 用例层：规划、生产、生成、重试、拼接和 QC
│   ├── infrastructure/                       # 外部系统和本机能力适配
│   │   ├── comfyui/                          # 工作流校验、提交、恢复和产物下载
│   │   ├── persistence/                      # 工作区路径、文件存储和原子写入
│   │   └── workspace/                        # 文件、浏览器等 Harness 能力
│   ├── presentation/                         # 所有用户入口和宿主协议适配
│   │   ├── dsh/                              # DSH 路由、聊天工具、生命周期和服务桥接
│   │   ├── studio/                           # AI 短剧生产工作台 UI
│   │   └── workbench/                        # 文件、浏览器和后台任务 UI
│   ├── public/                               # 对外稳定的源码兼容出口，不放业务实现
│   │   └── client/                           # 客户端 API 与服务类型出口
│   ├── shared/                               # 跨层共享且不含业务流程的最小类型与约束
│   ├── index.ts                              # 稳定包入口，转发 bootstrap/plugin.ts
│   ├── config.ts                             # 稳定配置入口，转发 bootstrap/config.ts
│   └── invariant.ts                          # 稳定约束入口，转发 shared/invariant.ts
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

`src/index.ts`、`src/config.ts` 和 `src/invariant.ts` 只保留稳定导出；真实装配集中在
`bootstrap/`。短剧规则进入 `domain/`，用例进入 `application/`，ComfyUI、持久化和
本机能力进入 `infrastructure/`，界面、聊天工具和 DSH 路由进入 `presentation/`。
`lib/`、`registry/`、`node_modules/` 和 `elysium-workspace/` 都不是源码维护入口。

依赖边界：`domain/` 不依赖应用、基础设施或界面；`application/` 组织领域规则和生产用例；
`presentation/` 只处理用户交互、DSH 协议和输入输出；`infrastructure/` 负责技术实现；
`bootstrap/` 负责把它们装配成一个插件。工作流资源放入 `templates/`，不要硬编码到业务实现中。

## 开发命令

```sh
pnpm install
pnpm run check:source-imports
pnpm run typecheck
pnpm test
pnpm build
```

日常开发无需重复完整发布：

```sh
pnpm dev:ui       # UI/CSS 保存后直接更新 registry，刷新浏览器即可
pnpm dev:server   # 服务端保存后自动构建并重启 dsh web
pnpm release:local # 交付前执行测试、完整构建、安装和重启
```

`dev:ui` 与 `dev:server` 可分别运行在两个终端。web profile 首次链接到本仓库的
`registry/` 后，日常 UI 调试不再需要重复安装或重启。执行 `release:local` 前先用
`Ctrl-C` 停止两个开发监听器。

项目使用 pnpm。不要在该目录执行 `npm install`，避免生成另一套锁文件或破坏 pnpm
链接结构。IDE 出现依赖红线时，先确认打开的项目根目录是当前 `dsh-elysium/`，再重载
TypeScript 服务；`check:source-imports`、`typecheck` 和 `pnpm list` 才是源码与依赖状态依据。

以上命令证据相互独立：导入检查和类型检查通过不代表已经构建；构建通过不代表插件已
重新安装；只有重新安装、重启 DSH 并完成浏览器/真实生产链路验证后，才能确认运行时生效。

默认数据目录为 `./elysium-workspace`。可通过 `workspace` 修改路径，通过
`comfyui.baseUrl` 配置隧道地址。Qwen3.8 规划模型通过 `planner.provider`、
`planner.model` 和 `planner.maxTokens` 配置；托管生产使用 `models.characterImage`、
`models.startFrame`、`models.chapterVideo` 和 `models.finalAudio`；旧素材工作台继续使用
`models.shotImage` 与 `models.shotVideo`，两套入口都保留。工作流合同保存在
`templates/comfyui/`，运行时复制到 Elysium 工作区后管理；远程生成驱动与侧栏能力均已
内置，不需要额外安装配套插件。

## 交付验收

交付机器需要 Node.js 20+、pnpm、DSH，以及可执行的 `ffmpeg`、`ffprobe`。远程
ComfyUI、所需节点和模型必须已部署；真实图片和视频生成会消耗远端算力，不属于本地
安装成功的判定条件。

```sh
command -v ffmpeg
command -v ffprobe
pnpm release:local
curl -sS -X POST http://127.0.0.1:3080/elysium/api/project.list \
  -H 'content-type: application/json' --data '{}'
```

随后在 DSH 打开“极乐世界”，依次完成：自定义页测试并保存 ComfyUI → 新建项目 →
新建单集 → 保存故事 → 自动规划 → 确认授权 → 开始生产 → 异常时重试 → 完整播放成片 →
人工终审 → 下载成片。刷新页签后应恢复当前项目、单集和服务端生产阶段。

验收证据必须分层记录：测试通过不等于构建成功，构建成功不等于已安装，接口健康不等于
浏览器链路通过；未实际执行远端 ComfyUI 生产时，应明确标记“待 GPU 验证”。
