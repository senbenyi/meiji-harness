# 引用编排 skill 收敛

- 类型：重构
- 目标：直接保留每秒指令，只转换提示词结构和多模态引用。
- 调研：docs/research/调研-引用编排skill收敛.md

## 待用户决定
无。

## 改动
1. `meiji/skills/task/generate-text-storyboard-skill.md`：重复创作要求 → 精简完整性及引用约束；`models/text-storyboard-model.js` 负责转写、声音标签、模式格式和限定审核。AC-1/4。
2. `meiji/server/prompts/storyboard-context.js`：共用本镜上下文；`shot-prompts.js`、`text-prompts.js` 生成及人工编辑审核改用它，移除引用编排的跨镜全文审核。AC-2。
3. `meiji/skills/catalog.js`、`protocols.js`、`prompts/interfaces/registry.js`、`preview.js`、`data/node-skills.js`：清除 text-shot 注册、协议、接口、预览和节点操作；删除独立 Model/接口/skill。保留历史记录及现有 supplementalSkills 的存储校验。AC-3。
4. 相关 `meiji/tests/`：调整旧上下文和数量断言；验证 text/reference 格式、生成/修订/人工编辑审核的同范围、无跨镜重审、停用入口、补充及错误草稿。移除模拟请求中不再可达的 text-shot 分支。AC-1/2/3/4。
5. `.agents/architecture.md`、`.agents/meiji-dev.md`、`meiji/docs/tasks-and-steps.md`：更新成片编排职责，保持简洁。AC-1/2/3。

## 验证
- 用户要求只跑相关功能测试。基线八组共 52 项通过、0 失败、0 取消。
- 改前后 30 个提示词场景与差集报告，逐类说明删除规则去向；相关生成、审核、技能、预览、任务及视频引用测试。
- `git diff --check`；完成后统一更新 GitNexus 索引一次。

## 验收标准
AC-1 基础规则收敛且转写与输出协议仍完整；AC-2 审核只对照当前镜头；AC-3 停用入口不可访问；AC-4 原生成门禁、保存与图片提交行为保持。

## 验证结果
未执行。
