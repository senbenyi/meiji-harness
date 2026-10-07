# 都市生日夜完整流程验收

> 状态：架构重构已落地，真实流程验收进行中（29/31 文本节点）
> 基线：2026-10-07，`novel-to-drama-text-v1`

## 计划

- [x] 归档受污染的旧会话。
- [x] 完整移除并重新安装 `web` profile 插件，重启 Harness，验证安装包入口可加载。
- [x] 新建会话并确认唯一入口链路：加载 `elysium-generate-drama` → `studio_novel_create` → Harness Workflow。
- [x] 实测定位首个断点：`episode-plan` 两次结构化输出失败；失败后主 Agent错误地继续调用其他工具。
- [ ] 修复 `episode-plan` 动态约束：明确非空、唯一、全部 beat 覆盖及全文 `0..N` 连续覆盖要求。
- [ ] 提升 Pipeline version，确保契约变化不会复用旧任务快照。
- [ ] 修复 `studio_novel_create` 失败协议：成功或失败都结束当前轮次；失败结果保留真实 `projectId` 和可恢复状态，禁止主 Agent脱离唯一入口自行补救。
- [ ] 增加聚焦测试：真实 episode-plan 首次失败后按反馈修正；创建入口失败时终止轮次并返回恢复信息。
- [ ] 运行聚焦测试、`npm run test:all`、`npm run smoke`。
- [ ] 再次完整移除/安装插件并重启 Harness。
- [ ] 归档本次失败会话，新建干净会话；逐阶段验证故事分析、分集规划、分集剧本、资产提取、资产提示词、镜头规划、分镜图片提示词、视频提示词、持久状态和画布。

## 验收标准

- Pipeline 节点严格按依赖解锁，失败重试符合 manifest 策略。
- 不出现 `studio_project_*`、内部 `studio_novel_orchestrate` 或 shell 绕行。
- 每个角色/场景/道具具备图片提示词，每个镜头具备分镜图片提示词和视频提示词。
- Project 的任务、运行、实体、镜头和提示词状态可持久恢复。
- “创作”画布能完整渲染项目，基础流程最终进入可继续媒体生产的稳定状态。

## 回顾

## Durable Workflow 架构重构

- [x] 定义文本生产根 Run 与节点 DAG，根状态聚合所有文本阶段，禁止 bootstrap Run 提前代表完成。
- [x] 实现通用有界 `DurableDagExecutor`：单次领取一个 ready 节点，支持 checkpoint 恢复。
- [x] 将节点成功边界改为 `生成 → Schema 校验 → 业务校验 → Proposal 提交/领域物化 → 物化 checkpoint → completeProductionTask`。
- [x] 为执行器增加失败分类：invalid-output、no-structured-output、timeout、domain-commit、retryable-error、non-retryable。
- [x] 将 Pipeline manifest 编译为持久任务及 handler/validator/commit/retry/concurrency 元数据。
- [x] 统一物化幂等键：绑定 run/task，Proposal 幂等键继续绑定 pipeline/version/node/scope。
- [ ] 将 `studio_novel_create` 改为后台 enqueue-and-return，并让入口与画布只读取同一 Root Run 聚合状态。
- [x] 增加迁移兼容：Pipeline v6 建立独立 DAG，不复用旧 v1-v5 任务或副作用。
- [x] 增加领域、恢复、插件端到端测试；`npm run test:all` 162/162，`npm run smoke` 通过。
- [x] 强制重装插件并从干净会话验证《都市生日夜》至 29/31 文本节点；14 集剧本、旧 ep-04 故障点、失败恢复闭包与画布聚合通过。
- [ ] 完成 ep-13/ep-14、资产提示词、镜头与图片/视频提示词的真实流程；当前恢复仍依赖主 Agent 再次调用入口，画布重试不能自行调度文本 Workflow。

### Durable Workflow 验收标准

- 任一节点仅在正式领域数据已经物化并通过校验后标记 completed。
- 进程/会话中断后，同一入口能够只恢复未完成节点；failed 与 blocked 能按依赖重新进入 ready。
- 根 Run 只有在分析、分集、剧本、资产、资产提示词、分镜、图片提示词、视频提示词全部完成后才是 completed。
- Prompt 不再承担 source offset、usage quote、稳定 id、依赖、版本与状态转移等确定性职责。
- 画布状态与根 Run/Project 正式状态一致，不读取 Agent 文本作为完成依据。

- 已完成领域层、执行器、单一文本 Run、动态 DAG、barrier、物化门禁与画布 Run 展示。
- 自动化验证为 `npm run test:all` 163/163、`npm run smoke` 通过；web profile 安装副本关键文件 hash 与工作区一致。
- 真实项目 `20261007112033897` 的 v6 Root Run 从旧版 ep-04 稳定推进到 29/31；ep-09/ep-10 重试成功，ep-12 通过确定性已知资产恢复完成，completed 节点未重跑。
- 尚未闭环：同步 `studio_novel_create` 结束后，画布“重试任务”只恢复领域状态，无法在没有调用 Agent 上下文时重新启动文本 Workflow；这是下一步入口异步化必须解决的架构断点。
