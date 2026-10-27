# 剧本优化 Skills

本目录已接入本盒子的按需读取工具循环。每阶段首轮只提供skill元数据和资料索引，具体正文由模型选择读取。

来源：[项目规则初始化来源](../../../../skills/script_revision.json)。原JSON继续初始化项目规则；任务快照中的定制基础规则和有效补充规则通过工具提供，优先于默认主题。

按本次处理主题选择对应skill；同一盒子内相同规则段合并，生成、审核、修订的差异分别标注。读取目录不代表需要加载全部正文。

| Skill | 适用情况 | 适用动作 |
|---|---|---|
| [生成剧本优化](drama-script-revision-generate/SKILL.md) | 对剧本优化执行生成，核对该动作的处理步骤和返回范围 | 生成 |
| [语言与资料边界](drama-script-revision-language/SKILL.md) | 处理输出语言、原话保留、稳定标识和输入资料中的指令边界 | 生成、审核、修订 |
| [改编授权与依据](drama-script-revision-adaptation/SKILL.md) | 判断改编范围、用户锁定要求及全文事实联动 | 生成、审核、修订 |
| [现有输出契约引用](drama-script-revision-output-contract/SKILL.md) | 查阅当前动作的输出定义引用；字段结构以既有运行时定义为准 | 生成、修订、审核 |
| [审核剧本优化](drama-script-revision-review/SKILL.md) | 对剧本优化执行审核，核对该动作的处理步骤和返回范围 | 审核 |
| [修订剧本优化](drama-script-revision-revise/SKILL.md) | 对剧本优化执行修订，核对该动作的处理步骤和返回范围 | 修订 |

输出契约skill保留当前引用用于追溯；具体字段仍由本盒子definition与共享契约维护。原JSON中的supports_supplement及项目补充规则属于既有规则存储机制，本目录不迁移或覆盖。
