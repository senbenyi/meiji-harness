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

用户以“<小说文件名> 做成一部 AI 短剧/成人短剧”提出整书成片请求时自动启用，无需用户补充工程参数。默认全书覆盖、自动分集、fast、16:9、中文对白、原生音频、跳过人工内容质检并自动批准 Proposal；用户显式参数覆盖默认值。不得为这些默认项调用 `ask_user_question`。该模式仍使用 Proposal 和 Review 审计链，不直接写正式故事数据：

- 仍覆盖整部小说和全部规划分集，只降低每集镜头密度、对白长度和 prompt 长度；不得默认压成单集，也不得把局部样片称为整书完成。只有用户明确要求“浓缩版”时，才可压缩为 1 集、8–12 镜。
- 分块读取全文并保留区间摘要，后续只携带摘要与当前必要引用，不重复注入全文。
- 内容分析、单集规划和单集剧本依次提交；每次 schema 校验通过后，使用用户本次明确授权记录批准决定，不停下来等待选项卡。
- 镜头使用 `studio_shot_batch_upsert` 单次写入，再运行 `studio_shotlist_validate`；结构校验失败必须修正，人工内容质检跳过。
- 正式剧本获批后直接调用一次 `studio_batch_generate` 创建媒体 ProductionRun；不加载其他 Skill，不逐镜调用媒体工具。

## 多 Agent 编排协议

- 整书快速模式只允许主 Agent 调用一次 `studio_novel_create(sourcePath, title)`；该工具内部完成建 Project、源文导入、分段、多 Agent 编排、Proposal 批准与持久化、镜头批量生成和一次状态查询。成功后直接向用户返回紧凑结果，禁止主 Agent再调用任何 `studio_*` 或 `comfy_*` 工具。
- 整书任务禁止由主 Agent 逐段读取和逐段推理。`studio_novel_create` 内部调用 `studio_novel_orchestrate`，主 Agent不得直接调用这个内部工具。禁止调用通用 `workflow`，禁止由模型生成 JavaScript 编排脚本。只有单集或用户明确要求局部修改时才可直接调用一个 `subagent`。
- `studio_novel_orchestrate` 内置固定阶段“分段分析 / 故事归并 / 分集写作”，并发封顶 3，并以 schema 约束子 Agent 输出；它还会在内部完成 Proposal 校验/批准/持久化、镜头批量生成和一次状态查询，只向主 Agent 返回紧凑的 projectId、数量、runId 与状态。主 Agent 不得重复调用这些工具，也不得在失败后改用近似工具名。
- 主 Agent 不等待媒体生成：文本工作流前台完成并持久化后，媒体 ProductionRun 使用后台模式，拿到 `runId` 即查询一次 `studio_production_status` 并向用户返回。不得轮询。
- 主协调 Agent 是唯一写者：只有它可以导入源文、提交 Proposal、审批和写 Project。子 Agent 只读取指定原文区间并推理，禁止写 Project，避免 revision 冲突。
- 先创建 `studio_production_create` 持久任务图；每个 task 只能使用 `{id, kind, scopeId?, dependencies?, input?, inputRef?}`，区间写入 `input:{start,end}`，依赖字段必须叫 `dependencies`，禁止使用 `type`、`segment` 或 `dependsOn`。稳定任务 id 按 `source-summary:<index>`、`story-reconcile`、`episode-plan`、`episode-script:<episodeId>` 命名。恢复时先调用 `studio_production_status`，只重做未完成任务；失败或租约中断用 `studio_production_resume`，不得从头重跑。
- 每个 spawn 子 Agent 的固定任务包只含 `{projectId, sourceId, contentHash, start, end, mode, storyBibleDigest?, episodeOutline?, priorStateDigest?, outputSchemaVersion}`，不得携带父对话全文。
- 原文按不超过 `studio_source_read` 单次上限的区间拆包，并行生成紧凑 JSON：`facts/characterStateDelta/locations/beats/citations/openConflicts`。禁止返回原文全文、工具过程或长篇解释。
- 分段结果过多时使用分层归并 Agent，每个归并输入和输出都有上限；主协调只保留 Story Bible 摘要、任务状态和当前待写集，不把所有分段结果同时回灌上下文。
- 剧集写作按依赖图执行：人物状态或因果相依的集串行，互不依赖的支线才并行。每个 Episode Writer 只拿当前集大纲、对应引用区间、Story Bible 摘要和必要前置状态。
- 每次写操作先读取最新 revision，并使用可复算 commandId（如 `<projectId>:analysis:v1`、`<projectId>:episode:<episodeId>:script:v1`）；重试必须复用同一个 commandId。
- 工具返回 `retryable=false`、JSON/schema/参数错误或同一 commandId 已失败时不得重试；只允许修正一次明确指出的字段。revision 冲突先读取一次最新摘要再重放同一逻辑命令；外部瞬态错误最多重试一次。不得通过搜索源码、日志或安装目录来猜参数。
- 子 Agent 完成后只把结构化结果交回主协调；主协调立即持久化，随后丢弃正文级中间上下文。不得用“继续”维持超长单 Agent 对话。

## 流程

1. 找到用户点名的工作区文件后，调用一次 `studio_novel_create(sourcePath=<相对路径>, title=<短剧标题>)`。不得先创建 Project、读取全文、调用 shell 计数、列举媒体能力或搜索源码。
2. `studio_novel_create` 成功后直接返回其中的 `projectId`、`runId`、集数和状态；不得重复导入、读取 Project、调用 Proposal/validate/batch/status，也不得再次调用内部工具 `studio_novel_orchestrate`。
3. 提交 `studio_content_analysis_submit`：`payload` 与 `sourceRefs` 直接传结构化对象/数组，禁止序列化成 JSON 字符串。内容包含摘要、故事圣经、角色、场景、情节节点和原文引用。故事圣经明确人物动机与关系、时间地点、关键道具、故事规则和用户禁用设定；区分原文事实、改编建议与尚未解释的问题。
4. 默认停止并等待该 Proposal 在 `studio_review_queue` 中获批；若用户已明确授权整书自动执行，本次提交直接传 `autoApprove=true`，由工具在同一调用内批准并写入正式 Project，不再单独调用审核工具。
5. 基于已批准分析提交 `studio_episode_plan_submit`：继续直接传结构化 `payload`，自动执行时传 `autoApprove=true`。每集必须有稳定 id、顺序、标题、大纲和原文区间。在大纲中写明允许出场的角色、起止人物状态与知情范围、时间地点、因果链、伏笔及兑现位置、结尾钩子；新悬念不得推翻已经成立的解释，新增设定须作为改编建议交由审核。
6. 分集规划获批后，逐集提交 `studio_episode_script_submit`，自动执行时同样传 `autoApprove=true`。写当前集时只使用已批准故事圣经、当前集大纲、对应原文区间及必要的前集状态，不重复携带其他集全文。正式剧本至少包含：
   - 完整 `script`；
   - 镜头顺序、时长、画面描述；
   - `audioDialogue`：逐行“说话人：具体台词”，保留原文语言，无对白明确为空字符串；`audioNotes`：语气、音色、环境声及必要音效；
   - 连续镜头引用；
   - 角色/场景参考绑定。
   对白属于分镜，由 MiniMax H3 随视频原生生成语音；不得另设旁白或配音生成步骤。用户明确要求静音时遵循制作规格。提交前逐项核对原文忠实度、角色集合、人物知情状态、动作与道具位置、因果解释、伏笔兑现和禁用设定；对白须可演、动作须可拍。Schema 通过只表示结构合法，不能代替上述内容核对和人工审核。沿用现有字段，不另造质量报告载荷。
7. 全部剧本获批后逐集运行 `studio_shotlist_validate`。完整成片请求不得在这里停止：只保留 projectId、source/hash、总集数/镜头数和失败项的紧凑摘要，直接调用一次 `studio_batch_generate(tier='fast')` 创建覆盖全部分集的异步媒体 ProductionRun；拿到 `runId` 后调用一次 `studio_production_status` 并返回，不轮询。

## 失败处理

- source hash 不匹配：停止，重新读取当前源文，不复用旧分析。
- Proposal schema 失败：根据具体字段错误只修正候选载荷，不修改正式数据或重写无关剧情。
- 审核拒绝：区分原文引用、结构、人物约束、剧情因果或对白问题，保留拒绝记录和已批准事实，只修正失败内容后创建新 Proposal；不得修改或重用已终结 Proposal。
- 同一原因再次失败且没有新证据或明确修改依据时，停止重试并说明未解决点；不得循环提交或以整集重写掩盖局部问题。
- 生产会话禁止为排查工具错误而搜索插件源码、安装目录、Profile 或依赖。第一次失败只允许依据错误修正参数；相同 commandId 再次失败则把该任务标记失败并退出当前任务包，由独立工程会话修复。
