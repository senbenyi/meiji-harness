# GitHub AI 短剧项目：功能、流程、架构与选型对比

> 状态：已完成桌面调研，尚未进行同题材生成实测<br>
> 基线：2026-10-01；各项目默认分支 HEAD，具体提交见“仓库核验”<br>
> 范围：比较公开仓库中的产品能力、创作流程、工程架构、部署与许可证；不把 README 宣传等同于生成质量实测

## 0. 三十秒结论

- **综合首选：ArcReel。** 它是本批项目中流程覆盖、Agent 编排、供应商抽象、任务与数据层、测试和运维文档最均衡的完整生产系统。代价是系统较重，并采用 AGPL-3.0；闭源 SaaS 二开必须先处理合规问题。
- **闭源商业二开的优先候选：LumenX、Novella、Jellyfish、ViMax、Toonflow、AID Studio。** 它们分别偏向全链路成片、多 Agent 本地桌面制片、镜头精控、长篇小说 Agent 工作流、无限画布/节点扩展、多人运营与计费后台，许可证均为 MIT 或 Apache-2.0。
- **本轮扩展检索发现两个不可忽略的国际路线：** [AI Video Production Editor](https://github.com/LudwigKienle/ai-video-production-editor) 把 3D 预演、连续性复审、非编、调色、声音与交付连成专业制片闭环；[Story Claw](https://github.com/ZC89757/story-claw) 专门处理数百章网文中的人物阶段变化、固定声线、VLM 质量门和本地 LTX 渲染。
- **批量漫剧与 Seedance 优先：moyin-creator。** 角色圣经、六层身份锚点、多镜头合并和批量队列很突出，但 AGPL、无公开测试/CI、闭源商用需另购许可。
- **本地、隐私和个人创作者优先：LocalMiniDrama。** Windows/Electron、本地数据、画布流水线和分组重跑比较完整，工程治理和多人协作弱于前六名。
- **不要被超高 Star 误导：MoneyPrinterTurbo 与 Pixelle-Video 更接近“解说/素材型短视频生成器”，不是以多角色、多场景、分集连续性为核心的短剧制片系统。** 它们在口播、字幕、BGM、库存素材、模板化成片方面反而更成熟。
- **三项不能按“可自由商用的开源底座”理解：** Huobao Drama 使用 CC BY-NC-SA 4.0，禁止商业使用；waoowaoo 使用 Elastic License 2.0，不能把主要功能作为托管服务提供给第三方；BigBanana 使用自定义非商用社区许可证，而且当前公开仓库没有完整应用源码。
- **最值得进入实测的五个候选：ArcReel、LumenX、Novella、ViMax、Jellyfish。** 若目标明确是专业影视后期，加入 AI Video Production Editor；若目标是超长网文改编，加入 Story Claw；若目标是 SaaS 运营后台，再加入 AID Studio。

## 1. 对比维度与判定方法

“能生成视频”不足以判断一个项目能否生产短剧。真正影响短剧生产的是叙事拆分、资产连续性、镜头可控性、长任务恢复和成片交付。因此采用以下 12 个维度，总分 100：

| 维度 | 权重 | 主要问题 |
| --- | ---: | --- |
| 全流程覆盖 | 15 | 是否覆盖输入、策划、角色/场景、剧本、分镜、图像、视频、音频和导出 |
| 长文本与分集叙事 | 8 | 是否支持小说压缩、分集/分幕、事件与人物追踪，而非只生成一段文案 |
| 角色/场景/道具一致性 | 12 | 是否有资产库、角色圣经、参考图、服装状态和跨镜复用 |
| 镜头与人工精控 | 10 | 是否能逐镜审核、改提示词、控制机位/运镜/首尾帧并局部重跑 |
| 配音、字幕、配乐与合成 | 8 | 是否能产出可发布成片，或可靠导出到后期工具 |
| 模型与供应商扩展 | 8 | 文本、图像、视频、TTS 是否抽象；能否接本地模型、ComfyUI 或自定义 API |
| 批量、任务与失败恢复 | 8 | 并发、队列、重试、取消、续跑、状态追踪和成本控制是否完善 |
| 架构与可维护性 | 10 | 模块边界、类型/接口、测试、CI、迁移、文档和扩展点是否清晰 |
| 部署、数据与运维 | 6 | 桌面/Docker/服务器部署、数据可迁移性、备份、数据库和隐私 |
| 产品化与多人运营 | 5 | 用户、权限、计费、后台、项目组织和协作能力 |
| 成熟度与社区 | 5 | 当前维护、版本、文档、Issue、测试和用户规模；Star 只占一小部分 |
| 许可证与商用可行性 | 5 | 是否为 OSI 开源许可证，闭源、SaaS、分发和商用有哪些约束 |

评分为 0–5 分再按权重折算。README 可证明“项目声明支持什么”，源码目录、配置、测试与 CI 才能提高工程分；没有进行同输入、同模型的实测，因此生成质量、成本和速度不进入本轮排名。

## 2. 仓库去重与真实性核验

用户清单共有 15 个 URL，但实际是 14 个项目。本轮又对国内外 18 个新候选逐仓核验，最终有 3 个达到“应进入主比较”的门槛，因此主表扩展为 17 个项目：

- `saturndec/waoowaoo` 已重定向到 `waooAI/waoowaoo`，不能重复计数。
- `AIDC-AI/Pixelle-Video` 已迁移/重命名为 `ATH-MaaS/Pixelle-Video`。
- 用户所写 `waooAI/waoowaoo` 与 `saturndec/waoowaoo` 是同一个仓库的现/旧地址。

### 2.1 基线、活跃度与许可证

Star、Issue 和更新时间是 2026-10-01 的快照，会继续变化。Issue 数不是质量分，活跃项目也可能因为用户多而有更多 Issue。

| 项目 | Star | 默认分支 HEAD | 最近提交 | 许可证判定 | 当前状态 |
| --- | ---: | --- | --- | --- | --- |
| [ArcReel](https://github.com/ArcReel/ArcReel) | 5,256 | [`a51002c93f99`](https://github.com/ArcReel/ArcReel/commit/a51002c93f9905c2ed5aaff7fda29dda20243264) | 2026-10-01 | AGPL-3.0 | 活跃，完整源码 |
| [Novella](https://github.com/Agions/novella) | 116 | [`3618e31c532a`](https://github.com/Agions/novella/commit/3618e31c532a9a3dd38c3f11a0f7ceef37dea00a) | 2026-09-08 | MIT | 多 Agent 桌面平台；v0.0.1，源码/测试/CI 完整 |
| [AI Video Production Editor](https://github.com/LudwigKienle/ai-video-production-editor) | 61 | [`07ae563157ed`](https://github.com/LudwigKienle/ai-video-production-editor/commit/07ae563157ed18d0f903bbf324a450839cce0111) | 2026-09-22 | GPL-3.0-or-later | 专业制片工作站；完整源码 |
| [Story Claw](https://github.com/ZC89757/story-claw) | 23 | [`d99b71b410ac`](https://github.com/ZC89757/story-claw/commit/d99b71b410acd0d8a0846ed08fb1d1d96e8c679f) | 2026-09-26 | MIT | 长篇小说、本地 ComfyUI/LTX 专项管线 |
| [AID Studio](https://github.com/gzxx-2025/aid-studio) | 695 | [`c8fc660dee2a`](https://github.com/gzxx-2025/aid-studio/commit/c8fc660dee2a79772a59a6ecdbf12e75120cee31) | 2026-09-30 | MIT | 活跃，完整业务平台 |
| [Jellyfish](https://github.com/Forget-C/Jellyfish) | 6,539 | [`a9678194ddf2`](https://github.com/Forget-C/Jellyfish/commit/a9678194ddf2d9be3ccbe78d4287d87d5089e123) | 2026-04-20 | Apache-2.0 | 源码与文档完整；默认分支 HEAD 较早 |
| [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) | 127,727 | [`2e1b30396e05`](https://github.com/harry0703/MoneyPrinterTurbo/commit/2e1b30396e059e55939cc802c60faac2061e4d41) | 2026-10-01 | MIT | 高度活跃；定位偏短视频 |
| [Toonflow](https://github.com/HBAI-Ltd/Toonflow-app) | 16,299 | [`ec8f54597bf6`](https://github.com/HBAI-Ltd/Toonflow-app/commit/ec8f54597bf6e6114ed56b832f9052cd6f735311) | 2026-09-29 | MIT | 活跃；当前架构为画布 + Agent/节点 |
| [Huobao Drama](https://github.com/chatfire-AI/huobao-drama) | 15,625 | [`f0f69ef5bedd`](https://github.com/chatfire-AI/huobao-drama/commit/f0f69ef5bedd312eb1f75f06941f0383c3b6656c) | 2026-09-28 | CC BY-NC-SA 4.0 | 非商业源代码；不宜称为标准软件开源 |
| [waoowaoo](https://github.com/waooAI/waoowaoo) | 14,342 | [`dfec20e32298`](https://github.com/waooAI/waoowaoo/commit/dfec20e32298ed675050329e4a41477024148399) | 2026-09-21 | Elastic License 2.0 | source-available；托管服务受限 |
| [moyin-creator](https://github.com/MemeCalculate/moyin-creator) | 4,637 | [`7e5c5655de94`](https://github.com/MemeCalculate/moyin-creator/commit/7e5c5655de94d49885e13c369f0a71212893a0aa) | 2026-08-27 | AGPL-3.0 / 商业双许可 | 完整桌面源码；闭源需商业许可 |
| [BigBanana](https://github.com/shuyu-labs/BigBanana-AI-Director) | 2,305 | [`87bc1db71414`](https://github.com/shuyu-labs/BigBanana-AI-Director/commit/87bc1db714140efcd056111a7e7ef48e754f030a) | 2026-09-29 | 自定义非商用社区许可 | 仅约 32 个公开文件，无完整应用源码 |
| [Pixelle-Video](https://github.com/ATH-MaaS/Pixelle-Video) | 28,548 | [`848b054e4fae`](https://github.com/ATH-MaaS/Pixelle-Video/commit/848b054e4fae40dabc62ec58e960b573e83793ac) | 2026-06-14 | Apache-2.0 | 完整源码；定位偏解说/漫画视频 |
| [ViMax](https://github.com/HKUDS/ViMax) | 12,542 | [`fd4b72e7731b`](https://github.com/HKUDS/ViMax/commit/fd4b72e7731be6e5f88486206d25ea59849b0285) | 2026-09-30 | MIT | 活跃的 Agent 视频框架 |
| [LocalMiniDrama](https://github.com/xuanyustudio/LocalMiniDrama) | 1,901 | [`adaecf71a382`](https://github.com/xuanyustudio/LocalMiniDrama/commit/adaecf71a38277126fbe1e5e0d79664300f855c1) | 2026-09-14 | MIT | 本地桌面完整源码 |
| [FastMovieAI](https://github.com/xhadmincn/FastMovieAI) | 421 | [`31c324c3bcce`](https://github.com/xhadmincn/FastMovieAI/commit/31c324c3bcce36121e7d6c21df830fceb259d82c) | 2026-02-19 | Apache-2.0 | 商业平台脚手架；维护活跃度偏低 |
| [LumenX](https://github.com/alibaba/lumenx) | 1,318 | [`f2a02e231714`](https://github.com/alibaba/lumenx/commit/f2a02e23171447c939e7d8e1386b24d17049bbf1) | 2026-08-11 | MIT | 完整源码，Studio + Playground |

### 2.2 许可证对选型的实际影响

| 类型 | 项目 | 对二开的影响 |
| --- | --- | --- |
| MIT / Apache-2.0 | Novella、Story Claw、AID Studio、Jellyfish、MoneyPrinterTurbo、Toonflow、Pixelle-Video、ViMax、LocalMiniDrama、FastMovieAI、LumenX | 最适合闭源商业二开；仍需保留版权/NOTICE 并检查模型、素材和依赖的单独条款 |
| GPL-3.0-or-later | AI Video Production Editor | 可商用和内部使用；若分发衍生桌面软件，通常需要按 GPL 提供对应源码。与 AGPL 不同，单纯提供网络服务不自动触发同样的网络源码义务 |
| AGPL-3.0 | ArcReel、moyin-creator | 可以商用，但通过网络提供修改版服务通常需要向用户提供对应源码；不适合未经法务设计的闭源 SaaS |
| CC BY-NC-SA 4.0 | Huobao Drama | 明确限非商业；Creative Commons 也不推荐作为软件许可证使用 |
| Elastic License 2.0 | waoowaoo | 可内部使用和修改，但不能向第三方提供覆盖主要功能的托管/管理服务；不是 OSI 开源许可证 |
| 自定义非商用许可 | BigBanana | 个人学习/研究可用；商业部署、内部生产、SaaS、OEM 和白标均需另行授权 |

## 3. 创作能力总览

标记说明：`强` 表示有明确产品流程与源码结构支持；`中` 表示可实现但不是核心；`弱` 表示缺少短剧领域结构；`声明` 表示 README 描述强，但公开源码不足以验证。

| 项目 | 小说/分集 | 资产一致性 | 逐镜精控 | 图/视频生成 | 配音/字幕/成片 | 批量与恢复 | 最突出的定位 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ArcReel | 强 | 强 | 强 | 强 | 强，含剪映草稿 | 强 | 最均衡的 Agent 化全流程生产系统 |
| Novella | 强 | 强 | 强 | 强 | 强，TTS/字幕/4K 压制 | 强 | Hub-and-Spoke Agent + 共享黑板桌面制片 |
| LumenX | 中强 | 强 | 强 | 强，I2V/R2V | 强，时间线 + FFmpeg | 强 | Pipeline-first 成片与统一模型目录 |
| ViMax | 强 | 强 | 强 | 强 | 中强 | 强，并行生成/续跑 | Idea/Script/Novel 三入口的 Agent 框架 |
| Jellyfish | 中强 | 很强 | 很强 | 强 | 中 | 强，统一异步任务中心 | 候选确认、镜头准备与一致性精控 |
| Toonflow | 中强 | 强 | 强 | 强 | 中 | 强 | 无限画布、节点、Agent、MCP/A2A 扩展 |
| AID Studio | 中强 | 强 | 强 | 强 | 强 | 强 | 用户/计费/管理后台完整的运营平台 |
| AI Video Production Editor | 中 | 强 | 很强，含 3D 预演 | 强 | 很强，剪辑/调色/声音/交付 | 强 | 最接近专业影视工作站的开源项目 |
| LocalMiniDrama | 中强 | 强 | 强 | 强 | 强 | 中强，工作流组重跑 | 本地隐私与桌面画布工作流 |
| Story Claw | 很强 | 很强，阶段化角色/场景 | 中强 | 强，本地 LTX | 强，固定声线/BGM/SFX | 很强，VLM 门禁/续跑 | 超长网文批量改编与自有 GPU 渲染 |
| moyin-creator | 中强 | 很强 | 很强 | 很强，Seedance 多模态 | 中 | 强 | 批量漫剧、角色圣经、多镜头合并 |
| waoowaoo | 中强 | 强 | 很强 | 强 | 弱至中；当前预览无配乐/旁白控制 | 很强 | 画布、持久任务、供应商网关和商业工程治理 |
| Huobao Drama | 强 | 强 | 中强 | 强 | 中强 | 强 | 一句话/大纲驱动的高自动化 Agent 流程 |
| Pixelle-Video | 弱 | 弱 | 中弱 | 强 | 很强 | 强 | 解说、漫画、口播类模板视频 |
| FastMovieAI | 中 | 中 | 中 | 中强 | 强 | 中 | 带用户、会员、积分、支付的 SaaS 脚手架 |
| MoneyPrinterTurbo | 弱 | 弱 | 弱 | 强 | 很强 | 很强 | 主题到脚本/素材/配音/字幕/BGM 的短视频工厂 |
| BigBanana 公开仓 | 声明强 | 声明很强 | 声明很强 | 声明强 | 声明强 | 声明强 | 产品思路优秀，但当前公开仓不足以作为源码底座 |

## 4. 各项目核心特点、流程与架构优势

### 4.1 ArcReel

**核心功能与流程**

`小说 / 成品剧本 / 商品素材 → 内容分析与项目规划 → 角色/场景/道具资产 → 分集与结构化剧本 → 分镜图/多宫格 → 视频片段/旁白 → 成片或剪映草稿`

每个阶段既可以由 Agent 编排，也可以人工审核、修改和重生成。它同时覆盖小说、剧本、创意/商品素材入口，比只做“主题转短视频”的工具更接近制片系统。

**架构优势**

- Python 服务端 + 前端分离，具备 Agent Runtime、任务队列、供应商抽象和独立数据层。
- 同时支持 SQLite 与 PostgreSQL，并有迁移、验证、回滚、备份和反向代理文档，个人与服务器部署之间有升级路径。
- 测试、CI、数据库迁移和开发文档明显多于多数候选；模型、提示词与技能不是散落在页面逻辑里。
- 能导出剪映草稿，降低“平台内生成完但无法精修”的交付风险。

**局限**

- 代码量和系统复杂度高，部署、升级、供应商配置和任务排障成本也最高之一。
- AGPL-3.0 对闭源网络服务不友好；需要法务确认衍生作品、插件边界和源码提供方式。

**适合**：工业化长链路、多人/多项目、希望未来替换模型或扩展 Agent 的团队。

### 4.2 LumenX

**核心功能与流程**

`剧本分析 → 角色/场景/道具提取 → 三视图与定调资产 → 结构化分镜 → I2V/R2V 视频 → CosyVoice/Qwen3-TTS → 时间线 → FFmpeg 成片`

另有 Playground，可脱离剧本直接做文生图、文生视频、图生视频、参考生视频和视频编辑。

**架构优势**

- Studio 与 Playground 分开，避免“完整制片管线”和“单次生成试验台”互相污染。
- Next.js 前端、Python 后端、Tauri 桌面壳；`src/apps/comic_gen` 与 `src/apps/playground` 形成清晰业务边界。
- 统一模型目录把 GPT-Image、Wan、Seedance、Kling、Vidu 等的参数差异配置化，增加模型时不必在多个页面硬编码。
- 有后端 CI、测试、模型接入规范和大量设计文档；MIT 适合商业二开。

**局限**

- 项目较新、社区与生产案例少于 ArcReel/Toonflow/ViMax。
- 小说级压缩、跨集人物记忆和大规模多租户运营不是当前最强项。

**适合**：需要“剧本到可发布成片”、又希望保留闭源商用空间的团队。

### 4.3 ViMax

**核心功能与流程**

`Idea / Script / Novel → 小说压缩与全局规划 → 事件/角色/场景提取 → 编剧与剧本增强 → 分镜/机位 → 参考图和首帧 → 并行图像/视频生成 → 最终合成`

提供 Idea2Video、Script2Video、Novel2Video 和 AutoCameo；Agent Loop/TUI 与 Web UI 可讨论方案、修订、保存会话、查看产物并控制渲染。

**架构优势**

- `agent_runtime`、`agents`、`interfaces`、`pipelines`、`tools` 分层明确；每个 Agent 承担小说压缩、角色提取、场景提取、分镜、美术选择等单一职责。
- 配置文件区分 Idea2Video、Script2Video 和不同视频供应商，适合研究、替换 Agent 或搭建自有管线。
- 有上下文压缩、会话索引、工具执行器、渲染状态持久化和并行生成，长篇/长任务基础比纯 UI 项目更扎实。
- MIT，且存在针对核心模块的测试。

**局限**

- 更像“可扩展 Agent 视频框架 + 工作台”，用户、计费、权限、多租户、运营后台不是重点。
- 需要较强工程能力调模型、提示词和运行环境；不属于下载后一步出片的小白工具。

**适合**：小说改编、研究型团队、自定义 Agent/模型管线、对叙事结构要求高的场景。

### 4.4 Jellyfish

**核心功能与流程**

`剧本拆解 → 镜头候选准备 → 资产/对白候选接受或忽略 → 绑定角色/场景/道具/服装 → 镜头 Ready → 图像/视频生成工作台 → 任务跟踪与导出`

它把“镜头是否准备好”设为显式状态，而不是让 AI 一路黑盒生成，是精品短剧生产中非常实用的设计。

**架构优势**

- React/Vite + FastAPI，前后端通过 OpenAPI 生成类型客户端，接口漂移风险较低。
- 角色、场景、道具、服装、镜头、提示词和生成任务是一级领域对象，一致性不是附加选项。
- 文本、图像、视频进入统一异步任务中心，支持状态、取消和恢复；架构文档单独描述镜头状态流、任务执行和提示词生成。
- Apache-2.0，测试与 CI 较完整，二开风险相对低。

**局限**

- 强项是“生产准备与镜头控制”，旁白、对白混音、字幕、配乐和终剪不如 LumenX/MoneyPrinterTurbo 明确。
- 默认分支 HEAD 的提交时间落后于仓库 `pushed_at`，正式采用前应确认发布分支和最新版本对应关系。

**适合**：人物一致性、逐镜审片、资产复用优先的精品内容团队。

### 4.5 Toonflow

**核心功能与流程**

当前版本将剧本、角色、场景、图像和视频片段放在同一张无限画布，通过工作流技能、Storyboard Team、节点与 Agent 协同完成资产和镜头生成。可接第三方 API、本地 ComfyUI/LLM，并通过 MCP、A2A 与外部工具或 Agent 连接。

**架构优势**

- Bun/TypeScript monorepo；桌面、Web、Server、更新服务与公共包分开。
- `packages/nodes` 将文本、音频、图像、视频、3D 导演等能力节点化；`packages/providers`、`tools`、`teams`、`skills` 提供较自然的扩展边界。
- 桌面、Docker、服务器和云平台入口齐全，本地数据控制较好。
- MIT；当前版本比早期 AGPL/Apache 附加协议更适合商业二开，但旧版本仍按旧许可证执行。

**局限**

- 当前仓库没有明显的自动化测试文件，功能增长快但回归保障弱于 ArcReel/Jellyfish。
- README 当前更强调画布与开放 Agent，用户描述的“小说一键工业闭环”不能仅凭旧宣传语视为已实测。

**适合**：喜欢无限画布、节点组合、本地 ComfyUI 和 Agent 扩展的创作团队。

### 4.6 AID Studio

**核心功能与流程**

围绕同一项目组织剧本、角色/场景、分镜、图片、视频、配音与单集导出，同时提供用户端创作台和管理端运营后台。模型、任务、用户、积分/计费、升级和内容运营是一体化考虑的。

**架构优势**

- Java 17 + Spring Boot 3.5 的 Maven 多模块单体：启动入口、公共安全/缓存/存储/支付组件、C 端接口、后台接口、Quartz 任务和前端相互分离。
- MySQL、任务调度、模型健康检查、账单抽取、僵尸任务回收和媒体清理等运维逻辑已经进入源码，不只是演示 UI。
- 管理端与用户端前端分离，适合做运营型平台；MIT。

**局限**

- 部署最重的一档，Java/MySQL/中间件与前后端多应用带来较高运维成本。
- 新项目、Star 少，真实大规模负载和长期升级兼容性尚未实测。

**适合**：需要用户、充值、后台管理、定时任务和模型运营的商业平台。

### 4.7 waoowaoo

**核心功能与流程**

`Assistant 共创 brief / 上传资料 → 工作区资源 → 画布组织 → 按模型能力生成图像/视频 → 首帧/首尾帧/参考图模式 → 结果精修与版本保留`

**架构优势**

- Next.js 全栈 + Prisma 数据模型，架构文档覆盖资源归属、画布节点、异步任务、持久执行、供应商网关、失败治理、日志可观测性、音频生产和计费审批。
- 任务生命周期、供应商能力和计费/审批被明确建模，适合复杂商业系统，而非简单前端串 API。
- 代码中有大量契约检查、烟测和运行诊断脚本，工程治理深度很强。

**局限**

- 当前 README 明确说明预览版没有音乐和旁白控制，因此“全流程到成片”不能按旧宣传直接认定。
- Elastic License 2.0 禁止把主要功能以第三方托管/管理服务形式提供；如果目标是 SaaS，必须取得单独许可。
- 模块多、迁移多、运行时复杂，二开门槛高。

**适合**：内部使用、复杂画布与商业任务治理；不适合未经授权直接做同类 SaaS。

### 4.8 LocalMiniDrama

**核心功能与流程**

`剧本/AI 故事 → 提取角色/场景/道具 → 每镜文本 → 首帧/尾帧 → 视频 → 配音 → 合并/导出`

画布中每镜一行，可切换经典链路和“全能分镜词→视频”；可框选镜头组成工作流组，再整组重跑图像、视频或配音。

**架构优势**

- Vue 3 + Node.js + Electron，本机存储，适合不希望把原始剧本和资产上传到平台的用户。
- 前端、Node 后端和桌面壳分开；角色库、场景库、分镜绑定、视频合并、导出和后处理都有独立服务。
- 三类模型独立配置，提示词可覆盖；MIT。

**局限**

- 本地优先意味着多人协作、集中队列、服务器弹性和统一权限较弱。
- 主要面向 Windows 桌面用户，工程测试和 CI 深度不及前几名。

**适合**：个人、小团队、本地隐私、希望下载即用并保留流程可视化。

### 4.9 moyin-creator

**核心功能与流程**

`多集/多幕剧本解析 → 角色圣经与六层身份锚点 → 场景生成 → 电影参数分镜 → 批量生图 → 批量生视频 → Seedance 多镜头合并叙事`

Seedance 2.0 路线可收集角色图、场景图、首帧图及音视频引用，自动融合动作、镜头语言和对白唇形提示词，并校验模型输入限制。

**架构优势**

- Electron + React + TypeScript + Zustand，桌面产品边界清晰。
- `@opencut/ai-core` 承担提示词编译、角色圣经和任务轮询；供应商管理、导演台、角色/场景、分镜和导出面板分离。
- 针对动漫番剧批量生产的队列、并行和自动重试设计比通用视频工具更贴题。

**局限**

- 没有明显的测试和 CI，可靠性主要依赖实际使用验证。
- AGPL-3.0；官方明确闭源商业集成需要商业许可。
- 强项集中在视觉与视频批量生成，完整对白编辑、混音、字幕与时间线精修证据弱于 LumenX。

**适合**：Seedance、批量漫剧、人物一致性和多镜头合并优先的团队。

### 4.10 Huobao Drama

**核心功能与流程**

使用可编辑 Agent Skills 把故事/剧本转为角色、场景、分镜、图片和视频任务；支持批量角色生成与多种视频供应商适配。目标是尽量自动化，而非每一步手动搭建。

**架构优势**

- Nuxt 3/Vue 3 前端，Hono + Drizzle + Mastra Agents + SQLite 后端，Electron 桌面壳；轻量、上手快。
- Agent prompts/skills 与工具代码分离，视频供应商有独立 adapter，便于添加火山、MiniMax、阿里云等渠道。
- 公开仓库存在后端测试，桌面与 Docker 部署均可。

**局限**

- 许可证是 CC BY-NC-SA 4.0，明确禁止商业使用；这比技术差异更早形成决策门槛。
- 没有 GitHub Actions CI，自动化回归证据较弱。
- 高自动化意味着生成速度快，但人工镜头精控与可追溯审核不如 Jellyfish。

**适合**：非商业学习、个人试验、一句话/大纲快速跑通流程。

### 4.11 Pixelle-Video

**核心功能与流程**

`主题/文本 → AI 文案 → 配图规划 → 逐帧图像/视频 → TTS → BGM → 视频合成`

支持 Edge-TTS、Index-TTS、ComfyUI、RunningHub 及 DashScope、OpenAI、Seedream、Seedance、Kling 等直连 API。

**架构优势**

- Python 内核按 pipeline、processor、provider、model 分层，FastAPI 路由和任务管理独立。
- ComfyUI/RunningHub 工作流以 JSON 资源存在，可替换图像、视频、TTS、VLM 原子能力。
- Docker、Windows 整合包和 Web UI 齐全；Apache-2.0。

**局限**

- 流程以“每句话一幅图/一段视频”的解说视频为中心，不具备强角色状态、服装连续性、跨集剧情记忆和专业镜头准备。
- 没有明显的自动化测试；CI 主要是文档。

**适合**：漫画解说、知识口播、治愈系图文视频，而非多角色连续短剧。

### 4.12 FastMovieAI

**核心功能与流程**

公开说明覆盖角色、剧本/分镜、AI 视频、TTS 和 FFmpeg，同时提供用户、VIP、积分、支付宝/微信支付、公众号/小程序和插件系统。

**架构优势**

- Webman/Workerman + MySQL/Redis 后端，Vue 3 前端；WebSocket、支付和后台管理适合 SaaS 运营。
- 插件化组织文章、营销、模型、通知、用户等商业模块；Apache-2.0。

**局限**

- 默认分支从 2026-02 起没有新提交，活跃度明显落后。
- 仓库提交了大量 `vendor` 依赖，体积、供应链升级和安全审计成本较高；统计到的很多“测试文件”来自依赖，不代表业务测试充分。
- 短剧生成链路的源码证据和文档深度弱于其支付/平台能力。

**适合**：已有 PHP/Webman 团队，优先需要会员、积分和支付，并愿意自行强化生成链路。

### 4.13 MoneyPrinterTurbo

**核心功能与流程**

`主题 → LLM 脚本 → TTS → 本地/库存/AI 素材 → 字幕 → BGM → FFmpeg 成片`

提供 Agent、WebUI、API、CLI 四种入口，可批量生成多条视频；素材可来自 Pexels、Pixabay、Coverr、Seedance、MiniMax、WaveSpeed 等。

**架构优势**

- Python 服务层清晰，视频、字幕、任务、素材、模型供应商分离；测试数量与边界场景覆盖在同类轻量工具中较好。
- Docker、GPU、CLI/API 和 Windows 启动方式齐全；MIT，社区规模最大。
- 对字幕、配音、BGM、不同画幅、库存素材和最终合成的支持成熟。

**局限**

- 没有把角色、场景、道具、服装、集/幕和镜头状态当作核心领域对象。
- 更适合“一条解说/营销短视频”，不能仅因 Star 高就排在短剧制片系统前面。

**适合**：营销、口播、资讯、解说、批量矩阵短视频。

### 4.14 BigBanana

**产品声明的流程**

`小说/大纲 → 项目/季/集 → 世界观与资产 → 结构化剧本 → 定妆/衣橱/场景/道具 → 九宫格或首尾帧 → 视频 → 配音/字幕/成片`

其关键帧驱动、三重人物一致性、世界观锚点和提示词版本回滚思路都很有价值。

**为什么综合分最低**

- 当前公开仓库只有约 32 个文件，主要是 README、文档、许可证和 Docker Compose，没有 README 所描述的完整前后端应用源码。
- 自定义许可证明确只允许非商业学习/研究；商业生产、内部商用、SaaS、OEM 和白标都需要另行授权。
- 因而本报告只能给“产品声明能力”评分，不能把它当作可审计、可独立构建的开源技术底座。

**适合**：研究其产品方法，或在接受商业授权和黑盒发行形态后评估产品；不适合作为开源二开的首选。

### 4.15 Novella

**核心功能与流程**

`剧本文件 / 小说章节 / 创意提示词 → ProjectBlackboard → 剧本识别 → 角色设计与锁脸 → 分镜运镜 → TTS/音效 → GPU 4K 压制`

主控导演 Agent 通过共享黑板协调剧本、角色、分镜、声音和视频编辑 Agent，用户还能声明新的 Agent、指定触发阶段和系统提示词。

**架构优势**

- Tauri v2 + React 19 + Rust Engine 的桌面架构；源码包含 core、AI engine、audio studio、storyboard、render pipeline 与 plugin SDK 等独立 package。
- Hub-and-Spoke + `ProjectBlackboard` 避免线性脚本把所有上下文耦合在一个超长提示词中，适合插入人工审核或自定义 Agent。
- 支持角色 Anchor/LoRA、TTS 音色绑定、系统 Keyring、本地工程数据、VideoToolbox/NVENC 压制。
- 约 920 个公开文件、82 个测试相关文件和 4 条 CI，MIT；工程证据明显强于多数同龄新项目。

**局限**

- 当前仍标为 v0.0.1；“4K”“13 家供应商”“加速比例”等为项目方能力声明，尚未进行本报告的统一样片实测。
- 产品化重点是本地桌面制片，不是多租户、充值、团队审片和云端弹性队列。

**适合**：希望本地部署、允许自定义 Agent、同时重视声音和最终压制的漫剧团队。

### 4.16 AI Video Production Editor

**核心功能与流程**

`Script → Director Pass → Concept/Casting → Storyboard → AI Filming → Continuity Review → Re-film Queue → Edit/Color/Fairlight → Deliver`

它支持短片、竖屏 microdrama、广告、MV、纪录片等格式，并把真实后期工作区而非“生成按钮”作为产品中心。

**架构优势**

- Electron + React 本地桌面应用；脚本、导演处理、资产、分镜、生成镜头、时间线、调色和导出保存在普通项目目录。
- 具备参考图转 3D blockout、相机关键帧、运动参考视频、连续性复审和返拍队列；后期含 LUT、示波器、自动剪辑、声音和交付页面。
- 供应商 adapter、模型自动路由、插件、任务中心和嵌入式 storyboard SDK 分开；约 678 个文件、47 个测试相关文件、2 条 CI。
- GPL-3.0-or-later 核心是真正开源，但分发闭源衍生桌面版会遇到 GPL 义务。

**局限**

- 更像专业 AI 电影/视频工作站，长篇中文网文压缩、分集爽点结构和小说连续记忆不是核心优势。
- 创建于 2026-05，生产案例和长期兼容性仍少于成熟非编软件；3D/自动模型路由的效果需要实测。

**适合**：重视镜头语言、3D 预演、连续性返拍、调色和专业交付的影视创作者。

### 4.17 Story Claw

**核心功能与流程**

`小说章节 → 视觉预设标注 → 角色/场景阶段化资产归档 → 场景剧本切分 → 逐镜分镜导演 → TTS/BGM/SFX → 图像 → 本地 LTX 视频 → VLM 质检与重渲 → 单集成片`

**架构优势**

- 为长篇小说显式建模角色和场景的“阶段”：只有服装、携带物、伤势、时间/光照等发生有意义变化时才生成新参考图，避免几百章反复抽卡或状态错乱。
- 每个视频首尾帧经过 VLM 检查人物一致性、额外人脸和残留字幕；失败可自动重渲。
- 角色首次出场后写入全书声线映射，后续章节复用同一 TTS 音色；旁白独立。
- 视频使用自托管 ComfyUI + LTX-2.3，不产生商业视频模型的按秒费用；分集、分阶段进度可断点续跑。MIT。

**局限**

- 当前输入约定偏向按 `第N章` 命名的中文 TXT，交互和逐镜精修弱于成熟工作台。
- 依赖自有 GPU、ComfyUI/LTX 工作流以及外部图像/TTS 服务，安装与显存门槛高。
- 更偏自动化长篇生产线，不适合需要多人在线协作、支付后台或复杂时间线手工精修的团队。

**适合**：数十到数百章网文、固定角色声线、自有 GPU、希望把视频 API 成本转成本地算力的团队。

## 5. 架构路线对比

| 架构路线 | 代表项目 | 优势 | 代价/风险 |
| --- | --- | --- | --- |
| Agent + 领域管线 + Web 平台 | ArcReel、ViMax | 长文本规划、可扩展 Agent、跨阶段上下文强 | 调试链长、成本与失败定位复杂 |
| 共享黑板多 Agent 桌面 | Novella | Agent 解耦、阶段触发、自定义 Agent、本地数据和 GPU 压制完整 | v0.0.1，复杂 Agent 协作仍需压力与恢复实测 |
| 生产工作台 + 显式状态机 | Jellyfish、LumenX | 人工审核、局部重跑、镜头可控、交付稳定 | 自动化程度不一定最高，操作步骤更多 |
| 专业制片/NLE + 3D 预演 | AI Video Production Editor | 从导演处理、预演、返拍到剪辑调色声音交付形成闭环 | 小说改编较弱，GPL 分发义务，项目仍新 |
| 无限画布 + 节点/技能 | Toonflow、waoowaoo、LocalMiniDrama | 自由组合、可视化上下文、适合探索与非线性编辑 | 节点和状态一致性、画布性能、迁移复杂 |
| 桌面批量生产器 | moyin-creator、Huobao Drama | 单机上手快、资产本地、适合个人/小团队 | 多人协作、弹性任务和集中运维较弱 |
| 长篇小说本地渲染管线 | Story Claw | 阶段化人物资产、固定声线、VLM 质量门、本地视频模型和续跑 | GPU/ComfyUI 门槛高，人工精修与协作较弱 |
| 企业模块化单体 | AID Studio、FastMovieAI | 用户、支付、后台、任务和运营一体化 | 部署重，创作体验容易受商业模块牵制 |
| 模板/素材合成流水线 | MoneyPrinterTurbo、Pixelle-Video | 成片快、TTS/字幕/BGM/模板成熟 | 角色和剧情连续性不足，不适合复杂短剧 |
| 非公开完整源码的发行壳 | BigBanana | 产品方法成熟、安装可能简单 | 无法完整审计、修改、离线构建或独立维护 |

## 6. 综合评分与排序

评分分成四个簇，便于看到“为什么排在这里”：

- 创作能力 45：全流程、叙事、一致性、镜头控制。
- 生产能力 24：后期、模型扩展、批量与恢复。
- 工程能力 16：架构、部署与运维。
- 采用条件 15：产品化、成熟度、许可证。

| 排名 | 项目 | 创作 /45 | 生产 /24 | 工程 /16 | 采用 /15 | 总分 /100 | 结论 |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | ArcReel | 42.8 | 23.2 | 15.4 | 11.0 | **92.4** | 综合能力最完整；AGPL 是主要门槛 |
| 2 | LumenX | 40.0 | 23.2 | 13.8 | 12.0 | **89.0** | 最均衡的 MIT 剧本到成片方案 |
| 3 | Novella | 41.0 | 23.2 | 14.4 | 10.0 | **88.6** | 多 Agent、本地桌面、声音与 4K 压制均衡；版本尚早 |
| 4 | ViMax | 42.8 | 20.8 | 13.2 | 11.5 | **88.3** | 小说与 Agent 管线最强之一 |
| 5 | Jellyfish | 41.9 | 20.0 | 13.8 | 12.0 | **87.7** | 一致性和逐镜控制首选 |
| 6 | Toonflow | 39.7 | 20.8 | 14.0 | 12.5 | **87.0** | 画布与扩展性强；需补回归实测 |
| 7 | AID Studio | 37.5 | 20.8 | 14.4 | 13.0 | **85.7** | 最适合运营后台/计费型平台 |
| 8 | AI Video Production Editor | 38.7 | 22.4 | 14.4 | 10.0 | **85.5** | 专业预演、非编、调色与交付最完整 |
| 9 | waoowaoo | 39.2 | 19.2 | 14.8 | 10.0 | **83.2** | 工程治理强；ELv2 与后期能力限制采用 |
| 10 | LocalMiniDrama | 38.5 | 20.8 | 13.0 | 10.5 | **82.8** | 本地隐私与桌面工作流首选 |
| 11 | Story Claw | 40.5 | 20.8 | 11.6 | 9.5 | **82.4** | 超长小说、本地视频渲染和自动质检专项最强 |
| 12 | moyin-creator | 41.9 | 20.0 | 11.8 | 8.5 | **82.2** | Seedance/批量漫剧强；AGPL 与测试不足扣分 |
| 13 | Huobao Drama | 38.3 | 20.8 | 13.4 | 8.0 | **80.5** | 自动化强；非商业许可证是硬限制 |
| 14 | Pixelle-Video | 23.5 | 21.6 | 13.4 | 12.0 | **70.5** | 优秀模板视频工具，不是强叙事短剧系统 |
| 15 | FastMovieAI | 30.3 | 16.8 | 9.6 | 12.0 | **68.7** | 商业后台强，生成与维护证据偏弱 |
| 16 | MoneyPrinterTurbo | 19.0 | 23.2 | 14.0 | 12.0 | **68.2** | 短视频冠军，但短剧领域模型不足 |
| 17 | BigBanana 公开仓 | 29.2 | 12.0 | 6.6 | 5.0 | **52.8** | 产品声明强，公开源码与许可不满足开源底座要求 |

### 6.1 “真正开源、可做底座”排序

排除 Huobao Drama、waoowaoo、BigBanana 三个非 OSI/非商业或源码不完整项目后：

1. ArcReel — 接受 AGPL 或计划开源服务端时的最强综合方案。
2. LumenX — 闭源商业二开最均衡。
3. Novella — 多 Agent、本地桌面、声音与硬件压制优先；需接受早期版本风险。
4. ViMax — 长篇小说、Agent 与自研管线优先。
5. Jellyfish — 人物一致性和镜头审核优先。
6. Toonflow — 画布、节点、MCP、ComfyUI 扩展优先。
7. AID Studio — 用户、计费、后台运营优先。
8. AI Video Production Editor — 专业制片/NLE 优先；分发时遵守 GPL。
9. LocalMiniDrama — 本地/隐私/个人桌面优先。
10. Story Claw — 超长网文、自有 GPU 和自动质检优先。
11. moyin-creator — 接受 AGPL 或采购商业许可时的批量漫剧优先。
12. Pixelle-Video — 漫画解说和模板视频。
13. FastMovieAI — PHP 商业平台底座。
14. MoneyPrinterTurbo — 批量解说/营销短视频，而非连续短剧。

### 6.2 分场景排序

| 场景 | 推荐顺序 | 说明 |
| --- | --- | --- |
| 综合工业化短剧 | ArcReel → LumenX → Novella → ViMax → Jellyfish | 流程、叙事、资产、任务和工程最均衡 |
| 小说改编/长篇分集 | ViMax → Story Claw → ArcReel → Novella → Toonflow | Story Claw 对阶段化人物、固定声线和数百章续跑最专门化 |
| 人物一致性/精品镜头 | Jellyfish → moyin-creator → LumenX → ViMax | 前两者把资产/镜头准备作为核心流程 |
| Seedance 与批量漫剧 | moyin-creator → LumenX → ArcReel → LocalMiniDrama | moyin 对多模态引用和多镜头合并最专门化 |
| 闭源商业二开 | LumenX → Novella → Jellyfish → ViMax → Toonflow → AID Studio | 均为 MIT/Apache；仍需检查模型与素材条款 |
| SaaS 用户/支付/运营 | AID Studio → FastMovieAI → LumenX | AID 的任务、计费、用户和后台最完整 |
| 本地隐私/个人创作者 | Novella → LocalMiniDrama → Toonflow → Story Claw → moyin-creator | 数据与桌面体验优先；Story Claw 需要本地 GPU |
| 专业影视预演/后期 | AI Video Production Editor → LumenX → Jellyfish | 3D 预演、返拍队列、时间线、调色、声音和交付优先 |
| 营销/口播/解说矩阵 | MoneyPrinterTurbo → Pixelle-Video | 这不是短剧排名，而是它们真正的优势领域 |

## 7. 推荐决策

### 7.1 如果只选一个

- **技术团队、接受 AGPL：选 ArcReel。** 它最像可以持续演进的生产系统。
- **必须闭源商用：选 LumenX。** 流程完整、MIT、后期与模型目录兼顾，二开阻力最小。
- **小说改编是核心：选 ViMax。** 不要用口播视频工具硬拼长篇叙事。
- **数百章网文 + 自有 GPU：选 Story Claw 进入实测。** 它对人物阶段、声线、自动质检和断点续跑的建模最有针对性。
- **成片质量依赖人工逐镜审核：选 Jellyfish。** 它的镜头准备状态与候选确认比“一键生成”更符合精品生产。
- **需要自定义多 Agent 的本地桌面系统：选 Novella。** 但应先用 PoC 验证 v0.0.1 的稳定性，不能只看功能表。
- **目标是真正的电影/广告制片而非网文流水线：选 AI Video Production Editor。** 它在预演、返拍、非编、调色和声音交付上明显领先短剧专用工具。
- **必须本地 Windows、尽快让创作者使用：选 LocalMiniDrama。** 它不是工程最强，但采用成本低。

### 7.2 不建议直接采用的路线

- **BigBanana 作为“开源底座”**：公开源码不完整且禁止商用，除非先取得完整交付与商业授权。
- **Huobao Drama 用于商业项目**：当前许可证直接构成阻断。
- **waoowaoo 直接做同类 SaaS**：ELv2 托管限制构成阻断；内部工具可继续评估。
- **按 Star 选择 MoneyPrinterTurbo 做连续剧情短剧**：领域模型不匹配，后续补角色、资产、镜头状态与分集结构的成本可能高于选现成短剧系统。
- **只看 README 判断人物一致性**：一致性最终取决于参考图策略、模型、提示词、种子、服装状态和重试选择，必须用统一样片实测。

## 8. 下一步实测方案

建议只让前五到七名进入 PoC，不要同时部署 17 个项目。

### 8.1 统一样片

- 一篇 1,500–2,000 字中文小说片段。
- 3 个反复出现的角色，其中 1 人有两套服装。
- 5 个场景、1 个关键道具、3 集、每集 10 个镜头。
- 同一套文本、图像、视频与 TTS 模型；固定分辨率、时长、并发和预算。

### 8.2 必测指标

| 指标 | 口径 |
| --- | --- |
| 首次跑通时间 | 从空环境到第一个完整成片，不含模型排队时间 |
| 人工干预量 | 每集修改提示词、重绑资产、重生成和外部剪辑次数 |
| 角色一致性 | 盲评角色可识别率、服装正确率、跨镜脸部漂移率 |
| 镜头可控性 | 景别、机位、运镜、首尾帧和台词对齐成功率 |
| 任务可靠性 | 30 镜中失败、超时、重试、丢状态和无法续跑的次数 |
| 成片完整度 | 是否包含对白/旁白、字幕、BGM、转场和可继续编辑的工程文件 |
| 单集成本 | 模型费用 + 失败重试费用 + 人工时长；按同一 10 镜口径 |
| 二开成本 | 新增一个图像供应商、一个视频供应商和一个自定义字段所需改动 |
| 数据与恢复 | 备份、迁移、断点续跑、项目导出和跨机器恢复是否可复现 |

### 8.3 建议 PoC 队列

1. ArcReel：建立综合上限。
2. LumenX：建立 MIT 商用基线。
3. Novella：验证共享黑板多 Agent、本地声音与压制链路。
4. ViMax：验证长篇叙事与 Agent 管线。
5. Jellyfish：验证一致性和逐镜人工控制。
6. AI Video Production Editor：若预演、时间线、调色和专业交付是硬需求再加入。
7. Story Claw：若数百章网文、自有 GPU 和固定声线是硬需求再加入。
8. Toonflow：若画布和 ComfyUI 是硬需求再加入。
9. AID Studio：若用户/支付/后台是硬需求再加入。

## 9. 诚实边界

- 已确认：仓库存在性、重定向、默认分支 HEAD、Star 快照、许可证文本、README 功能声明、主要目录、测试/CI 是否可见、关键技术栈与模块边界。
- 未实测：安装成功率、GPU/内存要求、中文长篇真实效果、人物一致性、生成时延、API 成本、30 镜并发稳定性、升级兼容性和最终成片质量。
- README 中的“工业级”“一致性强”“一键全流程”等属于项目方声明；本报告只有在源码结构存在相应领域对象、任务或模块时才提高评分，但这仍不能代替样片实测。
- Star 是热度而不是质量；不同项目创建时间差异很大，不能直接用 Star/天推导生产成熟度。
- Novella、AI Video Production Editor、Story Claw 均是 2026 年的新项目；进入主比较表示其能力或架构足以改变选型，不表示已经证明长期稳定。
- 许可证分析用于技术选型初筛，不构成法律意见；模型 API、字体、音乐、声音克隆、训练数据、生成内容和示例素材可能有独立条款。

## 10. 本轮扩展检索中未进入主排名的项目

这些项目不是“没找到”，而是核验后没有超过主表门槛，或存在决定性证据缺口：

| 项目 | 值得关注的能力 | 未进入主排名的原因 |
| --- | --- | --- |
| [OpenScene](https://github.com/Theorvane/openscene) | MIT、本地 Electron/移动端共用编辑核心、Agent 可操作时间线、字幕与 FFmpeg 导出；约 728 文件、252 个测试相关文件、7 条 CI | 是非常好的 Agent 非编，但“小说/剧本→角色资产→连续剧集”领域能力弱于主表；适合作为后期组件，不作为短剧底座单独排名 |
| [AI Movie Studio 2](https://github.com/Heroesjouney/AIMovieStudiov2) | 3D 相机预演、180° 规则、多参考图、ComfyUI/Fal/Replicate adapter、XML 导出、Long Take | 3D 相机条件化仍在进行中，项目仅约 147 文件且几乎无测试；当前更适合作为预演专项候选 |
| [雪风 AI 短剧工坊](https://github.com/oiuv/ai-short-drama) | 爽剧分集、角色/场景/道具版本、Seedance 分镜、本地剪辑导出，方向非常贴题 | README 写“MIT”，但仓库没有 `LICENSE` 文件和完整 MIT 条款，GitHub API 也无法识别许可；补齐许可证后应重审 |
| [Huohuo Drama](https://github.com/appolloqin/huohuo-drama) | 四层小说记忆、AI 视频/关键帧幻灯双管线、TTS/FFmpeg、账户积分与支付；源码/测试/CI 较完整 | 仓库没有许可证文件，README 也没有许可声明；法律上不能按开源项目自由复制、修改或商用 |
| [StoryMind](https://github.com/LinHao-city/StoryMind) | 分镜导演、角色/场景锚点、12 类视频管线、55+ 工具 | AGPL；默认分支在创建后数日即停止更新，持续维护证据不足，且定位更偏通用视频 Agent |
| [Continuity Studio](https://github.com/momorzq-oss/Continuity-Studio) | Film Bible、角色表、连续性状态、自动导演、手动审核、Apache-2.0 | 仅 2 Star、项目非常新；能力有价值，但还没有足够社区与长期运行证据超过 Jellyfish/专业制片工作站 |
| [FlintStudio](https://github.com/yuebuluo168/FlintStudio) | 小说/剧本经 DAG 自动生成分场、分镜、图片、TTS 与 FFmpeg 成片 | 当前“视频”主要是分镜图片 + 音频合成，没有独立视频模型；无测试/CI，且默认分支提交早于仓库创建日期，工程可信度不足 |
| [OpenMontage](https://github.com/tjebastin/openmontage) | 12 条通用视频管线、代理技能、素材检索、Remotion/FFmpeg | 仓库 0 Star、`pushed_at` 早于创建时间、缺少用户验证；更像 Agent 技能/方法库，不是成熟短剧产品 |
| [MovieAgent](https://github.com/showlab/MovieAgent) | 学术型多 Agent 长视频、角色定制和多模型推理 | 无明确许可证，2025-03 后无默认分支更新，依赖重、产品化与部署门槛高 |
| [CineVision](https://github.com/TonyHongtaoWu/CineVision) | 导演—摄影协作、动态灯光与预演研究 | 仓库只有约 7 个文件，主要是论文说明和图片，没有可评估的完整实现 |

触发重审的条件：上述项目补齐许可证、把路线图功能落到源码、增加测试/CI、发布可复现版本，或出现持续维护和真实制作案例。

## 11. 主要官方来源

- [ArcReel README、源码与许可证](https://github.com/ArcReel/ArcReel)，[官方架构文档入口](https://docs.arc-reel.com/dev/architecture)
- [Novella README、源码、测试与 MIT 许可证](https://github.com/Agions/novella)
- [AI Video Production Editor README、源码与 GPL-3.0 许可证](https://github.com/LudwigKienle/ai-video-production-editor)
- [Story Claw README、源码与 MIT 许可证](https://github.com/ZC89757/story-claw)
- [AID Studio README、源码与许可证](https://github.com/gzxx-2025/aid-studio)
- [Jellyfish README、源码与许可证](https://github.com/Forget-C/Jellyfish)，[任务执行架构](https://github.com/Forget-C/Jellyfish/blob/main/site/content/docs/architecture/task-execution.md)
- [MoneyPrinterTurbo README、源码与许可证](https://github.com/harry0703/MoneyPrinterTurbo)
- [Toonflow README、源码与许可证](https://github.com/HBAI-Ltd/Toonflow-app)
- [Huobao Drama README、源码与 CC BY-NC-SA 许可证](https://github.com/chatfire-AI/huobao-drama)
- [waoowaoo README、架构文档与 Elastic License 2.0](https://github.com/waooAI/waoowaoo)，[架构索引](https://github.com/waooAI/waoowaoo/blob/main/docs/architecture/README.md)
- [moyin-creator README、源码与双许可](https://github.com/MemeCalculate/moyin-creator)
- [BigBanana README、公开文件与社区许可证](https://github.com/shuyu-labs/BigBanana-AI-Director)
- [Pixelle-Video README、源码与许可证](https://github.com/ATH-MaaS/Pixelle-Video)，[架构文档](https://github.com/ATH-MaaS/Pixelle-Video/blob/main/docs/zh/development/architecture.md)
- [ViMax README、源码与许可证](https://github.com/HKUDS/ViMax)
- [LocalMiniDrama README、源码与许可证](https://github.com/xuanyustudio/LocalMiniDrama)
- [FastMovieAI README、源码与许可证](https://github.com/xhadmincn/FastMovieAI)
- [LumenX README、源码与许可证](https://github.com/alibaba/lumenx)，[统一模型目录概览](https://github.com/alibaba/lumenx/blob/main/docs/2-model-catalog-design/OVERVIEW.md)
