# 剧集摘要提示词 model

`server/prompts/models/episode-summary-model.js` 共用故事数据，分别组织生成、意见修订、审核请求。实际调用和预览经 `buildEpisodePrompts` 选择同一任务技能快照，不在网关追加包装。

## 属性

| 属性 | 内容 |
|---|---|
| role / reviewRole | 短剧分集编剧 / 独立剧集摘要审核员 |
| project | 标题、项目摘要、剧本、风格、输出语言，不包含画幅 |
| target | 目标集 ID、集数、参考时长及允许范围 |
| previousEpisodes / followingEpisodes | 全部前集事实 / 后集衔接约束，按剧情顺序排列 |
| generationRules | 固定创作约束；审核时明确仅作验收依据，允许为空 |
| outputProtocol | 生成及修订的 JSON 协议 |
| revisionRules / reviewRules | 单独使用 model 时赋予的修订边界与验收标准 |
| mode | generate / regenerate / modify |
| modification | 人工修改基稿、原时长与本次意见，仅 modify 使用 |

## 三类编排

| 类型 | system | user | 输出 |
|---|---|---|---|
| 生成/重做 | 编剧身份、固定约束、通用创作要求、本剧补充、输出协议 | 本次任务、参数、故事及前后集资料、生成要求 | 摘要 JSON |
| 人工/自动修订 | 编剧身份、固定约束、通用要求、补充、修订边界、输出协议 | 共用上下文、唯一修订基稿、本次意见；自动修订同时保留人工意见 | 完整摘要 JSON |
| 审核 | 独立审核员、创作约束（验收依据）、验收标准、补充要求、模式范围、审核协议 | 共用上下文、对应修订基稿与意见（有才提供）、最新待审稿 | PASS / FAIL |

审核只采用摘要专属规则，不注入通用审片师模板或其他阶段语言字段。审核协议集中在 system 末尾；具体语言和时长范围只在 user 参数中给出。

首集根据项目资料开场；后续集承接前集。有后集则衔接而不提前演出；无后集则留下有因果依据的悬念。重新生成不提交旧稿和历史意见。人工修订初审对照人工基稿；自动修订和复审对照最新失败稿及本轮意见，不能将历史失败直接作为新失败。

## 赋值与函数

```js
const model = new EpisodeSummaryModel({ project, episodeId, referenceDurationSeconds: 150 })
model.generationRules = skillSet.skills.episode.constraints
model.outputProtocol = skillSet.skills.episode.protocol
model.revisionRules = skillSet.skills.episode.parts.revise
model.reviewRules = skillSet.skills.episode.parts.review

const generate = model.toGenerateMessages()
const revise = model.toReviseMessages({ baseContent: draft, opinion: '补足人物动机' })
const review = model.toReviewMessages({ content: revisedDraft, baseContent: draft, opinion: '补足人物动机' })
```

基稿和待审内容接受原始字符串或摘要 JSON 对象。自动修订传 `automatic: true`，`opinion` 为本轮失败原因，`humanOpinion` 为仍有效的本次人工要求。

三个 Messages 函数分别复用 `toGenerateSegments`、`toReviseSegments`、`toReviewSegments`；实际接口传入带来源标注的技能片段与本剧补充。`contextSegments()` / `contextText()` 只组织共用上下文；`toMessages()` 是生成消息的简便入口。

实际业务仍优先调用 `buildEpisodePrompts(project, episodeId, referenceDurationSeconds)`，避免单独使用示例遗漏技能覆盖和本剧补充。
