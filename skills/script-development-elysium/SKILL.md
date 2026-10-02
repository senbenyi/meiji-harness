---
name: script-development-elysium
description: 将纯文本小说、故事或已有剧本导入短剧 Project，生成可溯源的内容分析、分集规划和正式剧本候选，并经人工审核后提交。
trigger: 用户要求从长文本、小说、故事或已有剧本开始做内容分析、分集或正式剧本时使用。
---

# 短剧文本开发

## 边界

- 只负责源文导入、内容分析、分集规划和正式剧本，不生成图片、视频、配音、时间线或成片。
- 首版源文只接受纯文本、TXT 和 Markdown；不得声称支持 PDF、DOCX、EPUB 或 OCR。
- Project 中的 StoryBible、Episode 和 Shot 是正式业务真相；Proposal 只是待审核候选。
- 不得直接调用通用 Project 写工具绕过 Proposal 审核。
- 所有结论必须引用 `studio_source_read` 返回的 `sourceId/start/end` 区间。

## 流程

1. 用 `studio_source_import` 导入源文，保存返回的 `sourceId` 与 `contentHash`。
2. 循环调用 `studio_source_read`，以上一次返回的 `end` 作为下一次 `cursor`，直到 `eof=true`。
3. 提交 `studio_content_analysis_submit`：包含摘要、故事圣经、角色、场景、情节节点和原文引用。
4. 停止并等待该 Proposal 在 `studio_review_queue` 中获批；拒绝后根据理由产生新 Proposal，不覆盖旧候选。
5. 基于已批准分析提交 `studio_episode_plan_submit`：每集必须有稳定 id、顺序、标题、大纲和原文区间。
6. 分集规划获批后，逐集提交 `studio_episode_script_submit`。正式剧本至少包含：
   - 完整 `script`；
   - 镜头顺序、时长、画面描述；
   - 对白和音频备注；
   - 连续镜头引用；
   - 角色/场景参考绑定。
7. 每集剧本获批后才进入资产与生成流程；本 Skill 到此结束。

## 失败处理

- source hash 不匹配：停止，重新读取当前源文，不复用旧分析。
- Proposal schema 失败：只修正候选载荷，不修改正式数据。
- 审核拒绝：保留拒绝记录，创建新 Proposal；不得修改或重用已终结 Proposal。
