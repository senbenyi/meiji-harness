# 场景图提示词Model调研

## 结论
AC-1 — 已确认：人物 model 位于 prompts/models；场景当前仅 imageParts 平铺文本。
AC-2 — 已确认：场景资料在 client/asset-cards.js 含 name、landmark、light、space、look；人物 model 已定义三种模式与 Base64 图片用途。
AC-3 — 已确认：images.js 场景修改先 runTextSteps 改写 look；scene-image 预览未选实际卡，需要改为 model 复用。
AC-4 — 已确认：场景规则来自 constraints/scene/generate-scene-image.md，通过 parts.generate 保留可编辑覆盖，不能当人物固定约束处理。

## 规格
- 目标：场景图沿用人物的模型赋值、内部组装与原图意见修改方式。
- 非目标：修改人物 model、技能正文、图片协议、视频、场景参考上传 UI 或存储 schema。
- AC-1：新增可 JSON 序列化 scene-image-model.js，接收 scene 名称/地标/光位/空间/画面、规则、画幅及模式，提供 toSegments/toPrompt，固定影视场景设计师角色；不注入语言或视觉风格。
- AC-2：支持文字生成、参考模式、意见修改模型；参考和原图使用有序 Base64 数据，正文仅解释用途；新场景资料优先，意见只用于资料之外的画面调整。
- AC-3：实际场景生成、按意见修改与预览复用同一 model；修改直接带原图，不改写场景资料；步骤仍为 API、下载转 Base64、保存候选。
- AC-4：保留场景技能基础覆盖与本剧补充，规则正文不改，人物及其他接口不受影响。

## 调用链
images.startImage → scene-image 接口赋值 → SceneImageModel.toPrompt → submitAssetImage → gateway → 保存候选；preview 使用接口同源生成。

## 证据
| 来源 | 支持结论 |
|---|---|
| meiji/client/asset-cards.js:29 | 场景五项资料 |
| meiji/server/prompts/interfaces/scene-image.js | 现有平铺包装 |
| meiji/server/flow/operations/images.js:startImage | 修改分支先改写文本 |
| meiji/server/prompts/models/character-image-model.js | 参考的 model 结构 |

## 问题
| AC | 预期 | 当前 | 根因 |
|---|---|---|---|
| AC-1/3 | model 负责组装 | 无场景 model | 场景沿用旧接口 |

## 待用户决定
无。参考模式提供 model 能力，现有人物专属参考上传入口保持范围。
