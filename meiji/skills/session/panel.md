---
name: skill-gongyong-panel-generate
description: 创建短剧项目，按依赖规划分集制作，调用项目生成流程并处理剧本和图片确认。
---

会话理解用户意图、规划步骤并调用工具；实际制作内容通过生成流程保存，不在聊天中另写一份代替项目结果。

先用 meiji_context_query 查询项目、剧集、剧本版本与阻断、三类库和缺图。meiji_project_manage 创建或打开项目；创建只需标题、风格、画幅及可选剧本，不输入项目摘要，不生成剧集。未导入原始剧本、没有 AI 创作方向和剧集时，首次摘要生成的 requirements 必填。requirements 仅作用于当次任务，不自动保存为方向，premise 是持续作用于每一集摘要的 AI 创作方向。script.kind 为 assembled 的自动回写剧情记录不等于导入剧本，不停止使用创作方向；imported 项目按原剧本推进，不使用创作方向。AI 创作方向仅由人在面板手动编辑，会话不可修改；新方向用于之后生成，不能重写已发生事实；edit-script 提出按整篇或分节修改的方案，用户确认后写入。

多步骤请求先用 todo_write 规划，然后按依赖执行：meiji_generate_summary → meiji_generate_story → meiji_generate_shot_table → meiji_generate_seconds。剧情通过后可 meiji_generate_images；图片全部确认与每秒指令通过后再 meiji_generate_film，成片包括分镜提示词、视频和尾帧。只需要分镜或补视频/尾帧时使用 parts。项目摘要与剧本维护分别用 meiji_update_project_summary、meiji_revise_script，不替代剧集制作。

每次只发起一个业务步骤。generate 跳过已经通过的内容；regenerate 按当前上游重新生成，不带旧结果及历史意见；modify 以当前基稿按 review 定向修改，保留无关内容。只有 summary 可以生成最后一集之后的下一集，不能跳集。story 的 only 可指定大纲、人物、场景或道具；单卡图片只由面板操作，会话使用批量图片工具。

needs_confirmation 表示会删除已有内容：向用户说明返回的删除清单，取得授权后带 confirmDelete=true 重发。用户已经明确授权这些删除时直接传 true；不在内部任务之间重复审批。库关联卡片的修改会同步到库和其他关联集；需要只改本集时新增变体。

返回 jobId 后可以结束本轮，完成时会收到通知；需要结果时用 job_wait、job_read，停止本会话发起的任务用 job_kill。面板任务由用户在面板停止。只有 status=completed 且 reviewPassed=true 才启动依赖步骤。retryable=true 表示项目摘要更新失败，重新调用同一工具一次，仍失败则报告原因；其他 failed、review_failed、cancelled 停止依赖步骤，不自行循环重试。busy 已登记占用等待 job，结束后重新发起原操作。

候选图片必须由用户在面板确认或放弃，不能在聊天中代替确认；meiji_wait_images 登记图片等待 job，已有库图可直接复用。待确认剧本方案、摘要待回写或删除待回写会阻断剧情生成，处理后剧本等待 job 通知，再继续原步骤。不要把未确认方案当作已保存剧本，不重做已完成的摘要来消除等待。

用户已要求的多个步骤连续执行；阶段之间不重复确认。最终简要说明项目、集数和已完成阶段，存在失败时说明具体原因，不复述密钥或内部日志。
