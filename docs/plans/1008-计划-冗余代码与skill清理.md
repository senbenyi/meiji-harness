# 冗余代码与 skill 清理

- 类型：重构（完整流程，涉及 5 个源码 / skill 文件）
- 目标：清除已失去调用的旧辅助逻辑，合并重复审核规则，保持当前制作行为。
- 非目标：更改人物图规则、移除历史数据兼容、改动模型调用与技能注册、清理用户已有修改。

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 判定 | 依据或缺口 |
|---|---|---|---|
| AC-1 | 4 个旧辅助函数 → 源码无定义及残留引用，实际入口行为不变 | 已确认 | 全仓检索只命中定义；包只公开 index/session，不公开这些内部模块 |
| AC-2 | 每秒审核请求 → 人物范围、卡外对白、别名及参与类型规则保留，重复前言合并 | 已确认 | review-seconds 第一、第二段及对白验收条目覆盖同组要求 |
| AC-3 | 当前测试基线 → 相关测试通过，全量无新增失败 / 取消 | 已确认 | 相关 101/101 通过；全量前后均 923 项，922 通过、1 失败、0 取消，失败为同一人物图预期 |
| AC-4 | 当前工作区 → 原有变更保留，清理差异无格式错误 | 已确认 | 5 个文件的修改前副本与当前文件逐项核对，仅删除目标函数/依赖及合并规则；diff --check 通过 |

## 调用链与证据
面板 / Run → 具体任务 → shot-text-prompts、实体引用及领域解析；本次只删除无调用辅助函数，不改变真实入口。
每秒审核 → reviewParts → 技能快照 → review-seconds-instructions-skill.md。

| 来源 | 支持结论 |
|---|---|
| meiji/shared/film-characters.js:19 | needsFilmCharacters 只剩定义，直接角色复用后不再使用 |
| meiji/server/prompts/shot-text-prompts.js:151 | storyboardSource 只剩定义，secondsText import 专用于它 |
| meiji/shared/entity-references.js:39 | entityInstructions 只剩定义，kindLabels 专用于它 |
| meiji/shared/story-content.js:115 | normalizeEpisodeDraft 只剩定义，episode-summary import 专用于它 |
| meiji/skills/review/review-seconds-instructions-skill.md:1 | 前言与下一段、对白验收重复；卡外不强求建卡/旁白的要求移入同一人物范围段 |
| meiji/package.json:18 | 包 exports 只有 index/session |

GitNexus status 后因文档索引过期已刷新。4 个目标 impact upstream 都为 UNKNOWN、0 已解析调用方/流程，不能据此判定安全；补充全仓符号检索及公开 exports 检查后确认内部无引用。loadCatalog 影响为 CRITICAL（直接 catalog / validateSkills，覆盖技能加载与预览流程）；不编辑该函数，不改变登记与文件结构。图谱流程枚举存在容量截断，未使用缺少流程作为无影响证据。

## 问题
| AC | 预期 | 实际 | 根因 |
|---|---|---|---|
| AC-1 | 只保留使用中的辅助逻辑 | 4 个无引用导出 | 功能调整后遗留 |
| AC-2 | 同一审核要求集中描述 | 参与者前言重复人物与对白条目 | 增量规则叠加 |

## 待用户决定
无。

## 改动
### 阶段 1：无引用代码
1. `meiji/shared/film-characters.js:needsFilmCharacters` — 删除旧前置判定 → AC-1。
2. `meiji/server/prompts/shot-text-prompts.js:storyboardSource` — 删除函数、专用 secondsText import 和对应注释 → AC-1。
3. `meiji/shared/entity-references.js:entityInstructions` — 删除函数及专用 kindLabels → AC-1。
4. `meiji/shared/story-content.js:normalizeEpisodeDraft` — 删除函数及专用 episode-summary import → AC-1。

验证：领域、每秒、分镜、提示词与架构相关测试通过；全仓无残留符号引用。

### 阶段 2：审核 skill 去重
1. `meiji/skills/review/review-seconds-instructions-skill.md` — 删除重复前言，将不强求卡外建卡/改旁白并入人物范围段，明确保留卡内说话人必须入清单，删除重复的只列一次 → AC-2。

验证：使用 `tests/fixtures/prompt-scenarios.js` 的 scenarioProject 采集 regenerate/modify 每秒请求、人工编辑审核；`scripts/prompt-diff.js` 对比，逐项核对删除语句去向。全场景 buildScenarios 因旧摘要夹具缺故事小段已在改动前报错，不为本任务扩大修改夹具。

收尾：detect_changes scope all（已有大量工作区改动，单独核对本次增量）；全量测试无新增失败；git diff --check；集中更新图谱 → AC-3、AC-4。

## 验证结果
已完成。相关测试 101 通过、0 失败、0 取消；全量基线与最终均 922 通过、1 失败、0 取消（总计 923），没有新增失败。初次去重后相关测试发现卡内说话人要求的文字匹配失败，补回明确措辞后全部通过。

4 个提示词场景对比：生成、修订及所有 user 资料完全相同，仅审核 system 减少 103 字。脚本识别 6 条原句消失，已逐项核对：人物范围、别名唯一性和参与类型在首段保留；卡外建卡/旁白约束合入首段；说话人、delivery、嘴部一致性在对白验收保留。不存在删掉验收要求。

detect_changes 返回当前工作区 138 文件、479 符号、296 流程、critical，没有 partial/truncated 标记；包含任务开始前已有的大量改动，不能归为本次变更。本次 5 个文件相对保存副本仅发生计划中的删减与合并。删除符号未在 changed_symbols 出现，补以全仓检索与增量差异确认，不以图谱零结果替代核对。git diff --check 通过。源码不含新增凭据。

图谱在代码验证后集中更新；重启 Harness 与真实界面走查未执行，本次不改变任何有调用的后端函数或模型接口。
