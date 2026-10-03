# 精简大纲生成 skill

- 类型：小改动，仅修改 `meiji/skills/task/generate-story-outline-skill.md` 正文。
- 目标：合并重复与两层表述（条目 + 总结句），保留审核 skill 检查的全部生成要求。
- 非目标：不改七小节结构协议（由 `server/prompts/models/story-model.js` 组装）、审核 skill、Model、数据或流程。

## 改动与验收
| AC | 改动 → 预期结果 | 调研结论 |
|---|---|---|
| AC-1 | 对白（原 4 处）、提取依据（原 3 处）、动作/打斗/表情/声音（条目 + 总结两层）合并 → 正文明显缩短 | 已确认：原文逐段重复 |
| AC-2 | `review-story-outline-skill.md` 每个判失败项在新正文中都有对应要求 | 修改后逐项核对 |
| AC-3 | 相关测试不新增失败 | 修改后运行 |

## 验证
运行 story-model、story-props、skill-prompts、prompt-nodes、step-prompt-model 测试及全量 `npm test`。

## 验证结果
- AC-1 已确认：正文 1822 → 1133 字；对白、提取依据各合并为一处，表演类改为 4 条，删去重复总结句。修改前的文件与 HEAD 一致。
- AC-2 已确认：审核 skill 的事件忠实、主角动机、世界规则、因果剧情、提取依据、着装持物连续、结尾、越界内容、动作与表演、对白、情绪与声音各项在新正文均有对应要求；七小节结构仍由 story-model.js 组装。
- AC-3 已确认：story-model 26、story-props 4、skill-prompts 4、prompt-nodes 14、step-prompt-model 16 均通过。全量 628 项中 15 项失败，换回原 skill 后失败数相同（15），来自工作区其他未提交改动（约 15:41–15:47 修改的 prompts/models 等），与本次无关。
- 未调用付费模型；harness 未重启，GitNexus 未更新（本环境无 gitnexus）。
