# 人物图 model 文件命名

- 类型：重命名
- 目标：character-image.js → character-image-model.js，行为不变。
- 调研：docs/research/调研-人物图model文件命名.md

## 待用户决定
无。

## 改动
1. meiji/server/prompts/models/character-image.js — 文件重命名为 character-image-model.js → AC-1。
2. meiji/server/prompts/interfaces/character-image.js、meiji/tests/character-image-model.test.js — import 更新 → AC-2。
3. .agents/architecture.md、meiji/docs/character-image-model.md — 当前文档路径更新 → AC-2。

## 验收标准
AC-1：文件完成重命名，内容不变。AC-2：引用有效。AC-3：npm test 无新增失败。

## 验证结果
基线与改后均 372/372 通过，失败 0、取消 0。旧文件已移除，当前代码和使用文档无旧引用。git diff --check 通过；GitNexus 索引更新成功。
