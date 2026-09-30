# 人物图提示词 model

`server/prompts/models/character-image-model.js` 定义 `CharacterImageModel` 与创建/转换函数。当前先接入人物图片修改，原有纯文字生图与参考图生成入口仍沿用原接口；model 已能描述三种模式。

## 属性

| 属性 | 含义 |
|---|---|
| mode | generate / reference / modify |
| role | 固定为“人物角色设计师”，职责在 prompt 内表达 |
| character | nationality/name/role/gender/era/age/height/build/features 九个具名外观字段；其中 role 是人物身份，与顶层角色职责区分 |
| generationRules | 调用方提供的规则字符串；实际修改接口从技能快照选择适用年龄分节；空正文不回退 |
| canvas | 自定义像素 width/height，无 model 默认值 |
| images | 有序 `{ purpose, base64 }`；purpose 为 edit-base 或 character-reference；base64 是 PNG/JPEG/WebP 的 `data:image/...;base64,...` 字符串 |
| modification | `{ instruction, preserveUnspecified }`；人工意见单独保存，modify 必须有非空意见 |

修改必须有第一张图片作为唯一 edit-base；无图不降级生图。参考模式需要 character-reference，生成模式不带图片。返回 class 实例；数据可 JSON 序列化，`createCharacterImageModel` 可恢复实例方法。资料解析沿用共用 characterFieldValues（含 look 标签解析与国籍默认中国），不带剧情服装、道具或旧面向。

## 使用

```js
const model = createCharacterImageModel({
  mode: 'modify',
  character: characterCard,
  generationRules: rulesText,
  canvas: { width: 1000, height: 1504 },
  images: [{ purpose: 'edit-base', base64: 'data:image/png;base64,...' }],
  modification: { instruction: '将头发改为黑色短发', preserveUnspecified: true },
})
const prompt = model.toPrompt()
const referenceBase64 = model.images.map(image => image.base64)
```

`toPrompt()` 内部复用 `toSegments()`；保留导出 `characterImageModelToPrompt(model)`。最终文本按“角色与职责 → 任务 → 图片用途 → 人物资料 → 生成规则 → 画幅 → 修改意见 → 修改边界”排列。Base64 单独作为图片输入，正文仅以输入图片1等编号指代，不输出编码内容或本地路径。

修改意见明确改动的属性替代人物资料中的旧描述；规则依旧限定成图要求。保留原图中未被意见、规则与画幅涉及的内容，不能承诺像素完全不变。model 固定职责有助于明确任务语义，本次未做不同角色措辞的图片质量对照实验。

## 实际接入

人物 modify：代码优先读取待确认 candidate，否则读取已确认图；读取本地字节并转 Base64，调用 `characterImageModificationModel` 赋值后，使用同一 model 的 toPrompt 与 images 交给图片生成层。仅执行 image_generate，人物卡资料保持原样。结果继续进入候选图并等待人工确认。

模型本身只校验正整数宽高；当前网关适配按 8 倍数校验尺寸，长边超过 2048 时按比例缩小并向下对齐 8。归一化后的同一尺寸用于 prompt 与请求。默认沿用现有 9:16 尺寸映射。

## Base64 约定

人物修改提交 Base64 字符串；结果读取 URL 后下载图片转 Base64，再交给现有本地保存流程，仍支持 b64_json 响应。当前适配层沿用已有 multipart 容器，将 image[] 的人物编辑输入改为 Base64 data URL 文本；其他既有文件参考请求保留。底层传输协议本次不另行重设计，真实服务尚未联调。
