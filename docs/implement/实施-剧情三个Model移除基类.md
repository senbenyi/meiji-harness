# 剧情三个 Model 移除基类实施记录

## 已修改文件
- models/story-outline-model.js、story-character-model.js、story-scene-model.js：各自独立构造及上下文、生成、修订、审核方法，不继承业务类。大纲保留故事事实，人物/场景只保留标题与最终大纲。
- models/story-model.js：移除。
- prompts/prompt-text.js：仅两个文本化与消息序列化函数，不含业务模式或规则。
- interfaces/outline.js：移除基类依赖，人工编辑资料的综合审核单独在接口编排。
- tests/story-model.test.js：新增类方法独立性、各自资料结构及综合审核断言。
- meiji/docs/story-model.md、.agents/architecture.md：同步独立模型设计。

## 验收标准核对
| AC | 状态 | 证据 |
|---|---|---|
| AC-1 移除基类与继承 | 通过 | 三类原型直接为 Object.prototype，源码无 StoryModel 导入，原文件不存在 |
| AC-2 各自结构与三类编排 | 通过 | 各类自身声明方法及字段；提取模型不保留剧本或前后集事实 |
| AC-3 请求及流程保持一致 | 通过 | 30 场景实际请求逐项一致；相关流程与人工编辑审核测试通过 |

## 测试
基线 42 通过；最终仅运行 story-model、prompt-nodes、prompt-interfaces、project-generation-review、story-package、architecture 六个相关测试文件，44 通过，0 失败/取消。未跑全套 npm test。

前后提示词快照 30 个场景，实际提示词及请求格式完全一致；删除规则 0 条。git diff --check 通过。本次未修改技能正文、API、存储与步骤顺序。

## 人工待办
无。

## GitNexus
规定的索引命令执行成功（5,752 节点），已读取仓库 context 核实。
