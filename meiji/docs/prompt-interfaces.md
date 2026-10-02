# 各接口独立定义提示词

各生成接口的请求结构在 `server/prompts/interfaces/` 独立维护。公共层不再决定角色、顺序、语言段落或 JSON 模式；网关仍共用网络请求、鉴权、取消和日志。

## 修改入口

以下路径均相对于 `meiji/server/prompts/interfaces/`：

| 接口 | 文件 |
|---|---|
| 剧集摘要 | `episode.js` |
| 剧情整包、人物卡与场景卡的文字生成/修订 | `outline.js`（调用方传入各自的任务上下文） |
| 镜头表 | `shots.js` |
| 单镜修订 | `shot-revise.js` |
| 每秒指令（整集与单镜） | `seconds.js` |
| 文本分镜 | `storyboard.js` |
| 图片提示词改写 | `image-prompt.js` |
| 人物图 | `character-image.js` |
| 场景图 | `scene-image.js` |
| 附属素材图 | `part-image.js` |
| 铅笔分镜图 | `pencil.js` |
| 最终视频提交 | `video.js` |

`registry.js` 只分发已注册的接口，不为未知接口套默认模板。七个文本模块分别提供 `generate`、`review`、`revise`；人工意见修改使用本接口 `generate` 的 modify 分支。

## 文本结构

文本接口返回 `{ system: 分段数组, user: 分段数组, json: 布尔值 }`。例如在单个接口中自行调整：

```js
return {
  json: false,
  system: [p.generate, p.protocol],
  user: [p.context, p.opinion, p.language],
}
```

这个接口将任务语言放在 user 中，且不选其他片段；不会影响其他接口。也可以使用 `segment('context', '自定义标题', 自定义文本)`，标题传空字符串则不加标题。`system: []` 表示只发 user；修改输出格式仍需满足本阶段的解析和审核协议。

`generationParts`、`reviewParts` 提供技能片段（生产规则或审核标准、本节点补充、指导素材、语言、协议），不含任务资料和意见；请求的最终顺序统一由 `request.js` 的 `generationRequest` / `reviewRequest` 组装。任务资料以 `{ task, review, facts }` 传入（`taskInput` 也接受纯任务文本），本次生成要求由 `requirementSegment` 单独成段，基稿与意见由 `baseSegments` 按生成/修订/审核生成。不应改成直接读取内置 Markdown 而绕过任务固定的技能快照。

## 图片和视频

图片接口返回 prompt 分段数组，可以单独移动、改标题或替换片段。场景图、附属图、铅笔图可以选用 `imageParts` 提供的材料。

人物图的完整专属编排集中在 `character-image.js`，不经过通用 `imageParts`：

- `characterStillPrompt`：明确选择国籍、姓名、身份、性别、年代、年龄、身高、体型与面相，排除剧情服装、道具和旧面向指令。底层字段解析仍复用 `shared/character-facts.js`。
- `adultCharacter`：年龄判断，用于选择固定文件里的适用分节；约束正文不再写在 JS 中。
- `generate`：从当前任务技能快照读取固定约束，选择通用和适用年龄分节，组装语言、画风、人物资料和人工意见；不读取旧的基础 generate 覆盖或本剧补充。
- `characterImagePrompt`：实际生成入口，渲染同一份段落。传入人物卡与项目即可，不在调用方再拼接。
- `preview`：有剧集人物时使用第一张人物卡，复用 `generate`；没有人物时明确标注为模板预览。

看人物图「如何组装」只看这个 JS；人物图的固定约束唯一来源是 `skills/task/generate-character-image-skill.md`，原 generate.md 已移除。该文件可以为空，表示不添加约束，JS 不补默认约束。页面只读，修改约束须编辑源码文件后重启。参考图读取/上传、尺寸、网络请求和结果保存继续由共用执行层负责。

视频的最终正文、成片技能补充、人工意见和上一镜尾帧衔接都在 `video.js` 组装；流程层负责参考图和模式参数。网络层按接口产出的 prompt 发送。

## 预览与生效

技能详情页预览调用同一组接口模块。人物图在有当前剧集资料时预览第一张人物卡，年龄约束与实际生成一致；没有人物时仅展示明确标记的模板。其他图片与视频缺少具体生成对象时使用上下文占位符；实际某次发送的内容仍以 API 日志为准。

各接口结构已独立，后续只需编辑目标接口模块；固定约束正文则编辑对应的 skills/constraints 文件。空约束只省略约束段，人物资料、画风、语言和人工意见仍按该接口定义发送。

修改 JavaScript 后需重启 Harness；这次没有实现文件热更新：

```bash
bash /Users/devin/meiji/llm-dsh-plugins/restart-harness.sh
```

验证：`cd meiji && npm test`，并使用 `tests/fixtures/prompt-scenarios.js` 与 `scripts/prompt-diff.js` 对照改动前后提示词，核对预览与真实发送保持一致。

当前约定：每个 AI 步骤的接口只给对应 Model 赋值并调用方法。Model 区分生成、审核、修订，三类共用同一功能基础生产规则。旧通用、审核、修订、共享与指导 skill 已移除。

## 镜头表与每秒指令的资料顺序

与摘要、大纲同一分区：角色只写身份；【本次任务】只写依据与动作（如「依据大纲生成本集完整镜头表，遵守基础规则和补充规则。」），修订时换为「依据…和本轮自审意见/本次修改意见修订…」；具体约束在【基础规则】，格式只在【本次输出协议】。

| 步骤 | user 资料顺序 |
|---|---|
| 镜头表 | 【核心输入：大纲】→【本次参数】（本集时长与 ±10 秒范围、项目风格）→ 人物/场景/道具卡 →【实体引用清单】 |
| 整集每秒指令 | 【核心输入：已通过镜头表】→【本次参数】（镜头清单、总秒数、项目风格）→ 卡片 →【参考：大纲】→【实体引用清单】 |
| 单镜每秒指令 | 【核心输入：本镜镜头表】→【本次参数】（本镜 ID 与时长）→【衔接：前镜/后镜/相邻镜头每秒指令】→ 本镜及前后镜关联卡片 →【参考：大纲】→【实体引用清单】 |

实体引用清单按人物、场景、道具、服装、人物附属分组，正文写作「名字【名字|ID】」（镜头表「标题：」行不加）。
