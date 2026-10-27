# 场景提取 Skills

本目录已接入本盒子的按需读取工具循环。每阶段首轮只提供skill元数据和资料索引，具体正文由模型选择读取。

来源：[项目规则初始化来源](../../../../skills/scene_extraction.json)。原JSON继续初始化项目规则；任务快照中的定制基础规则和有效补充规则通过工具提供，优先于默认主题。

按本次处理主题选择对应skill；同一盒子内相同规则段合并，生成、审核、修订的差异分别标注。读取目录不代表需要加载全部正文。

| Skill | 适用情况 | 适用动作 |
|---|---|---|
| [生成场景提取](drama-scene-extraction-generate/SKILL.md) | 对场景提取执行生成，核对该动作的处理步骤和返回范围 | 生成 |
| [输入依据与职责边界](drama-scene-extraction-source-boundaries/SKILL.md) | 判断本盒子采用的资料、允许设计范围和上下游职责 | 生成、审核、修订 |
| [场景收录与归并](drama-scene-extraction-scene-scope/SKILL.md) | 判断场景复用范围、同址归并、稳定ID及合法空集合 | 生成、审核、修订 |
| [空间设计与事实强度](drama-scene-extraction-spatial-design/SKILL.md) | 补齐固定空间并核对布局、路线、出入口和未经支持的强约束 | 生成、审核、修订 |
| [字段处理方法](drama-scene-extraction-field-mapping/SKILL.md) | 将本盒子的业务资料映射到现有字段并检查引用 | 生成、审核、修订 |
| [现有输出契约引用](drama-scene-extraction-output-contract/SKILL.md) | 查阅当前动作的输出定义引用；字段结构以既有运行时定义为准 | 生成、修订、审核 |
| [审核场景提取](drama-scene-extraction-review/SKILL.md) | 对场景提取执行审核，核对该动作的处理步骤和返回范围 | 审核 |
| [修订场景提取](drama-scene-extraction-revise/SKILL.md) | 对场景提取执行修订，核对该动作的处理步骤和返回范围 | 修订 |

输出契约skill保留当前引用用于追溯；具体字段仍由本盒子definition与共享契约维护。原JSON中的supports_supplement及项目补充规则属于既有规则存储机制，本目录不迁移或覆盖。
