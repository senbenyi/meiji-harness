# 场景图提示词Model

- 类型：新功能及提示词流程调整
- 目标：创建场景 model 并统一实际生成、修改与预览。
- 调研：docs/research/调研-场景图提示词Model.md

## 待用户决定
无。

## 改动
1. meiji/server/prompts/models/scene-image-model.js — 新建场景资料、规则、本剧补充、画幅、三种模式、Base64 图片、意见与 toPrompt → AC-1/2。
2. meiji/server/prompts/interfaces/scene-image.js — 技能快照与 model 赋值；生成、修改、预览及导出函数 → AC-3/4。
3. meiji/server/prompts/preview.js — 场景实际卡预览、修改预览复用接口 → AC-3。
4. meiji/server/flow/operations/images.js、registry.js — 场景生成用 model，意见修改直接带原图并取消文字改写计划；场景画幅传入 model → AC-3。
5. meiji/tests/scene-image-model.test.js、scene-image-edit.test.js — 结构/边界/验证、规则覆盖、预览等价和三步完整流程 → AC-1/2/3/4。
6. meiji/tests/prompt-interfaces.test.js、character-image-prompts.test.js、character-image-edit.test.js — 更新场景结构及修改计划断言 → AC-3/4。
7. meiji/docs/scene-image-model.md、.agents/architecture.md — 描述模型与流程 → AC-1/3。

## 验收标准
- AC-1：新增可 JSON 序列化 scene-image-model.js，接收 scene 名称/地标/光位/空间/画面、规则、画幅及模式，提供 toSegments/toPrompt，固定影视场景设计师角色；不注入语言或视觉风格。
- AC-2：支持文字生成、参考模式、意见修改模型；参考和原图使用有序 Base64 数据，正文仅解释用途；新场景资料优先，意见只用于资料之外的画面调整。
- AC-3：实际场景生成、按意见修改与预览复用同一 model；修改直接带原图，不改写场景资料；步骤仍为 API、下载转 Base64、保存候选。
- AC-4：保留场景技能基础覆盖与本剧补充，规则正文不改，人物及其他接口不受影响。

## 验证结果
基线 382 通过、0 失败、0 取消。相关测试、全量 npm test、git diff --check 后更新 GitNexus。
