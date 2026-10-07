# 《都市生日夜》Codex 介入与自主性审计

## 判定

- 最终成片质量：`PASS`。角色一致、剧情连贯、多镜头无明显漂移。
- 当前运行的自主流程验收：`FAIL`。同一 Project/Run 在生产期间经历多轮代码热修、插件重装、服务重启和再次调用入口，不能证明“运营单次发起后由 DeepSeek Harness 自主完成”。

## Codex 介入分类

| 阶段 | 介入 | 性质 | 对自主验收的影响 |
| --- | --- | --- | --- |
| 首次发起 | 在 3080 页面提交一次 Pilot | 允许运营动作 | 不影响 |
| 文本恢复 | 三轮修改 `novel-production`、重装、重启并再次发送恢复指令 | 代码热修、人工唤醒 | 使本次验收失效 |
| 视频恢复 | 修复 H3 引用上限后重装、重启并再次调用入口 | 代码热修、人工唤醒 | 使本次验收失效 |
| 合成交付 | 移除 concat/deliver 的 LLM 精确回显后重装、重启并再次恢复 | 代码热修、人工唤醒 | 使本次验收失效 |
| 画布 | 修复 required asset 统计和 Deliverable 投影；期间触发离屏角色 rework | 代码热修、额外生产 | 使本次验收失效 |
| 观察 | 页面轮询、读取 Project、检查视频和 hash | 只读观察 | 不影响 |

## 已确认的局部根因

1. H3 的 `refs.max=8` 只声明在 manifest，执行器仍可注入 `ref_image_9`。上限必须由 graph compiler 和引用选择共同执行。
2. concat/deliver 要求 LLM 精确回显 taskId、hash、inputSignature 和节点顺序，把确定性运输步骤变成概率性步骤。
3. 画布把全部 authored entity 计入 required assets，并将有效 Deliverable 错误绑定到全局 `project.status`。

以上问题已经修复并有回归测试，但只能解释为什么旧运行最终能够恢复，不能把旧运行升级为自主验收通过。

## 尚未闭环的架构根因

媒体生产由常驻 `ProductionWorker` 持有执行所有权，能够扫描 ready 或租约过期任务。文本生产则由 `studio_novel_orchestrate` 在当前聊天 Agent 的前台调用栈中执行：

1. `studio_novel_create` 调用 `studio_novel_orchestrate`；
2. 当前聊天 Agent 同步等待 `novelTextProduction`；
3. 文本完成后，同一调用栈才创建媒体 Run；
4. 会话或进程中断时，细粒度文本状态虽然存在，但没有后台执行者继续，也没有持久 continuation 负责“文本完成 → 媒体 Run”。

文本节点还使用 30 分钟租约且没有独立心跳。重启后再次调用入口也可能因旧租约未过期而无法立即接管。

因此根因不是 Prompt 或 Skill 不够强，而是文本 Workflow 的执行所有权没有持久化。

## 最小修复边界

- 将“整本小说文本生产”包装为现有 `ProductionWorker` 的短剧专用 root task。
- `studio_novel_create` 只负责建项目、导入原文、创建或恢复 root task，然后返回 queued 状态。
- Worker 使用独立 Harness Agent 运行现有 `novelTextProduction`，继续复用节点级 checkpoint、Schema 校验和领域提交。
- root task 完成文本后自动创建媒体 Run；服务重启由同一个 Worker 扫描并接管。
- 不增加通用 Scheduler、事件总线或新的平台抽象。

## Clean-room 验收规则

1. 使用全新 Project/Run；旧 Project `20261007141225410` 只作为质量基准和故障样本。
2. 运营仅在 3080 页面发起一次；之后禁止 Codex 再次调用入口、内部工具、shell、API、状态命令或修改数据。
3. 允许只读观察；Recovery 场景只允许 UI 的一次“重试任务”。
4. 运行期间任何代码热修都会使本次验收作废，修复后必须重新创建 Project。
5. 最终证据必须同时包含：单次入口轨迹、文本与媒体 task owner、重启恢复、画布 100%、Deliverable 文件/hash 和人工质量检查。
