# 视频提示词 Skills

本目录整理本盒子的业务规则，供后续上下文与按需读取机制设计使用；当前尚未接入提示词或执行器。

来源：[当前运行规则](../../../../skills/video_prompt.json)。现有运行链及项目内已保存规则保持不变。

按本次处理主题选择对应skill；同一盒子内相同规则段合并，生成、审核、修订的差异分别标注。读取目录不代表需要加载全部正文。

| Skill | 适用情况 | 适用动作 |
|---|---|---|
| [人物团队形象与服装沿用](drama-video-prompt-asset-identity/SKILL.md) | 落实真实人物、团队、制服版本与个人差异，保留已确认形象 | 生成、审核、修订 |
| [生成视频提示词](drama-video-prompt-generate/SKILL.md) | 对视频提示词执行生成，核对该动作的处理步骤和返回范围 | 生成 |
| [语言与资料边界](drama-video-prompt-language/SKILL.md) | 处理输出语言、原话保留、稳定标识和输入资料中的指令边界 | 生成、审核、修订 |
| [分片起点与累积状态](drama-video-prompt-state-progression/SKILL.md) | 从镜头开场推进到当前分片，承接已发生动作、持物和声音进度 | 生成、审核、修订 |
| [分片声画转译](drama-video-prompt-audiovisual/SKILL.md) | 把选定节拍转为具体连续声画并保留定稿对白和有效细节 | 生成、审核、修订 |
| [摄影声音与生成模式](drama-video-prompt-camera-audio/SKILL.md) | 处理真实切镜、声音时序、画外状态和所选生成模式 | 生成、审核、修订 |
| [现有输出契约引用](drama-video-prompt-output-contract/SKILL.md) | 查阅当前动作的输出定义引用；字段结构以既有运行时定义为准 | 生成、修订、审核 |
| [审核视频提示词](drama-video-prompt-review/SKILL.md) | 对视频提示词执行审核，核对该动作的处理步骤和返回范围 | 审核 |
| [修订视频提示词](drama-video-prompt-revise/SKILL.md) | 对视频提示词执行修订，核对该动作的处理步骤和返回范围 | 修订 |

输出契约skill保留当前引用用于追溯；具体字段仍由本盒子definition与共享契约维护。原JSON中的supports_supplement及项目补充规则属于既有规则存储机制，本目录不迁移或覆盖。
