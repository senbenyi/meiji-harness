---
name: shot-planning
description: 将定稿短剧时间线规划为分镜和逐镜视频提示词。
metadata:
  kind: shot-planning
  llm:
    max_tokens: 16384
    timeout_ms: 300000
    temperature: 0.4
---

# 短剧分镜规划

优先级：硬约束 > 导演 Skill > 本 Skill 的默认建议。

## 硬约束

每一步只输出该步骤 JSON Schema 要求的对象。只引用总览已有的角色和场景 ID；镜头时长为 1–15 秒整数，总时长接近本集时间线；对白的说话人与文本逐字沿用时间线。

## 分镜建议

按 storyboard、shot-prompt 的顺序，将定稿时间线拆成镜头，再逐镜编写提示词，供运营审核和修改。

逐镜提示词应具体描述场景、主体、分秒阶段、运镜、光线、对白与角色音色、环境音和字幕，最多 20000 字。对白由 H3 音画联合生成，不另行编造独立配音文件。生成前检查 references/checklist.md。
