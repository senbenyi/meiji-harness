# 三视图生成提示词模板

> 适用：RealVisXL V5.0 等 SDXL 系照片模型。配合《三视图使用与设定说明》（`three_view_guide.md`）使用。
> 用法：把【】占位符替换成你想要的内容，整段复制到文生图正向提示词；负面提示词用第四节。

---

## 一、人物三视图 · 通用模板

```text
Professional character design turnaround sheet, THREE views of ONE and the same
consistent 【族裔+年龄+性别】: left front view, center side profile view, right back
view, all standing full body, evenly spaced in one row. SAME identical face, same
【发型+发色+分缝】 with 【五官特征】, same 【体型】 in every view. Outfit: 【上装】,
【下装或连体】, 【鞋】, 【配饰】. Style: 【整体风格锚】, shot on 【镜头焦段】mm lens, soft
studio three-point lighting with gentle rim light for depth, natural skin texture
with fine detail, crisp micro-contrast, subtle soft floor shadow grounding each
figure. 【背景描述】. Clean anatomy, symmetrical face, sharp focus, high detail.
```

### 占位符速查

| 占位符 | 填什么 | 示例 |
|---|---|---|
| 【族裔+年龄+性别】 | 身份槽，放最前生效最强 | `young East Asian woman, mid-20s` |
| 【发型+发色+分缝】 | 长度+形态+颜色+分缝 | `long wavy dark-brown hair with center part` |
| 【五官特征】 | 1–2 个记忆点即可 | `soft warm smile, bright expressive eyes` |
| 【体型】 | 一词即可 | `slim graceful figure` / `athletic build` |
| 【上装】【下装】 | 服装+材质 | `white off-shoulder linen romper`, `beige chino shorts` |
| 【鞋】【配饰】 | 必填，跨视角最易崩的点 | `flat sandals`, `brown leather belt and watch` |
| 【整体风格锚】 | 见指南文件风格词表 | `photorealistic`（默认） |
| 【镜头焦段】 | 人物 85 / 场景 35 | `85` |
| 【背景描述】 | 默认无缝灰 | `Neutral warm-grey seamless background` |

---

## 二、负面提示词（人物三视图 · 固定搭配）

```text
child, minor, underage, bad anatomy, deformed hands, extra fingers, fused fingers,
malformed limbs, duplicate body, distorted face, blurry, low resolution, text,
watermark, logo, inconsistent views, different hairstyles, different outfits,
different shoes, different face
```

> 最后四个 `different ...` 是三视图专用：专治跨视角的发型/服装/鞋子/长相漂移。

---

## 三、成品示例（本项目实测通过）

### 女主

```text
Professional character design turnaround sheet, THREE views of ONE and the same consistent young East Asian woman, mid-20s: left front view, center side profile view, right back view, all standing full body, evenly spaced in one row. SAME identical face, same long wavy dark-brown hair with center part, same slim graceful figure in every view. Outfit: white off-shoulder summer romper, beige straw crossbody bag, flat sandals. Style: photorealistic, shot on 85mm lens, soft studio three-point lighting with gentle rim light for depth, natural skin texture with fine detail, crisp micro-contrast, subtle soft floor shadow grounding each figure. Neutral warm-grey seamless background. Clean anatomy, symmetrical face, sharp focus, high clarity.
```

### 男主

```text
Professional character design turnaround sheet, THREE views of ONE and the same consistent young East Asian man, mid-20s: left front view, center side profile view, right back view, all standing full body, evenly spaced in one row. SAME identical face, same short neat black hair, same athletic build in every view. Outfit: mint-blue linen shirt with sleeves rolled up, beige chino shorts, leather sandals. Style: photorealistic, shot on 85mm lens, soft studio three-point lighting with gentle rim light for depth, natural skin texture with fine detail, crisp micro-contrast, subtle soft floor shadow grounding each figure. Neutral warm-grey seamless background. Clean anatomy, symmetrical face, sharp focus, high clarity.
```

---

## 四、场景 / 地点三视图 · 通用模板

```text
Professional location scouting reference sheet, THREE panels of the SAME 【地点类型】
arranged horizontally: left 【机位一】, center 【机位二】, right 【机位三】. SAME geography
in every panel: 【地标1】, 【地标2】, 【地标3】, 【植被与建筑】, 【时间与光线】. Style:
photorealistic cinematic, 35mm lens, high clarity, consistent colors and layout
across all three panels.
```

### 成品示例（海滩）

```text
Professional location scouting reference sheet, THREE panels of the SAME tropical beach cove arranged horizontally: left wide establishing view from the beach entrance, center view standing at the water line looking back at the shore, right elevated three-quarter view along the coastline. SAME geography in every panel: curved golden-sand beach, a cluster of blue-and-white striped umbrellas on the left side, a green palm-covered headland on the right, turquoise sea with gentle surf, scattered beachgoers, sunny afternoon with warm golden light. Style: photorealistic cinematic, 35mm lens, high clarity, consistent colors and layout across all three panels.
```

> 场景图的负面提示词沿用第二节即可（`inconsistent views` 一条对场景同样关键）。

---

## 五、推荐生成参数（RealVisXL V5.0 实测）

| 参数 | 值 | 说明 |
|---|---|---|
| 分辨率 | **1536×864** | 多视角并排需要宽度；再大会出肢体崩坏 |
| 步数 | 32–34 | |
| CFG | 6.0 | |
| 采样器 | `dpmpp_2m_sde` | |
| 调度器 | `karras` | |
| 模型 | RealVisXL V5.0（照片系） | 换风格须换对应模型，见指南文件 |

---

## 六、快速检查清单

- [ ] 每个视角是**同一个人**（脸/发型/体型不漂）
- [ ] 正面、侧面、背面三个方向齐备（多出 4–5 个视角可裁图解决）
- [ ] 服装跨视角一致，**鞋子**两两相同
- [ ] 手部解剖正常（五指、无融合）
- [ ] 风格统一（不会一半照片一半插画）
- [ ] 背面视角的服装设计与正面自洽（露背/印花/帽子要显式写进 Outfit）

验收不通过的处置与"按图回写文字描述"的方法，见《三视图使用与设定说明》。
