# 剧情三个 Model 移除基类

- 类型：重构
- 目标：三个业务模型独立管理结构与提示词，移除 story-model.js。
- 调研：docs/research/调研-剧情三个Model移除基类.md

## 待用户决定
无。

## 改动
1. models/story-outline-model.js、story-character-model.js、story-scene-model.js：由薄继承类变为独立构造与编排，各自明确所需资料，消除内部 kind 分支 → AC-1、2。
2. prompts/prompt-text.js：仅抽取内容文本化及 messages 序列化 → AC-2。
3. models/story-model.js：删除；interfaces/outline.js：使用三个独立模型，人工编辑资料的综合审核由接口单独编排 → AC-1、3。
4. tests/story-model.test.js：补充独立结构与编辑审核断言；文档和架构同步 → AC-1–3。

## 验证
基线和最终仅运行 story-model、prompt-nodes、prompt-interfaces、project-generation-review、story-package、architecture 测试。生成提示词快照比较，确保生成/修订/审核规则未丢失；git diff --check，收尾更新 GitNexus 索引。

## 验证结果
基线 42 项通过；最终仅运行 6 个相关测试文件，44 项通过，0 失败、0 取消。30 个提示词场景与请求格式完全一致，删除规则 0 条；git diff --check 通过。GitNexus 索引更新成功，并读取 context 核实。
