# 盒子本地 Skills 实施记录

计划：[1027-计划-盒子本地Skills.md](../plans/1027-计划-盒子本地Skills.md)。

## 已修改文件

- `projects/drama/src/node_box/<盒子>/skills/<skill名称>/SKILL.md`：新建79份按主题与动作拆分的规则。
- 每个上述盒子的 `skills/index.md`：新建10份索引，列出适用情况、动作和原始来源，明确尚未接入提示词。
- `projects/drama/AGENTS.md`、`projects/drama/docs/开发方向.md`：补充目录职责、各盒子入口及待接入边界。
- 对应计划与本实施记录。

| 盒子 | Skill数 | 主要主题 |
|---|---:|---|
| character_extraction | 9 | 人物、个人服装、定妆沿用、团队关联 |
| costume_image | 7 | 人物与团队形象、定妆照构图 |
| group_setting | 8 | 团队收录、形象与制服 |
| project | 1 | 原稿摘要与估时 |
| scene_extraction | 8 | 场景收录归并、空间设计、字段处理 |
| scene_image | 6 | 无人空间参考图、构图 |
| script_revision | 6 | 改编依据、语言与三动作 |
| shot_design | 13 | 服装、群众、资产、连续摄影、节拍声画、估时 |
| story_segments | 12 | 改编、依据边界、分段对白、连续性、全篇审核 |
| video_prompt | 9 | 形象沿用、分片起点、状态累积、声画与模式 |

业务索引集中链接于[开发方向](../../projects/drama/docs/开发方向.md)的“盒子本地Skills”。没有AI规则的程序盒子不创建占位目录。

## 验收标准核对

| AC | 状态 | 证据 |
|---|---|---|
| AC-1 | 通过 | 10盒子、79份带name/description的独立SKILL.md，名称唯一且与目录名一致 |
| AC-2 | 通过 | 27动作的198处原规则段逐段检查，全部保留且盒子内只归入一份skill；9份来源JSON SHA-256未变化 |
| AC-3 | 通过 | 大纲全篇审核、整轮修订及项目摘要规则已整理；动态段数/ID/语言参数显式说明，归一化后原文覆盖通过 |
| AC-4 | 通过 | 运行代码、原规则JSON、已保存项目无改动；目录和开发文档均标记待接入 |
| AC-5 | 通过 | 10份主题索引，149个本地链接检查通过，输出Schema仅链接既有definition/共享契约 |

## 验证

- 使用skill-creator的quick_validate逐份验证79个skill，全部通过。系统和内置Python均缺PyYAML，因此仅在/tmp安装校验依赖，未改项目依赖。
- 规则覆盖、源文件SHA-256、动态参数归一化、目录名称、链接和代码未变检查通过。验证结果：`/tmp/drama-box-skills-validation.json`；来源映射：`/tmp/drama-box-skills-coverage.json`；临时文件仅作本次检查证据。
- 范围收窄前运行drama基线313通过、0失败、0取消。最终仅新增/修改Markdown，不重复业务测试，不新增真实模型调用。
- git diff --check通过。
- detect-changes报告2份既有文档、1个Section及736个宽泛关联流程，risk critical；不修改这些流程的代码。该报告未覆盖新增未跟踪Markdown，已通过逐文件检查补充，不声称图谱零影响或完整覆盖。
- 图谱收尾：`node .gitnexus/run.cjs analyze --index-only`成功，增量纳入91份新Markdown及2份既有文档变化，耗时7.5秒；随后status为up-to-date，runnerIdentityStatus为current，incompleteReasons为空。日志仍提示调用候选上限与流程遍历预算截断，不能将738条流程视为所有真实流程；未为这些已有分析边界修改业务代码。状态回填文档后不重复刷新代码图谱。

## 人工待办

本次范围内无。提示词接入、模型按需读取、上下文记忆和原规则来源切换由后续设计处理。
