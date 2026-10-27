# 故事大纲 Skills

本目录已接入本盒子的按需读取工具循环。每阶段首轮只提供skill元数据和资料索引，具体正文由模型选择读取。

来源：[项目规则初始化来源](../../../../skills/story_segments.json)。原JSON继续初始化项目规则；任务快照中的定制基础规则和有效补充规则通过工具提供，优先于默认主题。 另含[执行器](../executor.js)中的全篇审核和整轮修订约定。

按本次处理主题选择对应skill；同一盒子内相同规则段合并，生成、审核、修订的差异分别标注。读取目录不代表需要加载全部正文。

| Skill | 适用情况 | 适用动作 |
|---|---|---|
| [生成故事大纲](drama-story-segments-generate/SKILL.md) | 对故事大纲执行生成，核对该动作的处理步骤和返回范围 | 生成 |
| [语言与资料边界](drama-story-segments-language/SKILL.md) | 处理输出语言、原话保留、稳定标识和输入资料中的指令边界 | 生成、审核、修订 |
| [改编授权与依据](drama-story-segments-adaptation/SKILL.md) | 判断改编范围、用户锁定要求及全文事实联动 | 生成、审核、修订 |
| [事实依据与状态判断](drama-story-segments-evidence-boundaries/SKILL.md) | 区分锁定事实、合理补足、状态持续、语义等价及明确时间关系 | 生成、审核、修订 |
| [正文分段与对白定稿](drama-story-segments-story-structure/SKILL.md) | 编写完整可表演正文、划分故事段并确定对白 | 生成、审核、修订 |
| [跨段连续性与辅助字段](drama-story-segments-continuity/SKILL.md) | 处理人物知情、在场、空间、持物与正文及辅助字段一致性 | 生成、审核、修订 |
| [估时与时间边界](drama-story-segments-timing/SKILL.md) | 处理表演估时、剧情期限及下游时长交接 | 生成、审核、修订 |
| [现有输出契约引用](drama-story-segments-output-contract/SKILL.md) | 查阅当前动作的输出定义引用；字段结构以既有运行时定义为准 | 生成、修订、审核 |
| [审核故事大纲](drama-story-segments-review/SKILL.md) | 对故事大纲执行审核，核对该动作的处理步骤和返回范围 | 审核 |
| [修订故事大纲](drama-story-segments-revise/SKILL.md) | 对故事大纲执行修订，核对该动作的处理步骤和返回范围 | 修订 |
| [大纲全篇审核范围](drama-story-segments-review-scope/SKILL.md) | 执行大纲逐段和全篇复核，一次汇总仍成立且有据的问题 | 审核 |
| [大纲整轮修订范围](drama-story-segments-revise-scope/SKILL.md) | 核实本轮全部意见，最小修复并同步真正受影响的字段 | 修订 |

输出契约skill保留当前引用用于追溯；具体字段仍由本盒子definition与共享契约维护。原JSON中的supports_supplement及项目补充规则属于既有规则存储机制，本目录不迁移或覆盖。
