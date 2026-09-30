# 人物图 model 文件命名实施记录

## 已修改文件
- meiji/server/prompts/models/character-image-model.js — 从 character-image.js 重命名，内容不变。
- meiji/server/prompts/interfaces/character-image.js、meiji/tests/character-image-model.test.js — 更新 import。
- .agents/architecture.md、meiji/docs/character-image-model.md — 更新当前路径。

## 验收标准核对
AC-1 通过：新文件存在，旧文件不存在。AC-2 通过：有效代码与当前使用文档无旧引用；历史记录保留当时路径。AC-3 通过：全量测试无新增失败。

## 测试
基线与改后均 372 通过、失败 0、取消 0。git diff --check 通过。GitNexus 索引更新成功。

## 人工待办
无。
