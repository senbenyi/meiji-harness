# Harness 全流程验收调研

## 结论
- AC-1 — 已确认部分：真实页面创建项目、手工新增第 1 集成功；AI 摘要超过 300 字，校验正确阻止保存，尚需验证成功生成。
- AC-2 — 已确认缺陷：剧情三步真实执行并保存，但首次大纲请求按 regenerate 组装，遗漏本集摘要。
- AC-3 — 已确认缺陷：摘要无 skill 入口，剧情只有整包入口；补充内容保存在项目级，无法满足每集每节点隔离。
- AC-4 — 已确认缺陷：历史页没有接入事件刷新；新增集弹框无法查看任务步骤与提示词。
- AC-5 — 未验收：修改意见成功清理、节点补充增删改和跨集隔离须在修复后复验。

## 规格
- 目标：走通项目、剧集、摘要及大纲/人物/场景流程，修复发现的问题并同步简明开发文档与图谱。
- 非目标：修改 Harness 源码、生成图片或成片、无证据删除技能。
- 验收：AC-1 真实项目与两集摘要生成；AC-2 大纲使用摘要，人物/场景使用本轮大纲；AC-3 摘要/大纲/人物/场景各有 skill 管理且跨集隔离；AC-4 历史与当前步骤自动更新、完整提示词可查看；AC-5 意见修订成功清理、失败保留；AC-6 相关测试、文档/目录与图谱更新。

## 调用链与证据
| 来源 | 结论 |
|---|---|
| client/overview.js:episodeDialog → client/episode-draft.js | 草稿任务轮询但弹框未显示步骤 |
| client/stages.js:renderStory → server/prompts/story-prompts.js:buildStoryPrompts | 无首次生成模式，默认重新生成遗漏摘要 |
| server/prompts/interfaces/outline.js → 三个 Story Model | 三步已拆分；各自选对应技能小节 |
| client/skill-entry.js → app.js:openSkill → http/skill-routes.js | 只有项目级补充 |
| client/execution-history.js / app.js:openHistory | 历史加载后不响应任务事件 |
| 真实验收项目 605fd84c-ad1e-462f-ab20-f592849f45d7 | 草稿 ba2b91bc… 正确拦截超长；剧情 f3eb3eca… 已保存 4 人物、6 场景 |

## 问题
| AC | 预期 | 实际 | 根因 |
|---|---|---|---|
| AC-2 | 首次剧情展开摘要 | 从项目重新创作 | mode 默认 regenerate |
| AC-3 | 每集每节点补充 | 全剧补充 | 数据和入口粒度过大 |
| AC-4 | 历史实时、草稿可观察 | 静态历史、弹框仅等待 | 未注册刷新/回调 |

## 待用户决定
无。此前用户已明确节点补充结构及作用范围。
