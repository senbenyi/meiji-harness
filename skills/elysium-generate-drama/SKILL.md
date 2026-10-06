---
name: elysium-generate-drama
description: 将长篇小说、故事或已有剧本通过多 Agent 分段编排导入短剧 Project，生成可恢复、可溯源的内容分析、分集规划和正式剧本。
trigger: 用户要求从长文本、小说、故事或已有剧本开始做内容分析、分集或正式剧本时使用。
---

# 短剧文本开发

## 边界

- 只负责源文导入、内容分析、分集规划和正式剧本，不生成图片、视频、配音、时间线或成片。
- 首版源文只接受纯文本、TXT 和 Markdown；不得声称支持 PDF、DOCX、EPUB 或 OCR。
- Project 中的 StoryBible、Episode 和 Shot 是正式业务真相；Proposal 只是待审核候选。
- 不得直接调用通用 Project 写工具绕过 Proposal 审核。
- 所有结论必须引用 `studio_source_read` 返回的 `sourceId/start/end` 区间。

## 整书快速验证模式

仅当用户明确要求整部小说快速验证，并允许降低画质、跳过人工质检时启用。该模式仍使用 Proposal 和 Review 审计链，不直接写正式故事数据：

- 仍覆盖整部小说和全部规划分集，只降低每集镜头密度、对白长度和 prompt 长度；不得默认压成单集，也不得把局部样片称为整书完成。只有用户明确要求“浓缩版”时，才可压缩为 1 集、8–12 镜。
- 分块读取全文并保留区间摘要，后续只携带摘要与当前必要引用，不重复注入全文。
- 内容分析、单集规划和单集剧本依次提交；每次 schema 校验通过后，使用用户本次明确授权记录批准决定，不停下来等待选项卡。
- 镜头使用 `studio_shot_batch_upsert` 单次写入，再运行 `studio_shotlist_validate`；结构校验失败必须修正，人工内容质检跳过。
- 正式剧本获批后转交片型 Skill；本 Skill 仍不生成媒体或成片。

## 多 Agent 编排协议

- 主协调 Agent 是唯一写者：只有它可以导入源文、提交 Proposal、审批和写 Project。子 Agent 只读取指定原文区间并推理，禁止写 Project，避免 revision 冲突。
- 先创建 `studio_production_create` 持久任务图；稳定任务 id 按 `source-summary:<index>`、`story-reconcile`、`episode-plan`、`episode-script:<episodeId>` 命名。恢复时先调用 `studio_production_status`，只重做未完成任务；失败或租约中断用 `studio_production_resume`，不得从头重跑。
- 每个 spawn 子 Agent 的固定任务包只含 `{projectId, sourceId, contentHash, start, end, mode, storyBibleDigest?, episodeOutline?, priorStateDigest?, outputSchemaVersion}`，不得携带父对话全文。
- 原文按不超过 `studio_source_read` 单次上限的区间拆包，并行生成紧凑 JSON：`facts/characterStateDelta/locations/beats/citations/openConflicts`。禁止返回原文全文、工具过程或长篇解释。
- 分段结果过多时使用分层归并 Agent，每个归并输入和输出都有上限；主协调只保留 Story Bible 摘要、任务状态和当前待写集，不把所有分段结果同时回灌上下文。
- 剧集写作按依赖图执行：人物状态或因果相依的集串行，互不依赖的支线才并行。每个 Episode Writer 只拿当前集大纲、对应引用区间、Story Bible 摘要和必要前置状态。
- 每次写操作先读取最新 revision，并使用可复算 commandId（如 `<projectId>:analysis:v1`、`<projectId>:episode:<episodeId>:script:v1`）；重试必须复用同一个 commandId。
- 子 Agent 完成后只把结构化结果交回主协调；主协调立即持久化，随后丢弃正文级中间上下文。不得用“继续”维持超长单 Agent 对话。

## 流程

1. 用 `studio_source_import` 导入源文，保存返回的 `sourceId` 与 `contentHash`。
2. 循环调用 `studio_source_read` 建立区间索引，随后按“多 Agent 编排协议”spawn 分段摘要 Agent；未读区间不得当作已确认事实。
3. 提交 `studio_content_analysis_submit`：包含摘要、故事圣经、角色、场景、情节节点和原文引用。故事圣经明确人物动机与关系、时间地点、关键道具、故事规则和用户禁用设定；区分原文事实、改编建议与尚未解释的问题。
4. 默认停止并等待该 Proposal 在 `studio_review_queue` 中获批；若用户已明确授权整书自动执行，则由主协调记录批准并继续，不重复询问。
5. 基于已批准分析提交 `studio_episode_plan_submit`：每集必须有稳定 id、顺序、标题、大纲和原文区间。在大纲中写明允许出场的角色、起止人物状态与知情范围、时间地点、因果链、伏笔及兑现位置、结尾钩子；新悬念不得推翻已经成立的解释，新增设定须作为改编建议交由审核。
6. 分集规划获批后，逐集提交 `studio_episode_script_submit`。写当前集时只使用已批准故事圣经、当前集大纲、对应原文区间及必要的前集状态，不重复携带其他集全文。正式剧本至少包含：
   - 完整 `script`；
   - 镜头顺序、时长、画面描述；
   - 对白和音频备注；
   - 连续镜头引用；
   - 角色/场景参考绑定。
   提交前逐项核对原文忠实度、角色集合、人物知情状态、动作与道具位置、因果解释、伏笔兑现和禁用设定；对白须可演、动作须可拍。Schema 通过只表示结构合法，不能代替上述内容核对和人工审核。沿用现有字段，不另造质量报告载荷。
7. 全部剧本获批后逐集运行 `studio_shotlist_validate`。最终只汇报 projectId、source/hash、Proposal/Review 状态、总集数/镜头数、每集校验结果及失败项，不把完整剧本回灌主上下文；随后转交资产与生成流程。

## 失败处理

- source hash 不匹配：停止，重新读取当前源文，不复用旧分析。
- Proposal schema 失败：根据具体字段错误只修正候选载荷，不修改正式数据或重写无关剧情。
- 审核拒绝：区分原文引用、结构、人物约束、剧情因果或对白问题，保留拒绝记录和已批准事实，只修正失败内容后创建新 Proposal；不得修改或重用已终结 Proposal。
- 同一原因再次失败且没有新证据或明确修改依据时，停止重试并说明未解决点；不得循环提交或以整集重写掩盖局部问题。
