# AI 短剧最小架构方案

> 状态：已根据用户复核撤回“自建通用调度平台”方案  
> 核心：Harness 负责编排，多 Agent 负责创作，插件负责业务数据和画布。

## 1. 纠偏结论

上一版方案引入了 Root Run、通用 DAG、Worker、Lease、Attempt、Fencing、Outbox、Expander 和多套状态机，实际上是在 Harness 外再造一个工作流引擎。这会持续扩大项目难度，也让流程状态出现两份真相。

当前需要解决的不是“如何造出更强的调度平台”，而是：

> 如何让 Harness Workflow 真正成为 AI 短剧创作的唯一编排器。

因此，新方案不扩展通用生产平台，只围绕固定的 AI 短剧流程闭环。

## 2. 只保留 5 个组件

### 2.1 入口 Tool

`studio_novel_create` 只负责：

1. 导入小说并创建或复用 Project；
2. 以 `projectId + sourceHash` 创建或复用 Harness Workflow；
3. 保存 `activeWorkflowId`；
4. 返回项目和流程进度。

入口不再同步执行整条创作链，也不负责逐步调用其他工具。

### 2.2 Harness Workflow

Harness 是唯一流程真相，负责：

- 阶段顺序；
- 多 Agent fan-out / fan-in；
- 节点重试和超时；
- 暂停、恢复和运行状态；
- 已完成节点不重复执行。

插件不再重复实现通用 DAG、Lease、Barrier、Attempt 或 Scheduler。

### 2.3 Stage Runner

每个阶段只有一个薄执行函数：

```text
读取已确认业务数据
→ 调用指定角色 Agent
→ 使用 Prompt/Skill 生成候选结果
→ JSON Schema 校验
→ 少量业务规则校验
→ 幂等写入 Project
→ 返回业务实体 ID
```

Agent 只创作当前阶段产物，不决定下一步，不直接控制流程。

### 2.4 Project Store

只保存 AI 短剧业务数据：

- 小说与故事分析；
- 分集与正式剧本；
- 角色、场景、道具和图片提示词；
- 镜头、分镜图片提示词和视频提示词；
- 图片、视频、时间线和最终交付物；
- `activeWorkflowId`。

Project Store 不保存第二套通用 Workflow 状态。

### 2.5 Canvas Projection

画布组合两类信息：

- 正式内容：来自 Project Store；
- 执行进度和错误：来自 `activeWorkflowId` 对应的 Harness Workflow。

不再通过“最新文本 Run + 最新媒体 Run”猜测当前状态。

## 3. 固定 6 阶段流程

```text
1. 小说分析与分集规划
   ↓
2. 分集剧本生成（按 episode fan-out）
   ↓
3. 资产设定与图片提示词
   ↓
4. 分镜、分镜图片提示词、视频提示词（按 episode/shot fan-out）
   ↓
5. 图片与视频生成（按 asset/shot fan-out）
   ↓
6. 合成与交付
```

阶段数量固定。小说有多少集、每集有多少镜头，只影响阶段内部并行任务数量，不动态修改流程结构。

### 阶段完成条件

1. 小说分析与分集规划：故事分析和 episode 列表已校验并落库。
2. 分集剧本：每集都有正式剧本，且关联对应剧情节点。
3. 资产设定：角色、场景、道具齐全；每个需要生成的资产都有图片提示词。
4. 分镜与提示词：每集有完整镜头；每镜都有分镜图片提示词和视频提示词。
5. 媒体生成：需要的参考图、分镜图和视频均已生成并绑定业务实体。
6. 合成交付：时间线和 Deliverable 已创建并通过现有领域门禁。

## 4. Prompt、Skill、Schema 的最小职责

| 层 | 负责 |
| --- | --- |
| Harness Workflow | 阶段、依赖、并行、重试、恢复 |
| Agent role | 当前节点的专业创作职责 |
| Skill | 创作方法、风格标准、人工审核说明 |
| Prompt | 当前节点的具体目标和上下文 |
| JSON Schema | 结构、必填字段、枚举 |
| Validator | 引用存在、覆盖完整、版本一致等少量业务规则 |
| Project Domain | 正式产物和幂等写入 |

`/schemas` 继续保存机器可校验的输出契约，但不放 Prompt 正文，也不承载调度逻辑。Prompt 放在对应阶段模板中，Workflow 只引用它。

## 5. 最小恢复方案

1. Project 保存 `activeWorkflowId`。
2. 入口重复调用时查询并返回同一个 Workflow，不创建第二条流程。
3. 失败后直接调用 Harness 的 retry/resume。
4. Harness 负责跳过已完成节点并重试失败节点。
5. Stage Runner 的领域写入使用稳定幂等键，防止 Workflow 重放时重复创建实体。
6. 媒体节点只额外保存远端 `jobId`，恢复时先查询旧任务，避免重复提交。

如果实测确认 Harness 不能跨进程恢复，才增加一个极薄的 `lastCompletedStage` 游标；在确认该限制之前，不建设新的调度状态机。

## 6. 画布规则

- 当前流程只认 `project.activeWorkflowId`。
- 六个阶段状态直接映射 Harness Workflow 节点状态。
- 内容只展示 Project Store 中已正式提交的产物。
- Workflow 显示完成但 Deliverable 缺失时，画布显示“不一致/失败”，不能显示完成。
- “重试”按钮直接调用 Harness retry/resume，不经过新聊天，也不要求主 Agent 再次遵循 Skill。
- 历史 Workflow 单独展示，不参与当前进度统计。

## 7. 明确撤回的设计

本项目当前不新增：

- 通用 Root Run 聚合模型；
- 第二套动态 DAG 和 Expander；
- 插件自研 Scheduler、Lease、Heartbeat、Fencing；
- 独立 Attempt/Event/Outbox 平台；
- 动态 append/seal/barrier 调度协议；
- 通用 handler registry 和复杂 Pipeline Compiler；
- 文本 Run、媒体 Run、子 Run 的聚合体系。

现有相关代码先旁路，不立即大规模删除；新 Harness 流程验收稳定后，再按实际无调用关系逐步移除。

## 8. 最小实施顺序

### 第一步：垂直切片

只实现：

```text
小说分析与分集规划 → 分集剧本
```

验证 Harness 的 fan-out、失败重试、关闭原聊天后继续执行，以及正式剧本落库。

### 第二步：补全创作核心

加入资产设定、角色/场景/道具图片提示词、分镜图片提示词和视频提示词。至此完成 AI 短剧“文本与提示词”基础闭环。

### 第三步：画布接入

Project 增加 `activeWorkflowId`；画布读取 Harness 状态和正式业务实体；重试直连 Harness。

### 第四步：媒体与交付

复用现有 ComfyUI、媒体绑定、拼接和 Deliverable 能力，不重写媒体基础设施。

### 第五步：删除旁路

完整流程通过后，停止并逐步删除旧的同步小说编排和重复生产调度代码。

## 9. 验收标准

- 一次入口调用能启动或恢复同一个 Harness Workflow。
- 多 Agent 按固定职责产出，不由 Agent 自由决定流程。
- 任一节点失败后可使用 Harness 原生能力重试。
- 关闭或归档原聊天后流程仍继续；若 Harness 当前不支持，明确记录限制并只增加阶段游标。
- 画布能逐阶段展示正式剧本、角色提示词、分镜图片提示词、视频提示词和媒体状态。
- 《都市生日夜》最终形成完整 Deliverable。

## 10. 一句话架构

**Harness 编排固定短剧流程，Agent 负责创作，Schema 保证结构，Project 保存正式产物，Canvas 展示结果。**
