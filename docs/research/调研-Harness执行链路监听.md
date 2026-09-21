# Harness 执行链路监听

## 范围与游标
- 只读审查，不修改业务代码、项目状态或触发生成。
- 项目：c8861b93；关联会话：session-d9012199-e699-4214-bbf4-8a34df1482a4。
- 会话事件：~/.dsh/sessions/--Users-tom-Documents-test--/session-d9012199-e699-4214-bbf4-8a34df1482a4/session.v3.jsonl.zstd。
- 已检查至 seq259（session/end-seed）；当前revision21、snapshot=48586a96-2538-46d6-b452-1190ecae5d19，视频队列interrupted/cursor1；本机服务PID12619正在监听3080。
- 每5分钟通过当前任务heartbeat增量检查；只在新问题、阶段完成、失败或需要操作时通知。

## 已确认链路
turn5 19:10:24开始 → seq128 project_production_read（plan_segments=true）→ seq133 project_production_complete → seq134 revision10/request=null → seq139 19:13:48正常完成。
工具读取约25ms，complete回写约48ms；读取后生成约140秒，输出6601 tokens/24245字节。首轮模型上下文45097 tokens；不是证明上下文是唯一延迟来源。
当前正式快照：10 Scene、16 Segment、总时长185秒；每段5～15秒，各场景片段合计一致。目标180秒，185秒在现有±30秒容差内。
turn6 已进入shots，首批4段保存成功，并返回下一批身份；没有观察到越权生成视频。

## 修改建议
1. P1 完成总结必须引用服务端统计。seq137模型总结称180秒、9Scene、15Segment，与seq133结果及revision10落盘的185秒、10Scene、16Segment不符。建议工具回执返回scene_count/segment_count/total_seconds，最终回复直接使用回执，不让模型心算。
2. P1 尾帧衔接加入时空一致性复核。最后“形影不离”片段 use_previous_tail=true，但其Scene为黄昏、丛林高处，前Scene为白天、丛林深处。其理由声称同一时空，和结构化场景信息矛盾。建议联合生成后复核相邻时空、end_state/start_state和构图，冲突时要求模型局部修正，不按scene_id硬编码。
3. P2 合并story请求补幂等回执。production.js:163只识别带batch_index和segments的旧分批回执；联合story成功后清空request，却没有记录本次结果hash。重复回传将被判过期。源码已确认，当前没有观察到实际网络重放事故。建议按request_id、session、结果hash返回原成功回执。
4. P2 为长篇联合规划保留可恢复暂存。16段已输出6601 tokens，当前要求一次完整JSON；接近100段时存在超出输出上限风险（推断，未发生）。建议保持一个用户阶段与整体AI规划，在内部允许完整Scene批次暂存、全量校验后发布，避免恢复独立Segment步骤。
5. P2 减少历史上下文并完善链路日志。首轮输入45097 tokens，读取当前资料前耗时约44秒。建议以项目快照提供阶段上下文、压缩历史大JSON，并记录request_id/session/turn/toolCallId/revision/耗时/错误。当前harness-local.log仅启动入口，start.mjs:58使用w覆盖；改为脱敏结构化追加和轮转。性能改善幅度未实测。

## 验证边界
以上来源为真实会话事件、正式项目快照与当前部署源码。未修改代码或业务数据；未触发模型或视频。建议1、2已有真实数据证据；建议3为源码缺口；建议4、5包含明确标注的风险或优化推断。

## 2026-09-19 19:21 增量检查
- turn6分镜完成（seq205成功回执，seq210 completed）；正式快照16段均有分镜，总计16镜，每段镜头时长均匹配片段时长。
- turn7进入H3输入，seq223/233两批各4项成功，revision18，当前快照2b1b6450之后已更新；以project.json指向为准。
- 新P1：上下文超限已真实发生。seq170报CONTEXT_WINDOW_EXCEEDED：69261 tokens超过65536窗口。seq171/173/175裁剪了包括最新批次read(seq167)在内的工具资料。随后seq183只返回3项（本批要求4项），seq184被正确拒绝；seq189重新读取后seq194返回4项并成功。裁剪与漏项的因果未独立证实，但时序明确。建议提前预算与压缩旧历史，保留当前request/批次ID/规则完整；溢出恢复后强制重新read再提交。后端完整性拦截有效，无证据表明正式数据丢失。
- 新P1：10秒片段“丛林中的陪伴”（segment-a678667d-13f8-489e-a5da-aeb45c0ceb1b）的一条shot同时写采草药、黄昏高处、呼唤、奔跑与拥抱，framing为“中景切换至远景”；还提前包含下一片段“形影不离”的拥抱。已保存结果和单shot规则冲突。建议分镜提交前增加剧情覆盖/相邻重复检查，对时空跳跃和明确切镜要求拆成真实shot或退回调整片段时间线，不能仅检查duration之和。
- 已有总结统计问题再次出现：seq208称“15个片段”，实际16段；并非新问题，作为补充证据。
- 未改代码或业务状态，未触发生成。新增通知仅覆盖上下文超限、分镜语义问题和阶段完成。

## 2026-09-19 19:28 增量检查
- seq242/252分别提交H3输入第3/4批，各4项；seq243/253均成功，最终revision20、request=null，seq258 turn7正常结束。无新增工具错误、截断或上下文超限事件。
- 正式快照核对16份H3输入，source_revision、duration_seconds与片段一致；9份i2va、7份t2va，first_frame_source存在性与use_previous_tail一致。
- 视频队列于H3阶段之后建立，当前revision21、snapshot=50ee7dd3-ae32-4888-9c6e-1507847d6552；第一段已成功（15秒），第二段运行，其余14段等待，queue.error=null。只依据持久化状态，未独立核验远端画面质量或页面点击来源。
- 模型总结seq256仍误报15段，这是已有统计建议的补充证据，不重复通知。
- 本轮新增通知为H3阶段完成、进入视频执行；没有新的独立修改建议。未修改代码或业务数据、未触发生成。

## 第二段生成时Harness崩溃根因（用户触发排查）
- 本机3080无监听；harness-local.log先报 Cannot pipe to a closed or destroyed stream，随后Readable未处理的TimeoutError导致Node v25.1.0退出。
- 部署media.js:149～165：fetch使用120秒超时，await返回后直接pipeline(Readable.fromWeb(upstream.body),res)。若res已销毁，pipeline立即拒绝，而创建的Readable未正确清理；上游随后超时发出error，成为未捕获事件。请求关闭恰好发生在哪次视频预览未记录，具体请求ID未确认。
- 独立Node子进程复现：已destroy的Writable + Readable.fromWeb(在100ms超时error的Web流) + await pipeline；先捕获Cannot pipe，再未捕获TimeoutError退出1，与生产日志一致。未访问业务端点、未修改运行代码。
- 第二段任务61991eef3baf7a76defde38ad73a89c2实际succeeded，finished_at=2026-09-19T10:30:53.043Z。远端ComfyUI进程2469仍运行，日志确认输出final_00001_audio.mp4，Prompt executed in181.67seconds，无本次OOM证据。
- 项目队列仍running/cursor1是Harness退出后未同步到成功任务；不能据此重新生成第二段。
- 建议：修复媒体代理流生命周期，建立源流错误处理并在任何早退/pipe失败时取消或销毁上游；在等待connect/fetch后检查客户端关闭状态；可取消的超时在收尾清理。用子进程测试覆盖客户端提前断开、响应销毁竞态和随后超时，验证进程存活。修复后重启并复用第二段既有结果恢复队列，避免重新执行全片。
- 本轮仅诊断，未修代码、未重启、未恢复队列。

## 2026-09-19 19:55 心跳核对
会话仅新增seq259 session/end-seed，无新模型或工具调用。队列按启动规则标记interrupted，第二段在队列中仍为running（此前独立任务已确认成功），尚未恢复；无成片。3080监听正常，当前启动日志无新增错误。属于用户已知重启与未恢复状态，无新可操作发现，不重复通知。本轮仅更新报告游标。

## 2026-09-20 18:53 心跳核对
会话游标仍为seq259，项目快照48586a96-2538-46d6-b452-1190ecae5d19、revision21未变。队列仍interrupted/cursor1，无新工具调用或成片。Harness PID8973继续监听3080，日志82字节，无新增错误。无新可操作发现，保持安静；未修改业务数据或触发生成。

## 2026-09-20 20:32 心跳核对
seq259、revision21及快照48586a96-2538-46d6-b452-1190ecae5d19均未变化；视频队列仍interrupted/cursor1，无新增会话执行、工具调用或成片。Harness PID8973监听3080，启动日志82字节且无新增错误。无新可操作发现，不重复通知；本轮仅更新监听记录。

## 2026-09-20 22:32 心跳核对
seq259、revision21及快照48586a96-2538-46d6-b452-1190ecae5d19未变化；队列仍interrupted/cursor1，无新工具调用或成片。Harness PID8973监听3080，日志82字节，无新增错误。无新可操作发现，保持安静；仅更新报告。

## 2026-09-21 12:52 心跳核对
会话仍seq259；项目revision21、快照48586a96-2538-46d6-b452-1190ecae5d19未变，队列interrupted/cursor1，无新调用或成片。Harness PID8973仍监听3080，日志82字节、无新增错误。无新可操作发现，不重复通知。本轮仅更新报告；此前被中断的09:26心跳不记为已完成检查。

## 2026-09-21 13:04 心跳核对
seq259、revision21、快照48586a96-2538-46d6-b452-1190ecae5d19及队列interrupted/cursor1未变，无新调用或成片。3080监听进程已变为PID12619，日志仍82字节且无错误；进程更换原因未确认，但无服务故障或新增需操作事项。不重复通知；未修改业务状态、未重启或触发生成。

## 2026-09-21 13:10 心跳核对
seq259、revision21、快照48586a96-2538-46d6-b452-1190ecae5d19及队列interrupted/cursor1未变。Harness PID12619监听3080，日志82字节，无新增错误、调用或成片。无新可操作发现，保持安静；仅更新报告。

## 2026-09-21 13:16 心跳核对
seq259、revision21、快照48586a96-2538-46d6-b452-1190ecae5d19及队列interrupted/cursor1未变。Harness PID12619监听3080，日志82字节，无新增错误、调用或成片。无新可操作发现，不重复通知；仅更新报告。

## 2026-09-21 13:22 心跳核对
seq259、revision21、快照48586a96-2538-46d6-b452-1190ecae5d19及队列interrupted/cursor1未变。Harness PID12619监听3080，日志82字节，无新增错误、调用或成片。无新可操作发现，不重复通知；仅更新报告。

## 2026-09-21 13:28 心跳核对
seq259、revision21、快照48586a96-2538-46d6-b452-1190ecae5d19及队列interrupted/cursor1未变。Harness PID12619监听3080，日志82字节，无新增错误、调用或成片。无新可操作发现，不重复通知；仅更新报告。

## 2026-09-21 13:34 心跳核对
seq259、revision21、快照48586a96-2538-46d6-b452-1190ecae5d19及队列interrupted/cursor1未变。Harness PID12619监听3080，日志82字节，无新增错误、调用或成片。无新可操作发现，不重复通知；仅更新报告。

## 2026-09-21 13:39 心跳核对
seq259、revision21、快照48586a96-2538-46d6-b452-1190ecae5d19及队列interrupted/cursor1未变。Harness PID12619监听3080，日志82字节，无新增错误、调用或成片。无新可操作发现，不重复通知；仅更新报告。

## 2026-09-21 13:45 心跳核对
seq259、revision21、快照48586a96-2538-46d6-b452-1190ecae5d19及队列interrupted/cursor1未变。Harness PID12619监听3080，日志82字节，无新增错误、调用或成片。无新可操作发现，不重复通知；仅更新报告。

## 2026-09-21 13:51 心跳核对
seq259、revision21、快照48586a96-2538-46d6-b452-1190ecae5d19及队列interrupted/cursor1未变。Harness PID12619监听3080，日志82字节，无新增错误、调用或成片。无新可操作发现，不重复通知；仅更新报告。

## 2026-09-21 13:57 心跳核对
seq259、revision21、快照48586a96-2538-46d6-b452-1190ecae5d19及队列interrupted/cursor1未变。Harness PID12619监听3080，日志82字节，无新增错误、调用或成片。无新可操作发现，不重复通知；仅更新报告。

## 2026-09-21 14:03 心跳核对
seq259、revision21、快照48586a96-2538-46d6-b452-1190ecae5d19及队列interrupted/cursor1未变。Harness PID12619监听3080，日志82字节，无新增错误、调用或成片。无新可操作发现，不重复通知；仅更新报告。
