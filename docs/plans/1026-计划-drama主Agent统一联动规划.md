# drama 主Agent统一联动规划

- 类型：关键业务流程调整，完整流程。
- 目标：人物形象、场景描述等节点修改后，由主Agent一次检查关联上下游并规划修改；盒子仅修改自身结果。
- 非目标：新增协调盒子、自动改写原始文件、自动生成媒体、移除任务幂等及并发覆盖保护、实现尚不可执行的盒子。

## 验收标准与调研结论

| AC | 输入/状态 → 可观测结果 | 依据/验证 |
|---|---|---|
| AC-1 | 修改盒子输出 → 不按hash或固定名单自动过期其他节点及图片 | 各盒子service/state及项目edit当前存在自动过期；更新相关行为测试 |
| AC-2 | 修改完成 → 主Agent获得真实前后资料及所有关联上下游、素材和已有计划 | planning_context、box_report；上下文回归测试 |
| AC-3 | 主Agent保存统一计划 → 仅显式指定目标改变状态，计划持久化、可恢复、会话隔离 | 新增规划记录工具；真实项目存储集成测试 |
| AC-4 | 面板修改成功 → 展示后可靠交接主Agent；内容失败/取消仍等待用户 | ReportDispatcher当前成功不唤醒；交接测试 |
| AC-5 | 视觉调整 → 只有明确冲突才规划回改剧本/大纲；剧情事实修改从剧本开始 | 更新主Agent指导和业务说明；工具提供执行入口，最终语义判断由模型负责 |
| AC-6 | 上游在任务执行中变化 → 仍拒绝迟到覆盖；规则修改仍保留授权 | 保留input_hash/output_hash等并发保护；现有回归测试 |

## 调用链与证据

面板/会话 → Service → Executor → saveCandidate → 项目JSON；面板终态由ReportDispatcher展示/投递。主Agent通过PlanningContextTool读取项目，通过已有业务工具执行修改。

- `src/node_box/scene_extraction/service.js:86` 保存时主动过期下游。
- `src/node_box/character_extraction/state.js:57` 按人物内容比较过期照片。
- `src/node_box/project/service.js:158` 编辑时按各节点指纹批量过期。
- `src/session/planning_context.js:25` 尚未提供全部媒体和后续产物。
- `src/session/report_dispatcher.js:105` 成功面板任务不唤醒主Agent。

## 影响检查

GitNexus仓库为当前agent-harness绝对路径，status显示索引与HEAD一致。SceneExtractionService类分析为CRITICAL（154项间接影响），提示需覆盖面板、图片、记录及共享项目入口；方法级多数UNKNOWN，已通过实际源码、import和测试补查，不将空结果当无影响。仅改drama，不修改公共包和meiji。不提交git。

## 改动

1. 取消盒子保存、规则变更和项目编辑的跨节点自动过期；保留资产槽位和历史地址、节点自身规则状态、任务并发保护。
2. 扩展上下文、报告，加入前后资料、完整下游和媒体；增加非盒子的规划记录工具，按主Agent明确决定持久化计划和指定状态。
3. 修改成功的面板文本任务交给主Agent统一规划；更新指导，合并上下游检查，保持内容失败与规则授权边界。
4. 更新行为测试和文档；运行drama全量、diff检查、detect-changes及索引刷新。

## 验证结果

基线：`npm run test:drama`，282通过、0失败、0 cancelled。

实施验收：`npm run test:drama`，285通过、0失败、0 cancelled。新增上下游资料、参考图字节过滤、统一计划持久化、版本冲突、稳定素材目标排序、真实结果校验测试；更新原自动过期与面板成功交接预期。保留并通过并发迟到覆盖、取消、失败等待用户和规则授权测试。

`git diff --check`通过。GitNexus detect-changes识别40个已跟踪改动文件、26个符号，报告critical（736个关联流程）；涉及类入口和公共命名调用形成广泛静态传播，实际源码修改仅限drama。未将该结果解读为低风险，补查新文件、全部真实调用方及drama全量回归；图谱流程枚举本身有预算限制，不将未列出当无影响。收尾刷新索引。

AC-1—AC-4、AC-6通过程序回归验证；AC-5的规划资料和指导已落地，具体语义判断由主Agent负责，尚未通过真实模型人工验收。没有启动真实模型/媒体请求，没有修改meiji或公共包，没有提交git。

## 提交前远端合并

远端new新增14757403及150db4b6，将盒子hash校验迁入未接入HashService；合并保留该迁移和网络失败通知边界，同时保留本地联动规划、分镜证据审核、本节点规则修改状态。分镜重复问题改用结构相等比较证据字段，不恢复hash依赖。文档按最终行为同步。ShotDesignExecutor图谱风险CRITICAL，boxReport无图谱匹配，已通过源码核对报告调用入口；合并后执行npm test及git diff --check，再检查图谱变化并更新索引。
