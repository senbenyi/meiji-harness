# 提示词差集报告

## 字数（改造前 → 改造后）

| 场景 | 请求 | 角色 | 改造前 | 改造后 | 变化 |
|---|---|---|---:|---:|---:|
| episode:regenerate | generation | system | 1120 | 1167 | 47 |
| episode:regenerate | generation | user | 316 | 316 | 0 |
| episode:regenerate | review | system | 1870 | 1871 | 1 |
| episode:regenerate | review | user | 337 | 337 | 0 |
| episode:regenerate | revision | system | 1365 | 1412 | 47 |
| episode:regenerate | revision | user | 366 | 366 | 0 |
| outline:regenerate | generation | system | 3281 | 3326 | 45 |
| outline:regenerate | generation | user | 374 | 374 | 0 |
| outline:regenerate | review | system | 2059 | 2238 | 179 |
| outline:regenerate | review | user | 362 | 362 | 0 |
| outline:regenerate | revision | system | 3989 | 4034 | 45 |
| outline:regenerate | revision | user | 401 | 401 | 0 |
| characters:regenerate | generation | system | 2941 | 2949 | 8 |
| characters:regenerate | generation | user | 321 | 321 | 0 |
| characters:regenerate | review | system | 2012 | 1854 | -158 |
| characters:regenerate | review | user | 319 | 319 | 0 |
| characters:regenerate | revision | system | 3649 | 3657 | 8 |
| characters:regenerate | revision | user | 358 | 358 | 0 |
| scenes:regenerate | generation | system | 2030 | 2038 | 8 |
| scenes:regenerate | generation | user | 321 | 321 | 0 |
| scenes:regenerate | review | system | 1510 | 1510 | 0 |
| scenes:regenerate | review | user | 319 | 319 | 0 |
| scenes:regenerate | revision | system | 2738 | 2746 | 8 |
| scenes:regenerate | revision | user | 358 | 358 | 0 |
| shots:regenerate | generation | system | 7209 | 7217 | 8 |
| shots:regenerate | generation | user | 792 | 792 | 0 |
| shots:regenerate | review | system | 4584 | 4584 | 0 |
| shots:regenerate | review | user | 1791 | 1791 | 0 |
| shots:regenerate | revision | system | 6756 | 6764 | 8 |
| shots:regenerate | revision | user | 888 | 888 | 0 |
| seconds-all:regenerate | generation | system | 8807 | 8815 | 8 |
| seconds-all:regenerate | generation | user | 917 | 917 | 0 |
| seconds-all:regenerate | review | system | 4584 | 4584 | 0 |
| seconds-all:regenerate | review | user | 1857 | 1857 | 0 |
| seconds-all:regenerate | revision | system | 8488 | 8496 | 8 |
| seconds-all:regenerate | revision | user | 1013 | 1013 | 0 |
| seconds-shot:regenerate | generation | system | 8807 | 8815 | 8 |
| seconds-shot:regenerate | generation | user | 651 | 651 | 0 |
| seconds-shot:regenerate | review | system | 4584 | 4584 | 0 |
| seconds-shot:regenerate | review | user | 1591 | 1591 | 0 |
| seconds-shot:regenerate | revision | system | 8488 | 8496 | 8 |
| seconds-shot:regenerate | revision | user | 747 | 747 | 0 |
| shot-revise:regenerate | generation | system | 3728 | 3736 | 8 |
| shot-revise:regenerate | generation | user | 591 | 591 | 0 |
| shot-revise:regenerate | review | system | 4584 | 4584 | 0 |
| shot-revise:regenerate | review | user | 1425 | 1425 | 0 |
| shot-revise:regenerate | revision | system | 3188 | 3196 | 8 |
| shot-revise:regenerate | revision | user | 687 | 687 | 0 |
| storyboard-text:regenerate | generation | system | 16405 | 16413 | 8 |
| storyboard-text:regenerate | generation | user | 1099 | 1099 | 0 |
| storyboard-text:regenerate | review | system | 5027 | 5027 | 0 |
| storyboard-text:regenerate | review | user | 4057 | 4057 | 0 |
| storyboard-text:regenerate | revision | system | 14354 | 14362 | 8 |
| storyboard-text:regenerate | revision | user | 1195 | 1195 | 0 |
| storyboard-reference:regenerate | generation | system | 16405 | 16413 | 8 |
| storyboard-reference:regenerate | generation | user | 1117 | 1117 | 0 |
| storyboard-reference:regenerate | review | system | 5027 | 5027 | 0 |
| storyboard-reference:regenerate | review | user | 4192 | 4192 | 0 |
| storyboard-reference:regenerate | revision | system | 14354 | 14362 | 8 |
| storyboard-reference:regenerate | revision | user | 1213 | 1213 | 0 |
| episode:modify | generation | system | 1365 | 1412 | 47 |
| episode:modify | generation | user | 373 | 373 | 0 |
| episode:modify | review | system | 1879 | 1880 | 1 |
| episode:modify | review | user | 399 | 399 | 0 |
| episode:modify | revision | system | 1365 | 1412 | 47 |
| episode:modify | revision | user | 383 | 383 | 0 |
| outline:modify | generation | system | 3989 | 4034 | 45 |
| outline:modify | generation | user | 419 | 419 | 0 |
| outline:modify | review | system | 2069 | 2248 | 179 |
| outline:modify | review | user | 445 | 445 | 0 |
| outline:modify | revision | system | 3989 | 4034 | 45 |
| outline:modify | revision | user | 438 | 438 | 0 |
| characters:modify | generation | system | 3649 | 3657 | 8 |
| characters:modify | generation | user | 1998 | 1998 | 0 |
| characters:modify | review | system | 2022 | 1864 | -158 |
| characters:modify | review | user | 2024 | 2024 | 0 |
| characters:modify | revision | system | 3649 | 3657 | 8 |
| characters:modify | revision | user | 375 | 375 | 0 |
| scenes:modify | generation | system | 2738 | 2746 | 8 |
| scenes:modify | generation | user | 1929 | 1929 | 0 |
| scenes:modify | review | system | 1520 | 1520 | 0 |
| scenes:modify | review | user | 1955 | 1955 | 0 |
| scenes:modify | revision | system | 2738 | 2746 | 8 |
| scenes:modify | revision | user | 375 | 375 | 0 |
| shots:modify | generation | system | 7700 | 7708 | 8 |
| shots:modify | generation | user | 891 | 891 | 0 |
| shots:modify | review | system | 4584 | 4584 | 0 |
| shots:modify | review | user | 1808 | 1808 | 0 |
| shots:modify | revision | system | 6756 | 6764 | 8 |
| shots:modify | revision | user | 905 | 905 | 0 |
| seconds-all:modify | generation | system | 9373 | 9381 | 8 |
| seconds-all:modify | generation | user | 997 | 997 | 0 |
| seconds-all:modify | review | system | 4584 | 4584 | 0 |
| seconds-all:modify | review | user | 1874 | 1874 | 0 |
| seconds-all:modify | revision | system | 8488 | 8496 | 8 |
| seconds-all:modify | revision | user | 1030 | 1030 | 0 |
| seconds-shot:modify | generation | system | 9373 | 9381 | 8 |
| seconds-shot:modify | generation | user | 728 | 728 | 0 |
| seconds-shot:modify | review | system | 4584 | 4584 | 0 |
| seconds-shot:modify | review | user | 1608 | 1608 | 0 |
| seconds-shot:modify | revision | system | 8488 | 8496 | 8 |
| seconds-shot:modify | revision | user | 764 | 764 | 0 |
| shot-revise:modify | generation | system | 3987 | 3995 | 8 |
| shot-revise:modify | generation | user | 663 | 663 | 0 |
| shot-revise:modify | review | system | 4584 | 4584 | 0 |
| shot-revise:modify | review | user | 1449 | 1449 | 0 |
| shot-revise:modify | revision | system | 3188 | 3196 | 8 |
| shot-revise:modify | revision | user | 711 | 711 | 0 |
| storyboard-text:modify | generation | system | 17004 | 17012 | 8 |
| storyboard-text:modify | generation | user | 1252 | 1252 | 0 |
| storyboard-text:modify | review | system | 5027 | 5027 | 0 |
| storyboard-text:modify | review | user | 4074 | 4074 | 0 |
| storyboard-text:modify | revision | system | 14354 | 14362 | 8 |
| storyboard-text:modify | revision | user | 1212 | 1212 | 0 |
| storyboard-reference:modify | generation | system | 17004 | 17012 | 8 |
| storyboard-reference:modify | generation | user | 1270 | 1270 | 0 |
| storyboard-reference:modify | review | system | 5027 | 5027 | 0 |
| storyboard-reference:modify | review | user | 4209 | 4209 | 0 |
| storyboard-reference:modify | revision | system | 14354 | 14362 | 8 |
| storyboard-reference:modify | revision | user | 1230 | 1230 | 0 |
| episode:new | generation | system | 1120 | 1167 | 47 |
| episode:new | generation | user | 340 | 340 | 0 |
| episode:new | review | system | 1870 | 1871 | 1 |
| episode:new | review | user | 361 | 361 | 0 |
| episode:new | revision | system | 1365 | 1412 | 47 |
| episode:new | revision | user | 404 | 404 | 0 |
| outline:en | generation | system | 3272 | 3317 | 45 |
| outline:en | generation | user | 374 | 374 | 0 |
| outline:en | review | system | 2050 | 2229 | 179 |
| outline:en | review | user | 362 | 362 | 0 |
| outline:en | revision | system | 3980 | 4025 | 45 |
| outline:en | revision | user | 401 | 401 | 0 |
| storyboard:plain | generation | system | 15802 | 15810 | 8 |
| storyboard:plain | generation | user | 866 | 866 | 0 |
| storyboard:plain | review | system | 4444 | 4444 | 0 |
| storyboard:plain | review | user | 3804 | 3804 | 0 |
| storyboard:plain | revision | system | 13751 | 13759 | 8 |
| storyboard:plain | revision | user | 962 | 962 | 0 |
| edited:storyboard | review | system | 5027 | 5027 | 0 |
| edited:storyboard | review | user | 3256 | 3256 | 0 |
| edited:outline | review | system | 2843 | 2864 | 21 |
| edited:outline | review | user | 402 | 402 | 0 |
| image-prompt | generation | system | 854 | 862 | 8 |
| image-prompt | generation | user | 25 | 25 | 0 |
| image-prompt | review | system | 1887 | 1887 | 0 |
| image-prompt | review | user | 192 | 192 | 0 |
| image-prompt | revision | system | 820 | 828 | 8 |
| image-prompt | revision | user | 121 | 121 | 0 |
| image:character | prompt | prompt | 168 | 168 | 0 |
| image:scene | prompt | prompt | 1192 | 1192 | 0 |
| image:part | prompt | prompt | 158 | 158 | 0 |
| image:pencil | prompt | prompt | 446 | 446 | 0 |

## 全局删除（改造后任何请求都不再出现的句子）

### 其他（需人工确认）（13）

- 创作和修订遵循上游事实与本次任务，本剧补充在此范围内生效。　〔9 处，如 episode:regenerate/generation〕
- summary 是非空字符串；　〔6 处，如 episode:regenerate/generation〕
- 两种模式都不把后续事件提前写进本集。　〔6 处，如 outline:regenerate/generation〕
- 输出协议 > 上游事实与本次任务 > 本剧补充 > 阶段技能 > 指导技能 > 指导素材（参考）。　〔42 处，如 outline:regenerate/generation〕
- 剧情容量适合本集总时长，不要求逐段计时或加总秒数，不能凭空增加解决问题的能力或剧情。　〔4 处，如 outline:regenerate/review〕
- 角色审核从提供的最终大纲 逐段识别需要正脸辨识或影响剧情的出镜人物，逐一对照 items。　〔3 处，如 characters:regenerate/review〕
- 叙事沿用同一意识的姓名不代表身体相同；　〔3 处，如 characters:regenerate/review〕
- 明确的穿越、夺舍或变身导致独立身体/外形身份时，切换前后实际出镜的形态必须分别建卡。　〔3 处，如 characters:regenerate/review〕
- appearance/look 混写两个无关身体、仅在 identity 提及新身体却没有独立卡，均判失败，指出对应剧情和缺失身份。　〔3 处，如 characters:regenerate/review〕
- 普通换装、背景路人及纯画外声音不强制新增卡。　〔3 处，如 characters:regenerate/review〕
- 角色审核必须先从大纲提取实际出镜的身体身份清单，再逐一匹配 items，不能按模型返回的名单反向假定完整。　〔3 处，如 characters:regenerate/review〕
- 原身体和新身体都出镜时，仅有“原名（新名）”一张卡、跨时代混写或在 identity 中提到新身份，都不算两张卡，必须判失败并指出缺失身份。　〔3 处，如 characters:regenerate/review〕
- 只接受独立 items 中各自单一、清晰的外形身份。　〔3 处，如 characters:regenerate/review〕

## 按请求移出（仍在其他请求或场景中）

| 场景 | 请求 | 角色 | 句数 |
|---|---|---|---:|

## 人工确认删除理由

以上 13 句均已核对新规则，不存在未确认删除：

| 旧句范围 | 处理及理由 |
|---|---|
| 本剧补充生效、优先级两句 | 改为本节点补充及本剧指导补充，对应节点隔离；上游事实和输出协议优先级保留 |
| summary 非空 | 保留非空并增加本次长度上限及约 200 字写作建议，程序仍按 300 字硬校验 |
| 两种模式 | 改为所有模式，覆盖生成、重新生成及修订 |
| 不凭空增加能力或剧情 | 保留能力与既定结果限制，明确允许符合摘要的合理细节展开，减少审核误判 |
| 身体身份盘点八句 | 合并重复段落；保留逐段盘点、意识不等于身体、独立身体分卡、混写和仅提及不算完成、普通换装及背景例外 |

纯目录迁移的差集见《提示词差集-Harness技能目录迁移》，该阶段没有删除提示词内容。
