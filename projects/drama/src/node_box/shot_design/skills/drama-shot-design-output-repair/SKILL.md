---
name: drama-shot-design-output-repair
description: "分镜设计盒子：按明确校验错误修复分镜输出，保留有效剧情和引用时使用。"
---

# 分镜设计：输出修复边界

适用动作：生成、修订。

输出修复与修订边界：收到output_repair时，按validation_error修复上一响应，返回完整非空shots，不返回占位空集合，不擅自删戏或补造引用。仅修正确定的输出/引用错误，保留已正确内容。收到审核意见时只处理有原文证据的阻断项，非阻断suggestions可选，不为采纳建议重写全部镜头。
