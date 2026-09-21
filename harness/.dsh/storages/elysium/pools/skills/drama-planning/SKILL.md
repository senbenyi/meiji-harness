---
name: drama-planning
description: 规划人物短剧的剧情总览和逐集时间线。
metadata:
  kind: planning
  llm:
    max_tokens: 8192
    timeout_ms: 300000
    temperature: 0.4
---

# 短剧规划

优先级：硬约束 > 导演 Skill > 本 Skill 的默认建议。

## 硬约束

每一步只输出该步骤 JSON Schema 要求的对象。角色和场景只引用总览中的 ID；时间线从 0 秒连续到单集秒数，保留每句对白的说话人、文本与语气。不要把未审核的上游草稿当成定稿。

## 规划建议

整体流程按 series、timeline、storyboard、shot-prompt 的顺序工作。本 Skill 负责 series 和 timeline；分镜与逐镜提示词由 shot-planning 负责。集数、单集时长由故事规模和节奏决定，不机械固定。人物的外观、服装与音色跨集保持一致；场景的空间关系与光线延续。输出供运营审核和修改。

生成前检查 references/checklist.md。
