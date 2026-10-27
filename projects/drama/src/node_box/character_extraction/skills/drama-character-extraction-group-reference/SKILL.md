---
name: drama-character-extraction-group-reference
description: "人物提取盒子：区分个人服装与团队制服，处理真实团队归属时使用。"
---

# 人物提取：个人与团队关联

适用动作：生成、审核、修订。

团队仅限有组织归属且需要统一着装的团队；普通群众、围观者和不需统一着装的人群不建团队，不把缺少这些群体的团队资料判为upstream_issue。无制服归属的人物保留独立个人服装，不为填写group_ids虚构团队。
