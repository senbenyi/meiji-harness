# 文本Agent职责与上下文优化

- 类型：重构及Bug修复（完整流程）
- 目标：按上下文、工具、运行器、业务阶段分工组织文本制作Agent，减少固定资料读取轮次并修正已读原著判定。
- 非目标：改动外部Harness、模型客户端协议、其他项目及辅助记忆整理Agent；删除用户数据；承诺真实模型固定轮数。

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 状态 | 依据或缺口 |
|---|---|---|---|
| AC-1 | 新生成/审核/修订请求 → 首轮含完整当前规则、输出契约及不超过16000字符的任务资料；不再需要read_skill/read_contract往返；大资料仍分页 | 已确认现状待修 | model_loop.js:31-43首轮只有索引 |
| AC-2 | 读取包含正文的快照或原稿文件 → 按实际来源版本/范围登记已读；提交不重复要求读取；片段、摘要和预算失败不冒充已读 | 已确认现状待修 | model_loop.js:59,67,74快照不更新sourceRanges |
| AC-3 | 多轮、审核、修订、取消与续接 → 保留完整工具结果配对、独立审核上下文和真实历史，候选继续经业务校验保存 | 未验收 | 相关集成回归与新增测试 |
| AC-4 | 代码职责 → 上下文模块组织消息，工具模块成对注册定义/执行，model_loop只调度一次请求和保存记录，text_executor推进业务阶段 | 未验收 | 当前model_loop混合四种职责 |

## 调用链与证据
ProductionService → executor_registry → TextProductionExecutor.executeUnit → modelTurn → 公共modelClient.turn；pending时排入同动作下一Step，提交后进入review/revise/finish。
- model_loop.js:31-43：首轮组装与工具定义。
- model_loop.js:51-93：工具执行、提交门禁及消息记录。
- text_executor.js:33-55：业务校验、候选保存与生成/审核/修订状态推进。
- 本次adaptation_plan任务5dbb92c5-fc94-4348-8f00-561e70de88aa：第4轮已读3795字正文，第6轮因覆盖登记缺失拒绝，第7轮重复读取。

图谱：status有效；modelTurn符号impact为UNKNOWN（未解析），文件impact为LOW，直接调用方text_executor，向上涉及executor_registry、service与production-architecture测试。已用rg核对实际调用；动态图谱未覆盖的fixture按源码补查。

## 待用户决定
无。

## 改动
1. production/agent_context.js：抽出动作规则、契约、资料与历史组装，按动作提供规则；短资料首轮附带，长资料通过read_unit分页。→ AC-1、3、4
2. production/agent_tools.js：工具定义与执行集中注册；统一快照/文件原著读取范围登记与预算回滚，移除已替代的规则/契约读取工具及状态。→ AC-1、2、4
3. production/model_loop.js：仅调度上下文、模型、工具及记录，业务保存仍交text_executor。→ AC-3、4
4. tests/helpers/production-fixture.js、production-pipeline.test.js、execution-activity.test.js及新增agent运行测试：更新真实工具契约，覆盖初始上下文、重复读取Bug、长资料、批量读取/预算与独立审核。→ AC-1、2、3
5. projects/drama/docs/开发方向.md：同步现有职责说明。→ AC-4

验证：基线及改后npm run test:drama；新增测试先验证关键行为；gitnexus detect-changes --scope all检查范围，git diff --check；完成后集中更新索引。仅模拟模型，不调用真实供应商。

## 验证结果
基线：npm run test:drama，165通过、0失败、0取消、0跳过（8872.67ms）。实施后：npm run test:drama，179通过、0失败、0取消、0跳过（8453.80ms）；新增agent-runtime.test.js 14项运行行为测试全部通过。首次回归162通过/3失败/0取消，均为已替代的工具读取流程断言或fixture依赖，已同步更新；未改辅助记忆整理Agent。
- AC-1通过：固定规则/短单元/契约首轮提供；长单元逐字段或文件分页，完整覆盖才提交。
- AC-2通过：5种快照/文件读取路径认可正文，来源版本隔离、摘要/搜索不计正文、预算拒绝不计已读；候选文件读取同样计入审核覆盖。
- AC-3通过：审核/修订独立上下文、完整消息配对、历史裁剪、取消与续接回归通过；累计范围从最近trace恢复，避免逐轮重复累加。
- AC-4通过：新增agent_context/agent_tools，model_loop缩为单轮调度，text_executor业务阶段入口不变，现有开发方向已同步。
- 服务：无未结束制作任务后使用npm run restart -- drama重启，新进程53339已监听3080，启动未出现插件失败。
- 真实模型：未执行，不保证真实模型固定轮数；优化消除固定资料工具读取与错误覆盖门禁造成的额外往返。
- GitNexus索引更新成功：18614节点、193432边、620流程。最终detect-changes纳入10文件、128符号、8流程，风险high；原始结构化结果中128项符号完整，无partial/truncated。已核对文本ExecuteUnit和辅助记忆MemoryTurn通向规则、契约、冻结记忆的依赖路径；新增模块实际只由modelTurn调用，辅助记忆及共享函数源码未改，相关回归通过。保留高风险告警，不以共享轴降级。
- 使用临时Git索引纳入新增文件检测，真实暂存区未修改。git diff --check通过，10个文件均在计划范围，无凭据或无关业务改动。初次仅含已跟踪文件的检测未作为最终无影响结论。
