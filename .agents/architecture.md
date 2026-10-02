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
│   ├── panel-events.js     # 插件事件连接：隐藏释放、可见重连刷新、创建期间暂停、页面退出清理
│   ├── task-steps.js       # 步骤清单组件：「当前任务」与「任务历史」共用
│   ├── task-prompt.js      # 查看步骤实际提示词：点击加载完整快照，按请求展示与复制
│   ├── current-task.js / execution-history.js  # 「当前任务」页 / 「任务历史」页（含任务所用技能）
│   ├── node-skill.js       # 摘要/大纲/人物/场景节点的基础/补充双页签，补充整段保存
│   ├── skill-entry.js / skill-detail.js / skill-library.js  # 各阶段「查看 skill」入口 / 技能详情页（默认基础 tab、补充整段编辑保存）/ 设置页「技能库」
│   ├── drama-store.js      # 面板内的剧集数据模型存储
│   ├── api.js / dom.js     # 同源请求与 DOM 组件（showPanelDialog：面板范围弹窗，不锁住会话）
│   └── styles.css
├── shared/                 # 前后端共用的领域模块（平铺，浏览器经 /plugins/meiji/shared/ 加载）
│   ├── drama-model.js      # 剧集数据模型（schemaVersion 2）
│   ├── gates.js            # 制作门禁：各阶段能否生成（canGenerate、gateOf、hasX）
│   ├── episode-summary.js  # 剧集摘要非空校验与字数统计（无上限）、用户时长校验，前后端统一口径
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
│   ├── prompts/            # request.js 统一文本请求结构（system＝角色/规则/补充/语言/协议，user＝任务/资料/基稿与意见/待审内容）；skill-prompts.js 提供技能片段（生产规则、审核标准、补充、协议）；interfaces/registry.js 选择接口；preview.js 复用真实组装
│   │                       # interfaces/character-image.js 集中人物字段选择、约束分节选择、修改意见与人物预览；约束正文在 skills/task/
│   │                       # episode-prompts.js + models/episode-summary-model.js：model 编排任务、目标时长/语言/风格、故事资料、前后集条件与修改意见；生成、意见修订、独立审核分别使用 model 三类入口；共享上下文及预览，审核对照对应修订基稿
│   │                       # models/story-model.js：大纲、人物、场景、道具四类剧情资料共用 StoryModel，差异在 storyKinds 中声明（职责、资料、目标、审核范围、输出协议）
│   │                       # models/text-step-model.js：镜头表、整集/单镜每秒指令、单镜修订、图片提示词改写共用 TextStepModel，差异在 textSteps 中声明；shot-prompts.js 以 { task, review, facts } 传入任务、审核目标与上游资料
│   │                       # models/character-image-model.js 定义人物模式、角色职责、资料、规则、Base64 图片、画幅与修改意见；人物修改经 model.toPrompt() 生成提示词
│   │                       # models/scene-image-model.js 定义场景五项资料、规则、本剧补充、Base64 图片与画幅；场景生成/修改及预览由接口赋值后复用 model.toPrompt()/toSegments()
│   ├── data/               # 持久化：projects（领域存储）、project-files（存储布局，唯一了解文件结构）、
│   │                       #   episodes、library、workspace-links、model-settings、review-checks、
│   │                       #   task-store（任务与步骤、runStep、内容快照、任务固定的技能组合）、operation-context（一次操作的审核上下文）、
│   │                       #   node-skills（各集节点补充）、skill-store（基础修改层、本剧指导与组合快照）、custom-skills（本剧指导素材）等
│   └── host/               # Harness 适配层（唯一接触 Harness 的地方）：workspaces（workspaceRegistry）、
│                           #   session-log（会话命令日志）、step-prompt-log（公开 snapshotEvents 中有明确任务归属的旧请求提示词）
├── models/model-config.js  # 配置保存校验、默认配置读取与无校验路由展开；生成请求仅在 gateway.js 校验当前路由
├── config/models.json      # 网关地址、模型名、并发上限默认配置（入 git，不含密钥）
├── config/models.local.json # 本地密钥等，覆盖 models.json 同名字段（git 忽略，需自行创建）
├── tools/                  # Harness 会话工具 session-*-tool.js（4 个）
├── skills/                 # task/ 平铺功能生产规则；catalog.js 注册，protocols.js 维护输出协议
│                           #   task/generate-character-image-skill.md（人物固定约束，只读，可为空）；task/generate-scene-image-skill.md（场景生成正文，仍使用既有可编辑语义）
│                           #   session/panel.md（唯一注册给 Harness 的会话说明）references/minimax-h3（官方参考）；load.js 按字段读取与校验
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
| `skills/` | 基础生产规则在 constraints 平铺，一功能一份；catalog.js 注册，protocols.js 管理格式；基础只读，任务固定正文与当前节点补充 |

```text
面板操作：client → server/http/routes.js → flow/tasks/runner.js（写任务记录、queue 限流）→ flow/operations/run.js(runOperation)
            → operations/execute.js → operations/<领域>.js → generate/*（网关） → data/*（落盘）
会话操作：Harness agent → tools/session-*-tool.js → flow/tasks/runner.js → 同上（人工专属操作返回 403）
```

执行模型：**操作 → 任务 → 步骤 → 内容节点**（详见 `meiji/docs/tasks-and-steps.md`）。

视频任务依次执行「提交视频 → 生成并保存视频 → 提取尾帧」。尾帧依赖本机 FFmpeg，提取失败时任务明确失败、保留已保存视频；`tail-frame` 可单独重试。整集/逐镜制作遇到已完成视频缺少当前版本尾帧时补提取，不重复提交视频。

每秒分镜由模型一次返回整集 shots JSON（version:1），程序审核镜头集合、实体标记、毫秒时长与对白事件，模型审核语义，最多自动修订一次；有明确失败镜头时仅修订该范围并由程序合并。`shared/seconds-content.js` 同时负责校验与可读正文。`shared/entity-references.js` 提供按人物/场景/道具分组的实体目录，正文统一写作「名字【名字|ID】」（镜头表标题行除外），渲染与校验前用 collapseMentions 收拢；ID不依赖图片。

每秒指令修订由 `prompts/seconds-feedback.js` 解码已有审核原因并分出程序与语义问题、精确去重，人工意见独立读取本轮输入。TextStepModel 在生成、修订、复审中组装基稿与三类意见，明确同编号镜头表优先；Model 决定输出范围，generateAllSeconds 仅合并结果。语义修订范围读取 location，程序问题读取实际校验原因中的镜头；无法明确定位时覆盖整集，不从修正建议中猜镜头。

`server/prompts/video-prompt-renderer.js` 直接将已通过的每秒分镜编译为有图六字段或无图三字段；不调用模型重写，保留动作、机位、空间、段末状态和唯一对白。`referenceSnapshot` 冻结 Picture 顺序，Subject 标识实体；服装共享所属角色 Subject，武器等独立。`sourceMap` 记录来源，人工编辑后移除。人工编辑仍进行程序格式审核与模型语义审核。剧情修改意见在每秒分镜提交，最终提示词支持直接编辑。图片仅在视频提交时读取本地文件并按冻结顺序转 Base64；版本或素材变化要求重新组装。

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
│   └── history/prompts/<promptId>.json        # 步骤请求前保存的完整提示词；steps.prompts 只存引用与时间，沿用 history 会话鉴权
├── skills/<skillId>.json                     # 技能基础修改层（面板编辑，只存改过的字段、哈希、所基于的内置哈希与上一版本）
├── assets/<category>/<assetId>/             # 全局素材：characters scenes props audio video guidance
├── image-drafts/<draftId>/                  # 待确认图片预览
└── incoming/                                # 导入暂存
```

迁移备份位于 `$DSH_HOME/backups/`。

## 5. 摘要草稿与请求边界

- 剧集弹框先填参考时长（默认 150 秒），可在摘要为空时发起 `episode-summary-draft`；复用任务队列、步骤、取消、历史。结果保存为未发布 artifact，`latestOutputs` 指向 `summary-draft`；不改项目文件。保存按钮才调用 episode-add/edit。
- 总摘要、用户时长与全部前集摘要决定本集；后集仅作衔接约束。时长保持用户设定值（1–86400 秒），剧集摘要必须非空、不设字数上限；生成、审核、手工编辑与 source 保存口径一致，页面仅统计字数，不按字数推断时长。规则违规与语义审核合并，最多自动修订一次；无效摘要不落入剧集。项目总摘要仍保持原 10000 字上限。
- 摘要基础生产规则在 `skills/task/generate-episode-summary-skill.md`；生成与审核共用，修订增加基稿和意见，身份与输出协议由 Model 代码编排。
- 所有外部生成请求在 `gateway.js` 发出前校验地址、密钥及当前生成模型；轮询/下载不要求生成模型。第三方图片下载不附网关密钥。删除缺密钥时的 ComfyUI 隐式回退。

## 6. 剧情分步生成

- 大纲生成与修订直接返回七小节纯文本，不输出 JSON 或 outline 字段；审核与修改基稿也直接使用正文，保存到已有 plot.outline.content 字符串，无存储结构迁移。人物、场景提取仍分别返回 items JSON。
- 剧情操作依次执行大纲、提取人物、提取场景、提取道具四组文本步骤，各自独立调用生成、审核，失败最多自动修订一次；前项未通过停止后项。
- 提取使用本轮审核通过后的最终大纲，不带旧卡片基稿或旧意见；单独按意见修改卡片时只修改该类资料。
- 人物/场景 Model 将任务与目标合并，user 依次提供核心大纲、风格参数、修订基稿与意见；不携带大纲阶段的指导素材。基础规则、当前节点补充、语言及完整 items 输出协议进入 system，审核独立编排并只验收该类最新卡片。
- 草稿逐阶段保存，已通过阶段不会被后项错误或取消改判失败。未提取卡片保留原素材但标过期；镜头及后续资料清空。
- 任务计划按 outline、characters、scenes、props 分组；持久化历史继续保存 story 聚合快照，审核结果按四项聚合。

人物/场景图片 UI：`character.js`、`asset-cards.js` 列表图片下方支持默认文生图，按当前剧集和卡片匹配候选，卡片内预览并确定或放弃；生成中两按钮禁用。人物详情主图在左、参考图在中、操作在右；只有一个 AI生成按钮，有参考图自动走多图生成单图接口，无参考图走文生图，右侧同时提供画幅、图片管理、确定/放弃、任务历史及 skill。场景详情保持既有入口。`session.js` 在当前剧情列表直接展示候选，其余页面保留进入详情提示。列表与详情复用 `image-review.js` 的确认动作；独立图片确认组件供道具、铅笔分镜等流程使用。人物详情不再提供服装/坐骑/道具/发型附属图片生成。

图片实际请求由 CharacterImageModel / SceneImageModel 编排，角色只写身份，任务、核心卡片资料、画幅参数、参考图片、修改意见、基础/补充规则与输出协议各自分区，无独立资料边界。文生图、参考图、原图修改及模板预览共用 Model；人物模板资料通过 toSegments 的 factsText 参数赋值。Base64 仅另传图片接口，不进入 prompt。

## 7. 统一 AI 审核协议

所有 AI 审核和复审共用 `shared/review-result.js` 的协议，启用 JSON 请求模式，返回 `{passed, issues}`；每项问题为非空 `location/reason/requirement`。通过必须空问题，未通过必须有问题。执行器严格校验，不接受旧 PASS/FAIL 文本、围栏或相互矛盾的结论。各流程通过可选 check 和 prompts.review 分别声明程序审核与模型审核，无需用户开关；可只运行一种或均不运行。两种来源在同一自审步骤的 attempts 分别记录。程序校验问题并入结构化问题，自动修订及复审接收同一份 JSON 意见，最多修订一次。已有节点 `check.failures` 和任务步骤 `reasons` 保存可读的位置/原因/修正要求，页面按现有展示入口逐项显示。审核响应协议错误是执行失败，不伪装成审核未通过，不触发修订、不覆盖已保存草稿；无存储结构变更，无历史数据迁移。

整集每秒分镜动态注入全部镜头 ID 与时长清单，JSON shots 必须完全覆盖；每镜节拍使用正整数 durationMs，程序累计起止时间。dialogues 独立保存台词，beat 只引用事件 ID；ambient、music 保存带时间的声音事件。镜头清单唯一对应上游时，全部镜头正文都保存，逐镜校验错误汇总并保留失败状态；失败卡片显示正文与原因，结构损坏时展示原 JSON。生成与自动修订的原始响应以 seconds-response 任务快照保存，无法解析或匹配的响应也可在历史查看，不覆盖旧镜头。格式错误不能人工放行到下游。旧自由文本由 migrate-seconds-content.js 先备份后保留 archivedContent，标记后续产物过期，需重新生成每秒分镜。

道具保存在 plot.props，分类 clothing/mount/weapon/accessory/prop，字段 name/category/description/ownerId/evidence；程序分配稳定 P 编号，不要求参考图。道具由 story-model.js 的 props 配置编排，规则为 extract-story-props-skill.md，审核为 review-story-props-skill.md。允许空集合通过，道具审核纳入镜头表门禁，人物/场景/道具 ID 按名称保留，新增 ID 递增。

生成正文的漏镜、时长及格式问题归入程序自审，不在生成步骤提前中断；不可解析或无法对应上游的原文以未发布任务 artifact 留存，修订使用完整原文，始终不覆盖原项目内容。未配置审核时结论保持未审核。

道具图片：场景区下的独立道具卡通过 `image` 操作、`image:Pnn` 节点生成/修改图片；`part-image` 仅为道具图片基础 skill ID，旧人物槽位生成操作已移除。候选人工确认后入 props 素材库，可导入和关联已有素材；不删除历史人物附属素材。大纲明确必要场景、物件与着装；场景/道具提取仅依据大纲，人物/场景目录仅匹配 ownerId，不从卡片外观补造道具。
