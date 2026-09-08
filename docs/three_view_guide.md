# 三视图使用与设定说明

> 配套文档：《三视图生成提示词模板》（`three_view_prompt.md`）。
> 本文说明：怎么操作、怎么增强画质与立体感、以及族裔 / 发型 / 肤色 / 服装 / 体型的设定词表。

---

## 一、这套三视图是干什么的

在短剧生产管线里，三视图的作用是**在生成视频之前锁定角色与场景**：

```text
人物三视图 + 场景三视图
        │  视觉验收（见第四节清单）
        ▼
按"实际出图"回写角色文字描述          ← 关键步骤，见第三节
        ▼
生成场景首帧（1024×576，与视频画幅一致）
        ▼
逐段视频生成（每段以上一段末帧续接）
```

三视图本身不直接进视频，它是**设计基准 + 校准依据**。真正的一致性由
"场景首帧 → 链式续接"保证，三视图保证的是"首帧画对、后续提示词不打架"。

---

## 二、操作流程（五步）

### 第 1 步：填模板

从《提示词模板》复制人物三视图模板，替换全部【】占位符。填写顺序建议：
**身份槽 → 发型 → 体型 → 服装（上→下→鞋→配饰）→ 风格锚**。
场景三视图同理，先想清楚"这个地点最想让观众记住的 3 个地标"。

### 第 2 步：生成

用推荐参数（1536×864 / steps 32–34 / CFG 6.0 / dpmpp_2m_sde+karras）。
同一个角色不满意就**换种子重摇**，不要连续堆叠描述词——堆词会互相稀释。

### 第 3 步：视觉验收

按模板文档第六节的清单逐项过。常见不达标与处置：

| 症状 | 处置 |
|---|---|
| 视角只有 2 个或 4–5 个 | 可接受，裁图保留正/侧/背三张即可 |
| 某视角脸崩 | 换种子重摇；连续 3 次崩同一视角 → 简化该视角描述 |
| 鞋子跨视角不一致 | 鞋子描述写更具体（颜色+材质+款式），重摇 |
| 背面视角服装瞎编 | 在 Outfit 里显式写背面设计（如 `open-back design`、`hood`） |
| 整体偏插画/偏 3D | 风格锚被稀释，检查是否混入其他风格词，重摇 |

### 第 4 步：按"实际出图"回写角色描述（最重要的动作）

文生图一定会偏离你的文字（写 flat sandals 可能给高跟凉鞋，写 white shirt
可能给薄荷绿）。**以出图为准**，把角色描述改写成与画面完全一致的样子，
后续所有提示词（场景首帧、每一段视频）都用这份校准后的描述。
参考图与提示词不一致，是视频里角色"换装/换脸"的头号原因。

### 第 5 步：投入生产

用校准后的角色描述 + 场景三视图生成场景首帧（分辨率与视频画幅一致，
本项目为 1024×576），再进入逐段视频生成。

---

## 三、如何"增强"（清晰度 / 立体感 / 质感）

提示词层能把模型能力用满，但有天花板：清晰度的硬上限在**源模型与生成分辨率**。
以下按实测有效程度排序。

### 3.1 立体感（三件套，最有效）

```text
soft studio three-point lighting with gentle rim light    ← 三点布光+轮廓光
crisp micro-contrast                                       ← 微反差
subtle soft floor shadow grounding each figure             ← 接地阴影
```

不要写 `3D` / `3D render` —— 在照片系模型上会把画面带成渲染风。

### 3.2 清晰度

```text
sharp focus, high clarity, high detail, crisp micro-contrast
```

注意：这些词是"把对焦和锐度拉满"，不能凭空造出模型没有的细节。
成片阶段的清晰度由超分/锐化环节决定，提示词只负责源头不糊。

### 3.3 质感

- 皮肤：`natural skin texture with fine detail`（真实感），
  进阶 `visible pores`、`light freckles`（更真实，但也更挑脸）；
- 服装：写**材质词**，材质决定褶皱和光泽 ——
  `linen`（亚麻，自然褶皱）/ `cotton`（棉）/ `silk`（丝，高光流动）/ `denim`（牛仔）/ `leather`（皮革）；
- 头发：`glossy`（光泽）/ `matte`（哑光）/ `wind-blown`（随风）。

### 3.4 镜头感

- 人物三视图：`85mm lens`（人像焦段，背景压缩、脸不变形）；
- 场景/环境：`35mm lens` 或 `24mm wide`（空间感）；
- 电影感加成：`shallow depth of field`（浅景深）、`film grain`（颗粒）。

### 3.5 风格切换（要换模型）

| 风格 | 风格锚写法 | 模型要求 |
|---|---|---|
| 写实照片（默认） | `photorealistic` | RealVisXL 等照片系 SDXL |
| 电影剧照 | `cinematic film still, anamorphic` | 同上 |
| 动漫 | `anime illustration, clean lineart` | 必须换动漫系模型（Anything/Pony 等） |
| 3D 渲染 | `Pixar style 3D render, subsurface scattering` | 必须换 3D 系模型 |

**风格词与模型不匹配 = 半吊子画面**，这是新手最常见的翻车点。

---

## 四、族裔设定词表

写在身份槽（模板第一行 `consistent` 之后），立刻生效。

| 族裔 | 英文写法 |
|---|---|
| 东亚 | `East Asian` |
| 中国 | `Chinese` |
| 日韩 | `Japanese` / `Korean` |
| 东南亚 | `Southeast Asian` |
| 欧美白人 | `Caucasian` / `White` |
| 黑人 | `Black` / `African descent` |
| 南亚 | `South Asian` |
| 拉美 | `Latino`（男）/ `Latina`（女） |
| 中东 | `Middle Eastern` |
| 混血 | `mixed East Asian and European heritage`（混血写法：mixed A and B heritage） |

年龄写法：`young, mid-20s` / `in her early 30s` / `middle-aged, late 40s`。
性别：`woman` / `man`；少儿内容生产请勿使用（本项目仅限成年人角色）。

---

## 五、发型设定词表

按"长度 → 形态 → 颜色 → 分缝"四段拼装：

- **长度**：`long` / `shoulder-length` / `short` / `buzz cut`
- **形态**：`straight`（直）/ `wavy`（波浪）/ `curly`（卷）/ `bob`（波波头）/
  `ponytail`（马尾）/ `twin tails`（双马尾）/ `bun`（发髻）/ `braid`（辫子）/ `undercut`（两侧铲青）
- **颜色**：`black` / `dark brown` / `chestnut`（栗色）/ `blonde` / `auburn`（红棕）/ `silver-grey` / `pastel pink`
- **分缝**：`center part`（中分）/ `side part`（侧分）/ `no part, swept back`（背头）

示例：`long wavy dark-brown hair with center part`、
`short neat black hair`、`shoulder-length straight blonde hair with side part`。

---

## 六、肤色设定词表

| 肤色 | 英文写法 |
|---|---|
| 白皙 | `fair skin` / `porcelain skin` |
| 浅 | `light skin` |
| 自然/中等 | `medium skin tone` |
| 小麦/橄榄 | `olive skin` / `tan skin` |
| 深色 | `deep brown skin tone` / `dark skin` |

写法要点：
- 肤色**写一次**即可（放在发型或体型附近），重复堆叠会出现色斑；
- 深肤色角色避免只写 `dark skin`，用 `rich deep skin tone` + 补一个光泽词
  （`healthy sheen`）更稳；
- 想要真实感统一走 `natural skin texture with fine detail`，这句对所有肤色通用。

---

## 七、服装设定方法

**结构公式**：`上装 + 下装/连体 + 鞋 + 配饰`，每件带一个材质词。

### 7.1 常用颜色

`white` / `cream`（米白）/ `black` / `navy`（藏青）/ `mint-blue`（薄荷绿）/
`deep-red`（深红）/ `burgundy`（酒红）/ `beige`（米色）/ `pastel pink`（浅粉）

### 7.2 常用材质

`linen`（亚麻）/ `cotton`（棉）/ `silk`（丝）/ `satin`（缎）/ `denim`（牛仔）/
`wool`（羊毛）/ `leather`（皮革）/ `chiffon`（雪纺）

### 7.3 按场景给建议

| 场景 | 参考组合 |
|---|---|
| 海滩 | `off-shoulder linen romper` + `straw bag` + `flat sandals` |
| 都市 | `trench coat` + `slim trousers` + `leather boots` |
| 冬季 | `wool overcoat` + `cashmere scarf` + `gloves` |
| 正式 | `tailored suit` + `silk tie` + `oxford shoes` |

### 7.4 背面设计必须显式写

三视图的背面视角，模型默认"看不到就瞎编"。凡背面有设计感的元素
（露背、连帽、印花、蝴蝶结、开叉），必须逐个写进 Outfit，
例如 `open-back design with criss-cross straps`。

---

## 八、体型与姿态

- 体型：`slim`（纤细）/ `athletic`（健美）/ `curvy`（丰满）/ `tall` / `petite`（娇小）
- 姿态（三视图通用）：`standing straight, arms relaxed, calm neutral pose`
- 表情：`neutral calm` / `warm smile` / `confident look`

三视图不要写动态姿势（跑/跳/坐）——多视角并排时动态姿态必然崩，
动态留给视频环节。

---

## 九、验收清单（出图后逐项过）

- [ ] 每个视角是**同一个人**（脸/发型/体型不漂）
- [ ] 正/侧/背三个方向齐备
- [ ] 服装跨视角一致，**鞋子**两两相同
- [ ] 手部解剖正常
- [ ] 风格统一
- [ ] 背面设计自洽

## 十、与生产管线的衔接

1. 三视图通过验收后，**按图回写角色描述**（见第二节第 4 步）；
2. 用校准后的描述生成场景首帧（画幅=视频画幅）；
3. 进入逐段视频生成（首帧链式续接）；
4. 后期：裁头尾帧 → 微交叉拼接 → 放大输出。

生产侧脚本与工作流见 `../workflows/README_oneshot_workflow.md`。
