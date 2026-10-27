# 人物提取 Skills

本目录已接入本盒子的按需读取工具循环。每阶段首轮只提供skill元数据和资料索引，具体正文由模型选择读取。

来源：[项目规则初始化来源](../../../../skills/character_extraction.json)。原JSON继续初始化项目规则；任务快照中的定制基础规则和有效补充规则通过工具提供，优先于默认主题。

按本次处理主题选择对应skill；同一盒子内相同规则段合并，生成、审核、修订的差异分别标注。读取目录不代表需要加载全部正文。

| Skill | 适用情况 | 适用动作 |
|---|---|---|
| [定妆与服装连续性](drama-character-extraction-wardrobe-continuity/SKILL.md) | 选择或延续人物服装、定妆关联及跨段穿着 | 生成、审核、修订 |
| [个人服装补全](drama-character-extraction-costume-design/SKILL.md) | 设计必要个人服装并处理显示名称、描述和适用段 | 生成、审核、修订 |
| [个人与团队关联](drama-character-extraction-group-reference/SKILL.md) | 区分个人服装与团队制服，处理真实团队归属 | 生成、审核、修订 |
| [生成人物提取](drama-character-extraction-generate/SKILL.md) | 对人物提取执行生成，核对该动作的处理步骤和返回范围 | 生成 |
| [人物形象与资料边界](drama-character-extraction-character-design/SKILL.md) | 提取人物身份、稳定外貌、服装与上游引用 | 生成、审核、修订 |
| [字段处理方法](drama-character-extraction-field-mapping/SKILL.md) | 将本盒子的业务资料映射到现有字段并检查引用 | 生成、审核、修订 |
| [现有输出契约引用](drama-character-extraction-output-contract/SKILL.md) | 查阅当前动作的输出定义引用；字段结构以既有运行时定义为准 | 生成、修订、审核 |
| [审核人物提取](drama-character-extraction-review/SKILL.md) | 对人物提取执行审核，核对该动作的处理步骤和返回范围 | 审核 |
| [修订人物提取](drama-character-extraction-revise/SKILL.md) | 对人物提取执行修订，核对该动作的处理步骤和返回范围 | 修订 |

输出契约skill保留当前引用用于追溯；具体字段仍由本盒子definition与共享契约维护。原JSON中的supports_supplement及项目补充规则属于既有规则存储机制，本目录不迁移或覆盖。
