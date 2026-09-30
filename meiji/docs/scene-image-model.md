# 场景图提示词 model

`server/prompts/models/scene-image-model.js` 接收数据，由自身 `toSegments()` / `toPrompt()` 生成最终提示词。接口层读取本次任务固定的技能组合并赋值，模型不读取文件或发送请求。

| 属性 | 内容 |
|---|---|
| scene | 最新场景资料：name 名称、landmark 地标、light 光位、space 空间、look 画面 |
| generationRules | generate-scene-image.md 正文或已保存的基础覆盖 |
| additionalInstructions | 已保存的本剧补充 |
| canvas | 自定义正整数像素 width、height |
| mode | generate、reference、modify |
| role | 固定影视场景设计师，职责写入 prompt |
| images | 按顺序传入 purpose、base64；purpose 为 edit-base 或 scene-reference |
| modification | instruction、preserveUnspecified，仅用于修改模式 |

```js
const model = createSceneImageModel({
  scene: { name: '庭院', landmark: '南门北墙', light: '西侧夕阳', space: '中央通路', look: '完整门墙及远山' },
  generationRules: rules,
  canvas: { width: 1344, height: 768 },
})
const prompt = model.toPrompt()
```

提示词按职责、任务、图片用途、场景资料、资料边界、生成规则、本剧补充、画幅、修改意见与修改边界分节。图片 Base64 只作为图像输入，不拼入文字；不增加视觉风格或语言属性。

最新场景资料始终作为事实依据。场景资料变化时直接传新资料，参考图与原图不能恢复旧资料。人工意见用于资料之外的画面调整，如机位、构图和安全边距；资料字段的变更通过编辑场景卡完成。

`interfaces/scene-image.js` 统一读取技能并创建 model；实际生成和预览使用相同函数。普通生成传最新卡资料，按意见修改传已确认图或待确认图的 Base64，并直接执行图片编辑，不先调用文本模型改写场景资料。

模型支持 reference 模式；本次没有新增场景参考图上传界面，已有参考上传入口仍供人物使用。场景实际生成支持传入自定义画幅，未指定时沿用项目画幅。

图片任务维持三个步骤：调用图片 API → 下载图片并转 Base64 → 保存候选图片。候选图需人工确认后才入素材库。
