# 分镜设计 Skills

本目录已接入本盒子的按需读取工具循环。每阶段首轮只提供skill元数据和资料索引，具体正文由模型选择读取。

来源：[项目规则初始化来源](../../../../skills/shot_design.json)。原JSON继续初始化项目规则；任务快照中的定制基础规则和有效补充规则通过工具提供，优先于默认主题。

按本次处理主题选择对应skill；同一盒子内相同规则段合并，生成、审核、修订的差异分别标注。读取目录不代表需要加载全部正文。

| Skill | 适用情况 | 适用动作 |
|---|---|---|
| [定妆与服装连续性](drama-shot-design-wardrobe-continuity/SKILL.md) | 选择或延续人物服装、定妆关联及跨段穿着 | 生成、审核、修订 |
| [群众与团队引用](drama-shot-design-crowd-reference/SKILL.md) | 处理普通群众、统一着装团队及临时镜头状态 | 生成、审核、修订 |
| [人物与团队资产引用](drama-shot-design-asset-reference/SKILL.md) | 落实已确认团队、人物和服装版本的真实关联 | 生成、修订 |
| [生成分镜设计](drama-shot-design-generate/SKILL.md) | 对分镜设计执行生成，核对该动作的处理步骤和返回范围 | 生成 |
| [语言与资料边界](drama-shot-design-language/SKILL.md) | 处理输出语言、原话保留、稳定标识和输入资料中的指令边界 | 生成、修订 |
| [输入依据与职责边界](drama-shot-design-source-boundaries/SKILL.md) | 判断本盒子采用的资料、允许设计范围和上下游职责 | 生成、修订 |
| [镜头起点与连续摄影](drama-shot-design-shot-continuity/SKILL.md) | 划分背景区域、设置开场状态并保持连续动作与镜头衔接 | 生成、修订 |
| [节拍表演与声画充分性](drama-shot-design-performance/SKILL.md) | 设计动作反应、摄影、声音及可见可听的剧情落实 | 生成、修订 |
| [估时与时间边界](drama-shot-design-timing/SKILL.md) | 处理表演估时、剧情期限及下游时长交接 | 生成、修订 |
| [输出修复边界](drama-shot-design-output-repair/SKILL.md) | 按明确校验错误修复分镜输出，保留有效剧情和引用 | 生成、修订 |
| [现有输出契约引用](drama-shot-design-output-contract/SKILL.md) | 查阅当前动作的输出定义引用；字段结构以既有运行时定义为准 | 生成、修订、审核 |
| [审核分镜设计](drama-shot-design-review/SKILL.md) | 对分镜设计执行审核，核对该动作的处理步骤和返回范围 | 审核 |
| [修订分镜设计](drama-shot-design-revise/SKILL.md) | 对分镜设计执行修订，核对该动作的处理步骤和返回范围 | 修订 |

输出契约skill保留当前引用用于追溯；具体字段仍由本盒子definition与共享契约维护。原JSON中的supports_supplement及项目补充规则属于既有规则存储机制，本目录不迁移或覆盖。
