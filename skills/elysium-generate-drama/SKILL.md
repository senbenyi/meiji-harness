---
name: elysium-generate-drama
description: 将长篇小说、故事或已有剧本通过多 Agent 分段编排导入短剧 Project，生成可恢复、可溯源的内容分析、分集规划和正式剧本。
trigger: 用户给出小说/TXT/Markdown 文件名并要求做成 AI 短剧（包括成人短剧），或要求从长文本、故事、已有剧本开始做内容分析、分集或正式剧本时使用。
---

# 短剧文本开发

## 边界

- 本 Skill 负责整书快速模式的文本开发与批量媒体交接；快速模式不得加载其他媒体或 prompt Skill。只有用户明确要求 quality、逐镜创作或 3D 风格精修时，文本阶段结束后才加载 `elysium-generate-video-3d`。
- 首版源文只接受纯文本、TXT 和 Markdown；不得声称支持 PDF、DOCX、EPUB 或 OCR。
- Project 中的 StoryBible、Episode 和 Shot 是正式业务真相；Proposal 只是待审核候选。
- 不得直接调用通用 Project 写工具绕过 Proposal 审核。
- 所有结论必须引用 `studio_source_read` 返回的 `sourceId/start/end` 区间。

## 整书快速验证模式

用户以“<小说文件名> 做成一部 AI 短剧/成人短剧”提出成片请求时自动启用，无需用户补充工程参数。默认全书覆盖、自动分集、fast、16:9、中文对白、原生音频、跳过人工内容质检并自动批准 Proposal；用户显式参数覆盖默认值。用户明确要求 Pilot 时，同一入口传 `scope=pilot`，并用 `episodeCount`、`maxShotsPerEpisode` 表达范围。不得为这些默认项调用 `ask_user_question`。该模式仍使用 Proposal 和 Review 审计链，不直接写正式故事数据：

- 仍覆盖整部小说和全部规划分集，只降低每集镜头密度、对白长度和 prompt 长度；不得默认压成单集，也不得把局部样片称为整书完成。只有用户明确要求“浓缩版”时，才可压缩为 1 集、8–12 镜。
- 分块读取全文并保留区间摘要，后续只携带摘要与当前必要引用，不重复注入全文。
- 内容分析与分集规划后先保存正式剧本，再从剧本提取角色、场景、道具和衍生状态，分别编写资产图片、分镜图片与视频提示词；每项记录版本、剧本依据和精确引用。
- 子 Agent 缺失、失败或输出无效时，对应文本任务必须失败并保留检查点；不得用大纲或“建立场景／情节推进”等模板镜头补齐并自动批准。
- 正式剧本获批后，工具创建包含“角色／场景参考图 → 分镜图 → 镜头视频 → 分集合成 → 整剧交付”的媒体 ProductionRun；每步检查当前版本与依赖，失败阻断下游。快速模式自动检查、批准媒体，不跳过参考图或分镜图。

## 多 Agent 编排协议

- 整书快速模式在非 Plan 模式下先用 `todo_write` 一次性写入五项验收清单：①创建项目并导入源文（in_progress）；②完成文本改编与资产设定（pending）；③生成资产参考图（pending）；④生成分镜与视频（pending）；⑤合成并交付成片（pending）。固定顺序为 `todo_write → studio_novel_create`，随后主 Agent 只调用一次 `studio_novel_create(sourcePath, title)`。该工具在当前调用会话中前台执行官方 Harness Workflow，使 run/phase/member 和子会话由 Harness 原生持久与展示；同时由 Project/ProductionRun 保留幂等、门禁和恢复真值，并在结束当前轮前把 Todo 写成成功或失败终态。成功后直接返回交付结果，不重复执行内部步骤。
- 点名小说文件并要求成片（包括已给出 Pilot 范围）已经构成完整执行授权。`todo_write` 后下一个且唯一允许的工具调用是 `studio_novel_create`；禁止调用 `ask_user_question`、`request_user_input` 或任何“是否启动／是否继续”的重复确认。用户明确要求自动完成或不要询问时，该禁令优先于通用确认习惯；文件不存在或不可读则直接报告失败。
- 整书任务禁止由主 Agent 逐段读取和逐段推理。`studio_novel_create` 内部调用 `studio_novel_orchestrate`，主 Agent不得直接调用这个内部工具。禁止调用通用 `workflow`，禁止由模型生成 JavaScript 编排脚本。只有单集或用户明确要求局部修改时才可直接调用一个 `subagent`。
- 六类 subagent：剧情负责分析与分集规划；剧本负责正式剧本；角色负责从剧本提取三类资产、衍生状态和图片提示词；镜头负责镜头规划、连续性与视频提示词；分镜负责静态图片提示词与预览；成片负责合成与交付。主 Agent 统一分派和汇报，子代理不递归调度，不直接写 Project。
- `studio_novel_orchestrate` 内置依赖：正式剧本 → 资产提取与图片提示词 → 镜头规划 → 独立图片/视频提示词 → 媒体任务。基础参考图先于衍生图，全部引用参考图先于分镜图，分镜图先于视频。每个成功任务持久化；失败恢复不能用模板补缺。媒体 Worker 消费已保存提示词，不在重新生成时临时改写。
- 主 Agent 不手工轮询或中途补数据：`studio_novel_create` 会在当前工具调用中等待持久媒体任务完成，成功返回即表示基础流程已到成片交付；失败则保留 Project/ProductionRun 状态供下次同入口恢复。
- 主协调 Agent 是唯一写者：只有它可以导入源文、提交 Proposal、审批和写 Project。子 Agent 只读取指定原文区间并推理，禁止写 Project，避免 revision 冲突。
- 文本与媒体的持久任务图、租约和恢复由 `studio_novel_create` 内部维护。任务引用使用稳定 id，依赖字段为 `dependencies`；恢复只重做失败或未完成任务，主 Agent 不另行创建任务图或从头重跑。
- 子 Agent 任务明确 role、label、phase、schema 和当前范围的必要 prompt；Project 持久任务记录责任角色、依赖与结果。媒体方案绑定 taskId/inputSignature，不得携带父对话全文或改写其他任务。
- 原文按不超过 `studio_source_read` 单次上限的区间拆包，并行生成紧凑 JSON：`facts/characterStateDelta/locations/beats/citations/openConflicts`。禁止返回原文全文、工具过程或长篇解释。
- 分段结果过多时使用分层归并 Agent，每个归并输入和输出都有上限；主协调只保留 Story Bible 摘要、任务状态和当前待写集，不把所有分段结果同时回灌上下文。
- 剧本 subagent 只写正式剧本；角色 subagent 从剧本提取资产；镜头 subagent 编排镜头，分镜 subagent 编写静态视觉层。结构校验不构成人物状态连续性或画面质量的人工作品验收。
- 每次写操作先读取最新 revision，并使用可复算 commandId（如 `<projectId>:analysis:v1`、`<projectId>:episode:<episodeId>:script:v1`）；重试必须复用同一个 commandId。
- 工具返回 `retryable=false`、JSON/schema/参数错误或同一 commandId 已失败时不得重试；只允许修正一次明确指出的字段。revision 冲突先读取一次最新摘要再重放同一逻辑命令；外部瞬态错误最多重试一次。不得通过搜索源码、日志或安装目录来猜参数。
- 子 Agent 完成后只把结构化结果交回主协调；主协调立即持久化，随后丢弃正文级中间上下文。不得用“继续”维持超长单 Agent 对话。

## 流程

1. 找到用户点名的工作区文件后，调用一次 `studio_novel_create(sourcePath=<路径>, title=<短剧标题>)`。Pilot 请求同时传 `scope=pilot`、`episodeCount=1`、`maxShotsPerEpisode=3`。不得先创建 Project、读取全文、调用 shell 计数、列举媒体能力或搜索源码。
2. `studio_novel_create` 成功后直接返回其中的 `projectId`、`runId`、`mediaRunId`、集数和完成状态；不得重复导入、读取 Project、调用 Proposal/validate/batch/status，也不得再次调用内部工具 `studio_novel_orchestrate`。
3. 后续查询或恢复仍重复调用同一个入口；内部 Workflow 自行复用 Project、检查点和媒体任务，不允许主 Agent 展开内部步骤。

## 失败处理

- source hash 不匹配：停止，重新读取当前源文，不复用旧分析。
- Proposal schema 失败：根据具体字段错误只修正候选载荷，不修改正式数据或重写无关剧情。
- 只有全部正式镜头与上游素材有效、正式时间线覆盖全部分集、交付文件登记成功后，Project 才能标记完成。自动元数据和覆盖检查不能代替视觉与叙事审核。
- 审核拒绝：区分原文引用、结构、人物约束、剧情因果或对白问题，保留拒绝记录和已批准事实，只修正失败内容后创建新 Proposal；不得修改或重用已终结 Proposal。
- 同一原因再次失败且没有新证据或明确修改依据时，停止重试并说明未解决点；不得循环提交或以整集重写掩盖局部问题。
- 生产会话禁止为排查工具错误而搜索插件源码、安装目录、Profile 或依赖。第一次失败只允许依据错误修正参数；相同 commandId 再次失败则把该任务标记失败并退出当前任务包，由独立工程会话修复。
