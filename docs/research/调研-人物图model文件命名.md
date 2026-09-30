# 人物图 model 文件命名调研

## 结论
AC-1 已确认：model 文件名为 character-image.js，需重命名为 character-image-model.js。AC-2 已确认：代码引用仅人物接口与模型测试；架构与使用文档也需同步。AC-3 未验收：重命名后运行测试。

## 规格
目标：model 文件名带 model。非目标：更改实现、接口文件名或符号名。
AC-1：新文件存在，旧文件移除。AC-2：有效代码和当前文档引用更新。AC-3：测试无新增失败。

## 调用链
interfaces/character-image.js → models/character-image.js；tests/character-image-model.test.js → 同一 model。

## 证据
rg 搜索 meiji 与 .agents/architecture.md，发现两个 import 及架构、使用文档引用。

## 问题
文件名未体现 model 职责。

## 待用户决定
无。
