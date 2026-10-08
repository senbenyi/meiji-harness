# 冗余代码与 skill 清理实施记录

## 已修改文件
- `meiji/shared/film-characters.js` — 删除无引用 needsFilmCharacters，保留参与者汇总及历史绑定。
- `meiji/server/prompts/shot-text-prompts.js` — 删除无引用 storyboardSource 及专用 import、注释。
- `meiji/shared/entity-references.js` — 删除无引用 entityInstructions 及专用 kindLabels。
- `meiji/shared/story-content.js` — 删除无引用 normalizeEpisodeDraft 及专用 import。
- `meiji/skills/review/review-seconds-instructions-skill.md` — 合并重复人物范围前言，保留对白、别名、参与类型及卡外范围约束。
- `docs/plans/1008-计划-冗余代码与skill清理.md` — 调研、影响分析、范围与验证结果。

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|---|---|---|
| AC-1 | 通过 | 4 个目标 impact UNKNOWN 后补全仓检索；只有原定义，删除后无源码残留。逐文件清理前副本对比无额外修改 |
| AC-2 | 通过 | regenerate/modify + 人工编辑审核共 4 场景；生成、修订和 user 完全不变，审核 system 每份减少 103 字；6 个删除原句逐项核对等义规则仍保留 |
| AC-3 | 通过（无新增失败） | 相关 101 通过 / 0 失败 / 0 取消；全量前后 922 / 1 / 0，总计 923 |
| AC-4 | 通过 | 对比任务开始的 5 文件副本确认增量仅限计划；git diff --check 通过，未写凭据 |

## 测试
相关命令：在 meiji 下设置 MEIJI_MODELS_LOCAL=tests/fixtures/models.local.json，node --test 测试 architecture、story-package、generate-story-content、deferred-film-characters、skill-prompts、prompt-interfaces、step-prompt-model、seconds-character-roster、seconds-background-speaker、seconds-participant-filter、video-prompt-renderer。

首次相关运行 100 通过 / 1 失败 / 0 取消：去重措辞未保留测试检查的“卡内说话人”。修正首段明确入清单要求后 101 / 0 / 0。

全量 npm test 基线与最终均 923 项：922 通过、1 失败、0 取消。原有失败为 character-image-prompts「人物固定约束只读且不受旧基础覆盖和本剧补充影响」：当前人物图片 skill 正文与旧测试预期不符，本次未修改该 skill 或该测试。

提示词全场景 buildScenarios 在改动前因旧摘要 root 夹具缺故事小段报 409；使用同文件导出的 scenarioProject 采集相关请求，运行 scripts/prompt-diff.js 完成核对。原句去向：

| 原句要求 | 合并后所在位置 |
|---|---|
| participants 仅卡内 | 首段本集清单白名单 |
| 卡外动作、对白保留，不强求建卡或旁白 | 首段明确保留 |
| speakerName、delivery 与嘴部一致 | 原对白验收条目 |
| 卡内说话人入清单、登记别名 | 首段明确入清单及接受登记称谓 |
| visible/voice、排除独立旁白 | 首段画内对白 visible、全镜发声 voice |
| 同一人物一次 | 首段同一卡不能不同称谓重复 |

图谱检测 scope all 返回 138 文件 / 479 符号 / 296 流程、critical，无 partial/truncated 标记。这是全部未提交改动，不能宣称都是本次影响；本次增量已单独核对。代码验证后更新索引。

## 人工待办
Harness 重启与真实界面走查未执行。人物图片 skill 的已有测试不一致保留，需另行确定正文或预期；本次无新增失败。
