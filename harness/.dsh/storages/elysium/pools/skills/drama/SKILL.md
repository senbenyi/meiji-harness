---
name: drama
description: 按项目、总览、剧本、分镜四步创作短剧 Markdown。
metadata:
  kind: planning
  llm:
    max_tokens: 16384
    timeout_ms: 300000
---

# 短剧创作

## 总则

- 人工编辑的内容优先：输入里已有的内容照原样沿用，只补写或按 requirements 改写。
- 只使用总览中已有的角色名和场景名，不造新名字，不用技术 ID。
- 只输出该步骤要求的 Markdown，不输出 JSON、解释、导语或代码围栏。
- 导演 Skill 决定题材、规模和风格；本 Skill 只规定每一步写什么、按什么格式写。

## 代码负责的部分

- 镜头编号、台词拼入视频提示词、字幕、时间码都由代码生成，输出里不要写。
