# 技能（skills）

提交给生成、修订、审核模型的内置正文统一存放在 `constraints/`，旧的顶层 stages/guidance/shared 目录已移除。生成流程的技能由代码按字段直接读取（`load.js`），不经 Harness。只有 `agent/panel.md` 注册给 Harness，供会话 agent 使用。

## 目录

```
skills/
├── load.js              # 读取与结构校验：builtinSkill、agentSkills、validateSkills
├── constraints/stages/<id>/         # 阶段技能：skill.json + common / generate / review / revise（可编辑）+ protocol（只读）
├── constraints/episode.md  # 摘要固定约束：参考时长 ±20 秒、最多 300 字与跨集因果
├── constraints/character/generate-character-image.md  # 人物固定约束，只读，允许空正文
├── constraints/scene/generate-scene-image.md  # 场景生成正文，沿用 generate 字段的编辑语义
├── constraints/guidance/<id>/       # 指导技能：skill.json + common / review + stages/<阶段>.md（本阶段落点）
├── constraints/shared/<id>.md       # 共享模块：多个阶段引用的一段正文
└── agent/panel.md       # 会话说明（带 frontmatter，唯一注册给 Harness 的技能）
```

## 阶段技能

| ID | 名称 | 输出 | 面板入口 |
|---|---|---|---|
| `episode` | 剧集摘要 | JSON | 技能库 |
| `outline` | 剧情整包（大纲、人物卡、场景卡） | JSON | 剧情 |
| `shots` | 镜头表 | 自由文本 | 镜头表 |
| `shot-revise` | 单镜修订 | 自由文本 | 镜头表（相关技能） |
| `seconds` | 每秒指令 | 自由文本 | 每秒指令 |
| `storyboard` | 文本分镜 | 自由文本 | 文本分镜 / 成片 |
| `video` | 成片（内置为空；基础与本剧补充追加在最终视频提示词后） | 视频 | 成片 |
| `image-prompt` | 图片提示词改写 | 文本 | 技能库 |
| `character-image` / `scene-image` / `part-image` / `pencil` | 人物、场景、附属素材、铅笔分镜图片 | 图片接口 | 技能库 |

字段：

| 字段 | 内容 | 用在 |
|---|---|---|
| `common` | 身份、输入说明、领域规则 | 生成、意见修改、自动修订 |
| `generate` | 写法与步骤 | 同上；场景、附属素材与铅笔图仍使用此字段，人物图与剧集摘要改用固定约束 |
| `review` | 验收标准 | 生成时作为自检标准；独立审核时作为验收标准 |
| `revise` | 修订边界 | 意见修改（与自检标准并存）、自动修订（替换自检标准） |
| `protocol` | 程序解析依赖的输出格式 | 所有生成类请求的输出协议；只读，面板不能修改 |

`skill.json`：`id`、`kind: "stage"`、`label`、`logLabel`（会话日志用途）、`output`（json / text / image / video）、`languageMode`（`story` 时使用剧情阶段的语言说明）、`panel`（流程页入口）、`guidanceStage`（指导技能的阶段落点）、`assetStages`（读取哪些阶段选择的指导素材）、`shared`（按字段引用共享模块：`common`、`review`、`revise`）、`related`、`fields`、`order`、`fixedConstraints`。阶段目录的 md 文件必须与 `fields` 一致，多余或缺少都会在 `validateSkills` 报错。

## 固定约束

固定约束集中在 `constraints/`，文件只放约束正文，不在 JS 或可编辑技能里保存副本。目前 `character-image` 登记 `fixedConstraints: true`、`fields: []`，读取 `constraints/character/generate-character-image.md`，不再有 `stages/character-image/generate.md`。

- 空文件（包括仅空白）有效，表示请求不添加固定约束；缺文件报错。
- 页面只读显示，不能编辑或恢复；旧的人物图基础修改与本剧 generate 补充不进入新请求，原存储文件不删除。
- 约束随技能组合固定到任务中，记录内容哈希；直接修改源码文件后重启生效。
- 人物图支持 `## 通用`、`## 成年人物`、`## 未成年或年龄不明` 三个分节。实际请求读取通用与适用年龄分节；无人物的模板预览展示全文。没有这些分节的普通文本原样使用。
- 其他步骤以后按需显式启用，不自动注入人物约束。只有约束的步骤不需要 generate.md。

剧集摘要也启用 `fixedConstraints: true`，保留 common/review/revise/protocol，删除 generate 字段和文件。`EpisodeSummaryModel` 只包含本次视频资料、目标集与参考时长、前后集摘要、约束及明确修改基稿；`episode-prompts.js` 读取技能快照，接口选择角色片段，预览共用实际组装路径。

## 指导技能

| ID | 名称 | 默认 | 素材分类 |
|---|---|---|---|
| `guidance-action` | 动作指导 | 启用 | 动作、特效 |
| `guidance-martial` | 武术指导 | 本剧开启 | 武术 |
| `guidance-dialogue` | 台词指导 | 启用 | 对白 |
| `guidance-expression` | 表情指导 | 启用 | 表情 |
| `guidance-sound` | 声音指导 | 启用 | 声音、配乐 |

`skill.json` 的 `stages` 登记剧情整包、镜头表、每秒指令、文本分镜四个阶段的落点名称，每个落点对应 `stages/<阶段>.md`。指导技能只细化上游已有的事件、人物与对白，不新增事件或改变结果；摘要与图片请求不使用指导技能。

## 共享模块

`review-protocol`（审核通用协议，所有审核）、`camera-review`（镜头类审核：镜头表、单镜修订、每秒指令、文本分镜）、`tail-frame`（尾帧协议：文本分镜的通用与审核）、`revise-boundary`（修订边界：剧情整包、镜头表、每秒指令、文本分镜）、`language`（语言，所有文本请求）、`language-revise`（修订时的语言，意见修改与自动修订）。

## 三层与组装

- 内置：本目录，随插件更新，只读。
- 基础：面板「查看 skill」中编辑保存，存于 `$DSH_HOME/storages/meiji/skills/<id>.json`，按字段替换内置，对所有剧生效；可恢复内置、撤回上一版，内置更新后提示对比。
- 本剧：项目索引 `skills`（本剧补充、启用的指导、各阶段指导素材），追加在对应字段之后，只对本剧生效。

组装规则、优先级与请求结构见 `meiji/docs/tasks-and-steps.md`「提示词与请求」。任务开始时固定技能组合版本，同一任务内的生成、审核、修订一致，任务记录写入所用技能与层。

场景图的内置 generate 正文读取 `constraints/scene/generate-scene-image.md`，基础覆盖与本剧补充语义保持原样。人物修改接口把实际年龄适用的固定约束赋给提示词 model。

## 节点补充

摘要、大纲、人物、场景入口管理当前集当前节点的 `supplementalSkills`，基础正文只读。任务固定本轮 skill，实际提示词保存在步骤历史。旧项目停服后用 `node meiji/scripts/migrate-node-skills.js <DSH_HOME>` 备份迁移；新剧集不继承旧集补充。其他阶段的入口后续按同样规则调整。
