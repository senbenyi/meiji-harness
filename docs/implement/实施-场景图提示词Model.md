# 场景图提示词Model实施记录

## 已修改文件
- meiji/server/prompts/models/scene-image-model.js — 场景资料、规则、补充、画幅、角色、三种模式和 Base64 输入，内部提示词转换及资料边界。
- meiji/server/prompts/interfaces/scene-image.js — 技能快照读取、model 赋值、生成/修改/预览同源组装。
- meiji/server/prompts/preview.js — 实际场景卡生成与修改预览。
- meiji/server/flow/operations/images.js、registry.js — 场景生成使用 model；场景修改携带原图 Base64，取消先改写文字的流程，三步图片计划。
- meiji/tests/scene-image-model.test.js、scene-image-edit.test.js — 模型结构、三种模式、校验、资料边界、预览等价、已确认/待确认原图编辑及三步记录。
- meiji/tests/prompt-interfaces.test.js、character-image-prompts.test.js、character-image-edit.test.js、skill.test.js — 更新受影响的场景结构与计划断言。
- meiji/docs/scene-image-model.md、.agents/architecture.md — 模型说明和架构职责。

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|---|---|---|
| AC-1 | 通过 | 属性、序列化、角色、分节、无语言/风格测试 |
| AC-2 | 通过 | 文生/参考/修改校验、Base64 不入正文、新资料优先及独立意见测试 |
| AC-3 | 通过 | 实际生成/预览等价；两种原图来源完整三步任务及场景资料保持测试 |
| AC-4 | 通过 | 基础覆盖/本剧补充测试；规则正文未修改；全量回归通过 |

## 测试
基线 382 通过、0 失败、0 取消；相关 36 通过、0 失败、0 取消；全量 npm test 390 通过、0 失败、0 取消。git diff --check 通过。

## 人工待办
真实图片接口未联调。参考模式仅提供 model 能力，未新增场景参考上传界面。
