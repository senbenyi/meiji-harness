# 文本Agent职责与上下文优化实施记录

## 已修改文件
- `projects/drama/src/production/agent_context.js` — 当前动作规则、短任务资料和契约首轮提供；长资料索引、历史消息预算及动作隔离集中组装。
- `projects/drama/src/production/agent_tools.js` — 工具定义/执行成对注册；快照、原稿文件、候选文件统一登记实际已读范围；长单元完整性与预算回滚；同一phase从最近trace恢复累计范围。
- `projects/drama/src/production/model_loop.js` — 仅协调上下文、模型请求、工具执行、真实输入/输出记录；生成/审核/修订推进仍由原text_executor负责。
- `projects/drama/tests/agent-runtime.test.js` — 新增14项行为测试，覆盖首轮资料、正文读取路径、批量读取/预算、长资料、审核/修订隔离、取消、候选文件读取和历史窗口。
- `projects/drama/tests/helpers/production-fixture.js` — 模拟作者按新工具目录读取资料，不依赖已移除的read_skill/read_contract。
- `projects/drama/tests/production-pipeline.test.js`、`projects/drama/tests/execution-activity.test.js` — 更新短资料已附带与真实工具动作断言。
- `projects/drama/docs/开发方向.md` — 同步职责。
- `docs/plans/1103-计划-文本Agent职责与上下文优化.md` — 调研、影响范围、计划及验证回填。

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|---|---|---|
| AC-1 | 通过 | 首轮消息与工具目录行为测试；短资料不再请求读取，长资料完整性检查通过 |
| AC-2 | 通过 | 快照5种读取路径、来源版本、摘要与预算否定场景；候选通过文件读取可提交审核 |
| AC-3 | 通过 | 179项Drama回归；审核/修订独立历史、工具配对、历史裁剪、取消及既有检查点续接 |
| AC-4 | 通过 | 上下文、工具注册/执行、单轮运行器各有入口，业务流程不迁入通用工具模块 |

## 测试
- 基线：165通过、0失败、0取消、0跳过。
- 首次回归：162通过、3失败、0取消，原读取轮次/资料索引断言及fixture顺序依赖与新设计冲突，已更新。
- 最终：npm run test:drama，179通过、0失败、0取消、0跳过；新增14项行为测试。
- 无活动制作任务后重启服务，插件启动无导入失败；未调用真实供应商模型。
- git diff --check通过，新增文件通过临时索引纳入检查，真实暂存区未修改。
- GitNexus索引更新成功；完整detect-changes：10文件、128符号、8流程、high风险，无partial/truncated。按完整结果核对影响范围均属计划；辅助记忆及共享函数源码未改，相关回归通过。保留高风险告警，不以共享轴降级。
- 新模块直接导入通过，服务进程53339监听127.0.0.1:3080。

## 人工待办
无。真实模型轮数由模型选择和资料长度决定，本次未执行付费生成验收。
