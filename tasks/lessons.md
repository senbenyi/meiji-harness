# Lessons

- 端到端验收一旦出现节点失败或主 Agent脱离唯一入口，立即停止会话并把该次结果判为失败；不能继续探索后再把局部成功当成流程通过。
- `file:` 插件更新不能以 `Already up to date` 作为已重装证据；必须验证安装目录入口可 import，必要时先 remove 再 `add --force`，并以宿主重启日志无加载错误为准。
- 重新发起 Harness 会话前区分“会话干净”和“Project 持久状态复用”；验收报告必须明确当前验证的是全新任务还是恢复路径。
- Pipeline manifest 的角色、Schema、Prompt 或校验契约发生变化时必须提升 `version`；否则恢复会复用旧任务快照，形成新 Prompt 与旧角色/状态混跑。
- 能从稳定输入确定的数据（例如按 `beatIds` 推导的全文连续 `sourceSpans`）应由 Harness 计算并校验，不能继续依赖模型按 Prompt 精确计算坐标。
