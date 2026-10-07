# 《都市生日夜》完整流程验证方案

> 目标：用有限、可重复、可判定的验收，证明 AI 短剧基础流程能够交付。  
> 样本：`/Users/mac/ai/llm-test/都市生日夜.md`（当前 12,850 bytes）  
> 结论口径：只有 `PASS / FAIL / BLOCKED`，不使用“基本可用”“大部分完成”。

## 1. 验证范围冻结

本轮只验证：

```text
小说导入
→ 小说分析与分集规划
→ 分集剧本
→ 角色/场景/道具及图片提示词
→ 分镜、分镜图片提示词、视频提示词
→ 图片与视频
→ 合成与 Deliverable
→ 画布展示与失败恢复
```

本轮不验证：

- 主观画质优化；
- 高级剪辑、局部重绘、返工工具；
- 多模型/多档位对比；
- 性能优化和大规模并发；
- 非《都市生日夜》的泛化能力；
- 与基础流程无关的 UI 美化。

任何不影响上述闭环的问题记录为 follow-up，不在本轮顺手修复。

## 2. 有限执行规则

只执行两个真实场景，顺序固定：

1. **Pilot Recovery Run**：从《都市生日夜》固定截取一个完整故事单元，限制为 1 集、2–3 镜头；真实走完六阶段，并在本次运行中验证一次节点失败和一次服务重启恢复。
2. **Full Happy Run**：Pilot 全部通过后，使用完整小说创建全新 Project，从导入一直生成到最终 Deliverable。

修复上限：

- 每个验收门禁最多两轮修复；
- 每轮必须先形成稳定复现或失败断言，再修改代码；
- 同一根因第三次出现，立即停止继续补丁，结果记为 `BLOCKED`；
- `BLOCKED` 报告必须指出缺失的 Harness 能力或架构断点、最小复现和下一项唯一决策；
- 不通过增加新框架、新状态机或绕过校验来换取通过。

Pilot 每个 Gate 最多允许一次根因修复和一次复验；复验仍失败立即 `BLOCKED`，不得进入 Full Happy Run。真实媒体生成成本高，因此失败后优先从当前 Workflow 的失败节点恢复；只有领域数据被污染或 Workflow 无法恢复时，才允许重新创建一次 Pilot。

## 3. Gate 0：环境与基线

开始真实运行前必须同时满足：

- 记录 Git HEAD、工作区 diff、插件源码 hash；
- 记录小说 SHA-256；
- 关键源码语法检查通过；
- web profile 安装副本与工作区关键文件 hash 一致；
- Harness 服务重新启动且插件无加载错误；
- 使用全新 Project，不复用旧 v1-v6 Run 或旧媒体产物。

任一项失败，不进入真实媒体流程。

## 4. 六阶段门禁

所有门禁都通过 Project JSON、Harness Workflow 状态和文件事实判定，不以 Agent 自述为证据。

### Gate 1：小说分析与分集规划

必须满足：

- Project 绑定唯一 `activeWorkflowId`；
- Workflow 状态可查询；
- 故事分析已正式落库；
- episode 数量大于 0，ID 唯一；
- 原文引用合法，不越界；
- 分集规划覆盖正式分析中的剧情节点。

### Gate 2：分集剧本

必须满足：

- 正式剧本数量等于 episode 数量；
- 每集包含场景、动作或对白，不允许空壳剧本；
- 每集关联本集剧情节点和当前故事分析版本；
- Harness 中所有 episode fan-out 节点成功；
- 某集失败不能被 `null`、模板剧本或通用镜头静默替代。

### Gate 3：资产与图片提示词

必须满足：

- 正式剧本中引用的角色、场景、关键道具均有领域实体；
- 每个需要生成的角色、场景、道具都有非空图片提示词；
- 资产引用能追溯到具体 episode/scene/shot；
- 不允许凭空补入剧本中不存在的核心资产；
- Harness 资产阶段成功。

### Gate 4：分镜与视频提示词

必须满足：

- 每个 episode 至少一个 shot；
- 每个 shot 有合法 episode、location 和必要的 character/prop 引用；
- 每个 shot 有非空分镜图片提示词；
- 每个 shot 有非空视频提示词；
- 剧本对白和关键事件全部被镜头覆盖；
- 镜头时长符合当前媒体工作流约束；
- Harness 分镜阶段成功。

此 Gate 通过即代表“AI 短剧文本与提示词基础链”完整，不代表媒体交付完成。

### Gate 5：媒体生成

必须满足：

- 每个需要视觉参考的资产都有可读取图片；
- 每个 shot 都有可读取分镜图和视频文件；
- 媒体文件非空且能解析基础元数据；
- 媒体绑定到正确的业务实体，不能只存在于画布临时节点；
- 远端 jobId/attempt 能追溯，失败恢复不重复提交同一任务；
- Harness 媒体阶段成功。

### Gate 6：合成、交付与画布

必须满足：

- 时间线包含全部正式 shot，且每个 shot 恰好出现一次；
- Deliverable 已创建，文件存在、非空、可读取；
- Workflow 为 completed；
- Project 的正式完成状态与 Deliverable 一致；
- 画布显示的 episode、script、asset、shot、prompt、media 数量与 Project JSON 一致；
- 画布当前流程 ID 等于 `activeWorkflowId`；
- 历史失败流程不污染当前阶段进度和错误。

## 5. Pilot Recovery Run

Pilot Recovery Run 只验证两个已知高风险点，不遍历其他异常组合：

1. 在自动化测试中让一个 episode-script 节点首次返回无效结构；
2. 确认 Harness 将该节点标为失败或进入原生重试，而不是吞错；
3. 恢复后只重新执行失败节点，已完成节点不重跑；
4. 在 Pilot 完成 Gate 4 后重启 Harness 服务；
5. 不发送新的聊天消息，使用原 `activeWorkflowId` 继续或显式 Harness resume；
6. 最终完成 Gate 3-6；
7. 确认 Project 中没有重复 episode、asset、shot 或媒体绑定。

如果 Harness 实测不支持跨进程恢复，本项立即判定 `BLOCKED`，只允许实现架构方案中已约定的极薄 `lastCompletedStage` 游标；禁止恢复旧的通用 Worker/DAG 设计。

Pilot 全部通过后，Full Happy Run 使用完整小说重复 Gate 1-6；最终判定必须来自 Full Happy Run，Pilot 不能替代整书交付。

## 6. 自动化验证层级

### L1：Stage Runner 聚焦测试

- 每阶段合法输出能落库；
- Schema 或业务校验失败时不写正式数据；
- 相同幂等键重放不重复创建实体；
- 缺角色提示词、分镜图片提示词或视频提示词时明确失败。

### L2：插件流程测试

- `studio_novel_create` 创建/复用同一个 Workflow；
- 入口不等待整条创作链完成；
- Harness fan-out 的失败不会被过滤；
- retry/resume 后继续推进；
- Canvas 投影只读取 `activeWorkflowId`。

### L3：全量回归

```bash
git diff --check
npm pack --dry-run
```

### L4：真实 UI 与媒体

在 `http://127.0.0.1:3080/` 使用新会话发起《都市生日夜》生产，逐 Gate 检查 Project、Workflow、Canvas 和最终文件。

## 7. 证据包

每次真实验收写入独立目录：

```text
artifacts/e2e/<run-id>/
  manifest.json
  test-summary.txt
  workflow-status.json
  project-final.json
  canvas-final.json
  stage-counts.json
  service-restart.txt
  screenshots/
  deliverable-metadata.json
```

`manifest.json` 至少包含：Git HEAD、源码 hash、插件安装 hash、小说 hash、projectId、workflowId、开始/结束时间、每个 Gate 的 `PASS/FAIL/BLOCKED` 和证据路径。

大型正文和完整日志不复制到报告；报告只保存摘要、错误位置和原始文件路径。

## 8. 最终判定

只有以下条件全部满足才是 `PASS`：

- Gate 0-6 全部通过；
- Pilot Recovery Run 六阶段、节点重试和服务重启恢复全部通过；
- Full Happy Run 六阶段全部通过；
- `git diff --check` 与 `npm pack --dry-run` 通过；
- 证据包完整；
- 最终 Deliverable 可读取；
- 无人工补写业务数据、无 shell 绕行、无复用旧项目结果。

任一基础 Gate 未通过就是 `FAIL`；同一根因达到修复上限或 Harness 缺失必要能力就是 `BLOCKED`。不得用局部成功宣布完整流程通过。

## 9. 实际执行顺序

1. 实现并自动化验证“小说分析 → 分集剧本”的 Harness 垂直切片。
2. 接入资产、图片提示词、分镜和视频提示词，完成 Gate 1-4。
3. 接入 `activeWorkflowId` 画布投影和 Harness retry/resume。
4. 运行 L1-L3；失败只修当前 Gate 的 P0 根因。
5. 强制重新安装插件并重启 Harness，核对安装副本 hash。
6. 执行 Pilot Recovery Run；失败达到上限就交付 `BLOCKED`，不进入全书。
7. Pilot 通过后，执行完整小说的 Full Happy Run。
8. 生成证据包和最终 `PASS/FAIL/BLOCKED` 报告，停止本轮。
