# 都市生日夜完整流程验收

> 状态：待确认修复计划
> 基线：2026-10-07，`novel-to-drama-text-v1`

## 计划

- [x] 归档受污染的旧会话。
- [x] 完整移除并重新安装 `web` profile 插件，重启 Harness，验证安装包入口可加载。
- [x] 新建会话并确认唯一入口链路：加载 `elysium-generate-drama` → `studio_novel_create` → Harness Workflow。
- [x] 实测定位首个断点：`episode-plan` 两次结构化输出失败；失败后主 Agent错误地继续调用其他工具。
- [ ] 修复 `episode-plan` 动态约束：明确非空、唯一、全部 beat 覆盖及全文 `0..N` 连续覆盖要求。
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

- 待实施和最终实测后填写。
