# 人物定妆照 Skills

本目录整理本盒子的业务规则，供后续上下文与按需读取机制设计使用；当前尚未接入提示词或执行器。

来源：[当前运行规则](../../../../skills/costume_image.json)。现有运行链及项目内已保存规则保持不变。

按本次处理主题选择对应skill；同一盒子内相同规则段合并，生成、审核、修订的差异分别标注。读取目录不代表需要加载全部正文。

| Skill | 适用情况 | 适用动作 |
|---|---|---|
| [人物团队形象与服装沿用](drama-costume-image-asset-identity/SKILL.md) | 落实真实人物、团队、制服版本与个人差异，保留已确认形象 | 生成、审核、修订 |
| [生成人物定妆照](drama-costume-image-generate/SKILL.md) | 对人物定妆照执行生成，核对该动作的处理步骤和返回范围 | 生成 |
| [语言与资料边界](drama-costume-image-language/SKILL.md) | 处理输出语言、原话保留、稳定标识和输入资料中的指令边界 | 生成、审核、修订 |
| [参考图构图与视觉设计](drama-costume-image-visual-design/SKILL.md) | 根据已确认身份或固定环境安排单幅参考图的内容、构图和画幅 | 生成、审核、修订 |
| [现有输出契约引用](drama-costume-image-output-contract/SKILL.md) | 查阅当前动作的输出定义引用；字段结构以既有运行时定义为准 | 生成、修订、审核 |
| [审核人物定妆照](drama-costume-image-review/SKILL.md) | 对人物定妆照执行审核，核对该动作的处理步骤和返回范围 | 审核 |
| [修订人物定妆照](drama-costume-image-revise/SKILL.md) | 对人物定妆照执行修订，核对该动作的处理步骤和返回范围 | 修订 |

输出契约skill保留当前引用用于追溯；具体字段仍由本盒子definition与共享契约维护。原JSON中的supports_supplement及项目补充规则属于既有规则存储机制，本目录不迁移或覆盖。
