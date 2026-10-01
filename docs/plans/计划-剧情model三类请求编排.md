# 剧情 model 三类请求编排

- 类型：重构
- 目标：剧情提示词参照摘要，独立 model 编排三类任务，保证最终大纲提取完整人物和场景。
- 调研：docs/research/调研-剧情model三类请求编排.md

## 待用户决定
无。

## 改动
1. meiji/server/prompts/models/story-model.js：新增结构、共享上下文、生成/修订/审核 segments 与 messages → AC-1、2、3、4。
2. meiji/server/prompts/story-prompts.js、interfaces/outline.js：改为赋值 model、选择技能快照并调用独立入口；单类卡片选择对应协议 → AC-1、2、4。
3. meiji/skills/stages/outline/common.md、generate.md、revise.md、review.md、protocol.md：减少角色/自检重复、明确最终大纲提取与同步修改；保留原身体和空间规则 → AC-3、4。
4. meiji/tests/story-model.test.js 及受影响测试：验证模式隔离、基稿/意见、提取顺序与单类输出；相关流程、预览、架构回归 → AC-1–4。
5. meiji/docs/story-model.md、.agents/architecture.md：记录模型和调用链。

## 验收标准
AC-1 独立三入口；AC-2 模式资料隔离与修订基稿对照；AC-3 最终大纲提取人物与场景并审核一致性；AC-4 单类卡片范围及协议正确。

## 验证结果
基线相关 41 项通过，0 失败/取消。实施后只执行相关测试，生成前后提示词快照与差集，git diff --check，收尾更新 GitNexus 索引。

## 用户补充后的计划调整
- 最新要求：拆三个提示词 Model；大纲、提取人物、提取场景必须是独立步骤及独立 API 请求，替代早期“一次整包返回”的方案。
- 新增 story-outline-model.js、story-character-model.js、story-scene-model.js，共享 story-model.js 的上下文与三类任务基础编排。各模型仅输出本步骤字段。
- generate/story.js 顺序执行三组生成/审核步骤，前项未通过停止后项；逐步保存草稿。registry.js 登记 outline、characters、scenes 三个目标的计划。
- operations/story.js、data/story-package.js、data/review-checks.js 支持分阶段保存与独立审核状态；任务快照保持既有剧情包历史形式。
- 技能按大纲/人物/场景小节选择；审核仅使用当前阶段要求，不要求尚未生成的卡片。
- AC-5：成功时三个独立生成请求与三个独立审核请求；提取收到最终大纲；失败/取消停止后项且保留有效草稿，已通过节点状态不被后项失败覆盖。

- operations/finish.js：后项执行错误或取消时保留已审核通过的剧情阶段状态，避免将已完成大纲标成失败 → AC-5。
- prompts/preview.js 与 client/skill-detail.js：显示三阶段实际请求预览 → AC-1、5。

- data/task-store.js：剧情包快照审核状态按三项聚合，不用已通过大纲代表尚未完成的整包；data/review-checks.js 的大纲修订只要求大纲基稿，允许首次大纲失败、尚无卡片时按意见修订 → AC-2、5。

## 最终验证结果
- 按用户最新要求实现三个业务 Model、三个独立生成及各自审核步骤。
- 基线相关测试 41 通过；最终 15 个相关测试文件共 108 通过，0 失败、0 取消。未执行全套 npm test。
- 新测试验证阶段选择、三类请求、最终大纲、修订基稿/意见隔离、前项失败停止、API 错误保留、取消、预览一致、无卡片时可修订和聚合快照。
- 提示词快照：改造前 28、改造后 30 个场景；37 条删除/改写均在差集报告逐项说明去向。
- git diff --check 通过。GitNexus 索引已成功更新，并读取仓库 context 核实。
