# 剧情提示词 Model

## 统一的剧情 Model

`server/prompts/models/story-model.js` 的 `StoryModel` 编排大纲、人物、场景、道具四类资料；`storyKinds` 为每类声明职责、上游资料、本次目标与审核目标、审核范围、输出协议及 fields。导出的 `StoryOutlineModel`、`StoryCharacterModel`、`StorySceneModel`、`StoryPropsModel` 只是指定 kind 的子类。

| kind | 负责内容 | 输出 |
|---|---|---|
| outline | 本集大纲、事件因果、跨集衔接 | 大纲纯文本 |
| characters | 从最终大纲提取实际可见身体身份 | `{ "items": [...] }` |
| scenes | 从最终大纲提取实际空间 | `{ "items": [...] }` |
| props | 从最终大纲提取需复用的重要道具与着装 | `{ "items": [...] }` |

三类请求由 `request.js` 统一组装：生成/修订使用生产规则（skills/task），审核使用对应审核 skill（skills/review）。人物保留姓名、国籍、身份、性别、年代、年龄、服装、身高、体型、面相、外貌、道具、身体与意识关系及 look；场景保留 name、landmark、light、space、look。

大纲生成与修订按「本次任务（含目标）→ 本集摘要 → 参数（时长、项目风格）→ 背景参考与前后集衔接 → 基稿和意见（修订时）」编排。首次与重新生成都以当前本集摘要为事件依据；重新生成不使用旧大纲和历史意见。项目摘要、剧本帮助理解背景，前后集约束开场和结尾，不能扩展本集事件范围。审核使用同一摘要与上下文，任务与生成指令分开。

角色段只保留职业身份。大纲任务为一句依据和动作说明，引用「基础规则」「补充规则」；不重复生产要求或返回格式。基础 skill 放基础规则，当前集大纲节点补充 skill 放补充规则；保留其来源和节点标识。审核中补充正文仅供验收，输出格式仍由独立协议规定。

## 赋值与提示词函数

构造参数为 project、mode、baseContent、opinion，以及可选 generationRules、reviewRules、revisionRules、outputProtocol。各 model 独立记录 role、reviewRole、project、parameters、modification、fields；人物和场景模型额外记录 approvedOutline，大纲模型保留摘要、剧本与前后集资料，提取模型仅保留标题和最终大纲。生成与审核各自使用固定职责，不需要给接口另传“设计师”类型的 role；最终 messages 仍为 system/user。

- `toGenerateMessages()`：组装首次生成或重新生成。
- `toReviseMessages()`：组装人工意见修改；automatic=true 时以本轮失败稿为唯一基准，并分别保留人工意见和本轮失败原因。
- `toReviewMessages({ content })`：独立审核，仅对照本次资料、基稿与意见，返回 PASS/FAIL。
- `toGenerateSegments()`、`toReviseSegments()`、`toReviewSegments()`：同一编排返回来源片段，供实际请求、技能快照与预览使用。

例如：

```js
const model = new StoryCharacterModel({
  project: { ...project, plot: { ...project.plot, outline: { content: finalOutline } } },
  mode: 'generate',
  generationRules: characterRules,
  reviewRules: characterReviewRules,
  outputProtocol: characterProtocol,
})
const messages = model.toGenerateMessages()
```

实际入口 buildStoryPrompts 给对应模型赋值；接口给大纲、人物、场景 Model 赋值对应的单一基础生产规则，生成与审核共用，修订增加意见。规则文件分别为 generate-story-outline-skill.md、extract-story-characters-skill.md、extract-story-scenes-skill.md；输出协议由代码维护。

## 请求与步骤顺序

大纲生成 → 大纲审核 → 提取人物 → 人物审核 → 提取场景 → 场景审核。正常共三次生成请求、三次审核请求；各项失败时仍复用已有一次自动修订与复审机制。提取前项未通过时停止后项，不以旧大纲继续生成。

修改剧情大纲时只先修改大纲，审核通过后按新大纲重新提取两类卡片；提取不带旧资料和历史意见，以最终大纲为事实依据。同名卡片的素材 ID 和确认图片由程序保留。单独修改人物或场景时提供该类基稿和意见，不修改大纲和另一类卡片。

每份有效草稿在审核前保存。后一步接口错误或取消时保留前面已生成内容与通过状态；未完成的旧卡片标过期，不允许继续制作镜头。首次大纲失败、尚无卡片时仍能按意见修订大纲。

技能详情预览保留大纲四类请求，额外展示人物、场景各自的生成、意见修改、审核和自动修订请求。

人工编辑后的综合审核由 interfaces/outline.js 单独组装，涵盖提供的大纲与两类卡片，不创建第四个业务 Model。
