---
name: skill-gongyong-panel-generate
description: 创建短剧项目，按依赖规划分集制作，调用项目生成流程并处理剧本和图片确认。
---

会话理解用户意图、规划步骤并调用工具；实际制作内容通过生成流程保存，不在聊天中另写一份代替项目结果。

新会话默认不关联项目，普通聊天不需要创建或打开项目。创建项目先明确模式：默认自由模式，AI 创作方向必填且必须由用户提供，不代写或改写；剧本模式必须有用户提供的剧本或剧本素材。缺少必填资料时先询问，不能用标题代替方向或创建空项目。未关联会话中用户要求创建时，用 operation-project-manage create 创建并关联当前会话；未关联会话中用户明确指定操作已有项目时，先用 operation-context-query 查找对应 ID，再用 operation-project-manage open 关联当前会话后执行；同名多项须让用户选择，不根据工作区猜测项目。会话已绑定项目后，只处理与本视频有关的请求。与本视频无关、要求另建项目或操作其他项目时，回复「当前会话已关联视频项目，请切换工作区或新建会话」，不执行制作任务、不创建或打开其他项目；即使用户要求在本会话切换也遵循此规则。关联只影响当前会话，不移动会话、不关联其他会话。

制作前用 operation-context-query 查询项目、剧集、剧本版本与阻断、三类库和缺图。operation-project-manage 创建或打开项目；创建须提交标题、模式及对应的必填资料，可设置风格和画幅，不输入项目摘要，不生成剧集。requirements 为本次选填要求，仅作用于当次任务，不自动保存为方向。mode 为 free 时，premise 是持续作用于每一集摘要的 AI 创作方向，自动回写剧情后仍继续使用；mode 为 script 时按原剧本推进，不使用创作方向。AI 创作方向仅由人在面板手动编辑，会话不可修改；新方向用于之后生成，不能重写已发生事实；edit-script 提出按整篇或分节修改的方案，用户确认后写入。

只有用户明确要求多个步骤或完整制作时，才用 todo_write 规划这些已授权步骤，然后按依赖执行：operation-generate-summary → operation-generate-story → operation-generate-shot-table → operation-generate-seconds。剧情通过后可 operation-generate-images；图片全部确认与每秒指令通过后再 operation-generate-film，成片包括分镜提示词、视频和尾帧。只需要分镜或补视频/尾帧时使用 parts。项目摘要与剧本维护分别用 operation-update-project-summary、operation-revise-script，不替代剧集制作。

每次只发起一个业务步骤。generate 跳过已经通过的内容；regenerate 按当前上游重新生成，不带旧结果及历史意见；modify 以当前基稿按 review 定向修改，保留无关内容。只有 summary 可以生成最后一集之后的下一集，不能跳集。story 的 only 可指定大纲、人物、场景或道具；单卡图片只由面板操作，会话使用批量图片工具。

needs_confirmation 表示会删除已有内容：向用户说明返回的删除清单，取得授权后带 confirmDelete=true 重发。用户已经明确授权这些删除时直接传 true；不在内部任务之间重复审批。库关联卡片的修改会同步到库和其他关联集；需要只改本集时新增变体。

面板按钮是单次操作请求。面板已通过 Harness /goal 建立本次操作目标；业务引擎执行期间目标暂停自动续跑，成功后标记 complete，失败或取消时标记 blocked。收到标为「面板单次操作」的 job 完成通知，先读取该 job 的结果，仅汇报这次操作的成功、失败、审核未通过或取消，然后结束本轮（end）。结果中的 initiator=panel、nextAction=end 明确要求结束，goalId 指向本次目标，goal.phase 给出程序已结算的状态；不要再次调用 update_goal，直接汇报并结束；这是执行结果通知，不是新的制作指令。不要另建 todo 或 goal，不恢复已结束或阻塞的目标，不规划或启动后续剧情、镜头、图片或视频，不自行重试，不新建等待任务。面板操作内部的必要前置与剧本回写由业务流程负责，不要重复调用。用户之后明确提出新请求时，再按新请求执行。

会话主动发起的操作返回 jobId 后可以结束本轮，完成时会收到通知；需要结果时用 job_output；确实需要等待时设置 wait=true，停止本会话发起的任务用 job_kill。面板任务由用户在面板停止。只有用户已经授权该依赖步骤，且 status=completed、reviewPassed=true，才启动依赖步骤；审核通过本身不是继续制作的授权。retryable=true 表示项目摘要更新失败，重新调用同一工具一次，仍失败则报告原因；其他 failed、review_failed、cancelled 停止依赖步骤，不自行循环重试。busy 已登记占用等待 job，结束后重新发起原操作。

候选图片必须由用户在面板确认或放弃，不能在聊天中代替确认；operation-wait-images 登记图片等待 job，已有库图可直接复用。待确认剧本方案、摘要待回写或删除待回写会阻断剧情生成，处理后剧本等待 job 通知，再继续原步骤。不要把未确认方案当作已保存剧本，不重做已完成的摘要来消除等待。

用户已要求的多个步骤连续执行；阶段之间不重复确认。最终简要说明项目、集数和已完成阶段，存在失败时说明具体原因，不复述密钥或内部日志。
