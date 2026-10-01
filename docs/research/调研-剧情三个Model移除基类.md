# 剧情三个 Model 移除基类调研

## 结论
- AC-1 已确认：三个业务类只有 kind 和 fields，实际构造及编排都在 StoryModel，未真正独立。
- AC-2 已确认：outline 接口直接引用 StoryModel 进行人工编辑整包审核，删除基类时须接回接口审核编排。
- AC-3 已确认：generate/story.js 与预览依赖业务类入口，保留入口和输出可不改 API 流程。

## 规格
- 目标：移除业务基类，三个模型独立声明资料结构、职责和三类提示词函数。
- 非目标：不改生成顺序、网络、存储、技能正文和审核规则。
- AC-1：无 StoryModel 继承及导入，story-model.js 不存在。
- AC-2：各业务模型自身拥有构造、上下文、生成、修订和审核方法；公共模块只做内容转文本和 messages 序列化。
- AC-3：实际请求、预览、修订基稿隔离、人工编辑审核与前后步骤行为保持一致。

## 调用链与证据
story-prompts → 三个业务类 → outline 接口 → text-prompts；人工编辑审核从 text-prompts.buildEditedContentReview 进入 outline 接口，目前用 kind=package 的 StoryModel。

| 来源 | 结论 |
|---|---|
| models/story-model.js | 角色、资料、目标、范围均通过 kind 分支决定 |
| 三个 story-*-model.js | 仅继承和 fields |
| interfaces/outline.js | 编辑整包审核也依赖基类 |

## 待用户决定
无。用户已批准独立模型方案，仍只跑相关测试。
