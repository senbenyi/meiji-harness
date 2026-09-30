# 项目目录架构

meiji（`@meiji/harness-plugin`）是 DeepSeek Harness 的外部插件：在 Harness 页面挂载短剧制作面板，并向 Harness agent 注册会话工具，完成“剧情 → 镜头 → 分镜 → 图片 → 视频 → 合片”的生成流程。不修改上游 Harness。

本文件描述现状；与代码不符时以代码为准，并在同一任务中修正本文件。

## 1. 仓库

```
llm-dsh-plugins/
├── configure-harness.sh    # 把 meiji 链接到同级 deepseek-harness，迁移项目存储布局与任务记录后启动 Web（3080）
├── restart-harness.sh      # 已配置环境的免安装重启：校验源码链接，正常停止旧进程，加载当前代码与 skill
├── docs/                   # 流程文档：research/ plans/ implement/（按需创建）
└── meiji/                  # 插件本体，见第 2 节
```

## 2. 插件

```
meiji/
├── index.js                # 唯一组合入口：导出 name / inject / apply
├── package.json            # type: module；npm test（固定使用测试密钥）
├── cordis.patch.yml        # 由 configure-harness.sh 生成，勿手改
├── client/                 # 面板界面：浏览器原生 ES 模块，平铺、无子目录、无构建
│   ├── panel.js            # 面板入口：由 routes.js 通过 webserver/index-inject 注入 Harness 页面，
│   │                       #   动态 import('/plugins/meiji/client/app.js') 后调用 mount()
│   │                       #   mount()：在 Harness 页面挂载 <meiji-workbench> 右栏（外壳、任务停止栏、项目/片库视图），已挂载则跳过
│   ├── app.js / shell.js   # 组合与右栏外壳（状态栏：停止生成、查看当前任务）
│   ├── task-steps.js       # 步骤清单组件：「当前任务」与「任务历史」共用
│   ├── current-task.js / execution-history.js  # 「当前任务」页 / 「任务历史」页（含任务所用技能）
│   ├── skill-entry.js / skill-detail.js / skill-library.js  # 各阶段「查看 skill」入口 / 技能详情页（基础、本剧补充、指导、预览）/ 设置页「技能库」
│   ├── drama-store.js      # 面板内的剧集数据模型存储
│   ├── api.js / dom.js     # 同源请求与 DOM 组件
│   └── styles.css
├── shared/                 # 前后端共用的领域模块（平铺，浏览器经 /plugins/meiji/shared/ 加载）
│   ├── drama-model.js      # 剧集数据模型（schemaVersion 2）
│   ├── gates.js            # 制作门禁：各阶段能否生成（canGenerate、gateOf、hasX）
│   ├── project-rules.js    # 时长/画幅规范化、上游变化时清理下游
│   ├── steps.js            # 步骤状态、任务状态推导 deriveTaskStatus、按目标分组、顺序执行器 executeSteps
│   └── feedback.js（审核结论、人工忽略自审规则）、shot-timing.js、reference-images.js、video-prompt-text.js、tail-frame.js、guidance.js
├── server/
│   ├── http/               # routes.js 鉴权路由与 client/shared 静态分发；library-routes.js 素材导入/读取/Range；skill-routes.js 技能接口（只供面板）
│   ├── flow/
│   │   ├── operations/     # run.js 操作入口 runOperation（面板与会话共用）、registry 操作定义（范围/队列/步骤计划/agent 可否）、
│   │   │                   #   execute 分派流水线、finish 结束释放、
│   │   │                   #   project / story / images / films 各领域处理函数（films 含逐镜成片 shotSteps）
│   │   └── tasks/          # runner.js 任务执行器（入队写记录、启动、查询、等待、取消、当前任务）、
│   │                       #   queue.js 全局队列（text / image / video 并发上限）、restart.js 启动时取消遗留任务（网关无取消接口，远端视频如实记录）
│   ├── generate/           # 网关调用与生成：gateway、text-request、text-steps（生成/自审/修订/复审步骤）、
│   │                       #   story、shot-text、image、film、concat、review、ffmpeg 检查
│   ├── prompts/            # interfaces/<阶段>.js 独立定义各接口的 system/user/prompt；skill-prompts.js 提供可选片段；preview.js 复用真实组装
│   │                       # interfaces/character-image.js 集中人物字段选择、约束分节选择、修改意见与人物预览；约束正文在 skills/constraints/
│   │                       # models/character-image-model.js 定义人物模式、角色职责、资料、规则、Base64 图片、画幅与修改意见；人物修改经 model.toPrompt() 生成提示词
│   │                       # models/scene-image-model.js 定义场景五项资料、规则、本剧补充、Base64 图片与画幅；场景生成/修改及预览由接口赋值后复用 model.toPrompt()/toSegments()
│   ├── data/               # 持久化：projects（领域存储）、project-files（存储布局，唯一了解文件结构）、
│   │                       #   episodes、library、workspace-links、model-settings、review-checks、
│   │                       #   task-store（任务与步骤、runStep、内容快照、任务固定的技能组合）、operation-context（一次操作的审核上下文）、
│   │                       #   skill-store（技能基础修改层、本剧层与组合快照）、custom-skills（本剧指导素材）等
│   └── host/               # Harness 适配层（唯一接触 Harness 的地方）：workspaces（workspaceRegistry）、
│                           #   session-log（会话命令日志）
├── models/model-config.js  # 网关地址校验、默认配置读取、用途（chat/story/image/video）→ 模型路由
├── config/models.json      # 网关地址、模型名、并发上限默认配置（入 git，不含密钥）
├── config/models.local.json # 本地密钥等，覆盖 models.json 同名字段（git 忽略，需自行创建）
├── tools/                  # Harness 会话工具 session-*-tool.js（4 个）
├── skills/                 # 技能：stages/（阶段技能，按字段存放）guidance/（指导技能）shared/（共享模块）
│                           #   constraints/character/generate-character-image.md（人物固定约束，只读，可为空）；constraints/scene/generate-scene-image.md（场景生成正文，仍使用既有可编辑语义）
│                           #   agent/panel.md（唯一注册给 Harness 的会话说明）references/minimax-h3（官方参考）；load.js 按字段读取与校验
├── h3skill/                # MiniMax-H3 官方 skill 归档，只读参考，不注册、不注入
├── scripts/                # 迁移脚本（参数为 DSH_HOME），统一 migrate- 前缀：migrate-model（模型 v2）、migrate-layout（存储布局 v2）、migrate-task-steps（任务记录 v2）、migrate-custom-skills（补充 skill 与指导素材按集 → 按剧）、migrate-tail-frame、migrate-image-url（删除网关文件地址 imageUrl）；prompt-diff.js 为开发用的提示词差集脚本
├── tests/                  # node --test；fixtures/（测试密钥、jsdom 加载、模拟 workspaceRegistry）
├── docs/                   # 架构与数据说明（tasks-and-steps.md：任务与步骤；gateway-api.md：网关接口）
└── reports/                # 本地生成报告（git-ignored）
```

## 3. 模块职责与调用链

依赖只能从高层指向低层（`tests/architecture.test.js` 强制）：

```text
http / tools → flow → generate → prompts → data → models
                     host（Harness 适配）与 shared（领域模块）可被任意服务端层引用；服务端不引用 client/
```

| 目录 | 职责 |
|---|---|
| `index.js` | `apply(ctx)`：登记 Harness 适配层、取消遗留任务、检查 ffmpeg、创建任务管理器、注册面板路由、4 个会话工具；校验技能结构，只把会话说明技能注册给 Harness |
| `client/` | 右栏面板 UI；通过 `api.js` 调用 `/plugins/meiji/*` 接口 |
| `shared/` | 数据模型、门禁与流程规则等纯函数，浏览器与 Node 通用 |
| `server/http/` | 鉴权、同源校验、分发面板操作，素材上传下载与 Range |
| `server/flow/` | 操作定义、入口与分派、任务执行器与队列、启动取消 |
| `server/generate/` | 调用网关：文本、图片、视频提交与轮询、自审修订、ffmpeg 抽帧与拼接；图片经调用 API、下载并转 Base64、保存候选三个独立步骤执行 |
| `server/prompts/` | `interfaces/<阶段>.js` 独立定义各接口的生成、审核、修订结构；`interfaces/registry.js` 只分发；`skill-prompts.js` 提供可选的技能片段、覆盖层与来源标注；`preview.js` 复用各接口组装函数 |
| `server/data/` | 项目、剧集、素材、图片、任务与步骤记录等持久化 |
| `server/host/` | 通过公开的 `workspaceRegistry` 查工作区与会话；写会话命令日志 |
| `models/`、`config/` | 模型路由与默认配置 |
| `tools/` | Harness agent 可调用的工具：上下文查询、项目管理、内容生成、任务控制 |
| `skills/` | 内置技能（按字段的 Markdown + `skill.json`）；固定约束集中在 `constraints/<id>.md`，显式启用，空文件不添加约束，不接受基础/本剧覆盖。其他可编辑技能由 `server/data/skill-store.js` 叠加覆盖层 |

```text
面板操作：client → server/http/routes.js → flow/tasks/runner.js（写任务记录、queue 限流）→ flow/operations/run.js(runOperation)
            → operations/execute.js → operations/<领域>.js → generate/*（网关） → data/*（落盘）
会话操作：Harness agent → tools/session-*-tool.js → flow/tasks/runner.js → 同上（人工专属操作返回 403）
```

执行模型：**操作 → 任务 → 步骤 → 内容节点**（详见 `meiji/docs/tasks-and-steps.md`）。

| 概念 | 是什么 | 状态由谁决定 |
|---|---|---|
| 操作 | `registry.js` 中的定义：步骤计划、作用范围、队列类别、agent 能否调用 | — |
| 任务 | 一次操作的执行实例，存为 `history/tasks/<taskId>.json` | 只从步骤推导（`shared/steps.js` 的 `deriveTaskStatus`） |
| 步骤 | 任务里的一次具体工作（生成、自审、修订、复审、保存、提交视频……） | 执行器 `runStep` |
| 内容节点 | 项目里的一块内容（摘要、镜头表、S01 视频……） | 步骤写入、人工编辑、上游变化 |

## 4. 运行数据

持久化根目录为 `$DSH_HOME/storages/meiji/`（`DSH_HOME` 缺省为 `~/.dsh`），源码与用户数据分离。

```
storages/meiji/
├── models.json                              # 运行中模型配置，文本/图片/视频共用
├── projects/<projectId>.json                # 项目索引（layout: 2，revision 递增；episodes 只存 { id, file }；skills 为本剧补充、启用的指导与指导素材）
├── projects/<projectId>/episodes/<episodeId>.<版本>.json  # 每集一个文件
├── projects/<projectId>/                    # 专属工作区：images/ films/ boards/ covers/ history/（任务记录）
├── skills/<skillId>.json                     # 技能基础修改层（面板编辑，只存改过的字段、哈希、所基于的内置哈希与上一版本）
├── assets/<category>/<assetId>/             # 全局素材：characters scenes props audio video guidance
├── image-drafts/<draftId>/                  # 待确认图片预览
└── incoming/                                # 导入暂存
```

迁移备份位于 `$DSH_HOME/backups/`。
