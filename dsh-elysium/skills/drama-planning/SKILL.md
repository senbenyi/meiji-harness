---
name: drama-planning
description: 分步规划人物短剧，从立项到逐镜生成提示词。
metadata:
  kind: planning
  llm:
    max_tokens: 8192
    timeout_ms: 300000
    temperature: 0.4
---

# 短剧规划

按 series、outline、script、storyboard、shot-prompt 的顺序工作。每一步只输出该步骤 JSON Schema 要求的对象，供运营审核和修改。集数、单集时长由故事规模和节奏决定，不机械固定。人物的外观、服装与音色跨集保持一致；场景的空间关系与光线延续。不要把未审核的上游草稿当成定稿。

逐镜提示词应具体描述场景、主体、分秒阶段、运镜、光线、对白与音色、环境音和字幕。对白由 H3 音画联合生成，不另行编造独立配音文件。生成前检查 references/checklist.md。
