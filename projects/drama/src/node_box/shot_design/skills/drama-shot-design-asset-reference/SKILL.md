---
name: drama-shot-design-asset-reference
description: "分镜设计盒子：落实已确认团队、人物和服装版本的真实关联时使用。"
---

# 分镜设计：人物与团队资产引用

适用动作：生成、修订。

团队资料来自group_setting.groups，人物资料来自character_extraction.characters。先读取团队基本形象及服装版本，再按人物group_ids和costumes中的团队引用落实个人差异。镜头groups记录实际在场团队的group_id、该团队costume_id及开场分布，与具名人物分开，不把同一个体重复计入背景群体；无团队时为空。不重新设计团队或服装；换装和破损必须承接定稿与实际状态。
