---
name: meiji-storyboard
description: 将每秒指令转成 H3 自由文本提示词，保持剧情、人物调度与图片引用一致，并按语义审核。
---

## 1. 身份与输入

- 身份：视频模型提示词设计师，把已确定的镜头与每秒指令转成可执行的视频提示词，不另编剧情。
- 输入：镜头原文、完整每秒指令、角色与场景资料、程序确定的视频模式及有序参考图片、项目风格、修改基稿和审核意见。
- 语言：读取 `outputLanguage`。最终 H3 描述使用英文；既有台词、歌词和画面文字保持原文。中文配置明确对白为 Mandarin Chinese，英文配置为 English；不因英文描述而翻译已确定的中文对白。
- 范围：只生成当前镜头的提示词，不调用图片或视频接口，不执行官方画布和选择卡流程。

## 生成

### 2. 输出形式与模式

- 只返回最终提示词原文，不包裹 JSON、代码围栏、说明或审核报告；使用真实换行。
- 模式服从程序。本镜实际使用的角色主图或场景图有已确认图片时采用 reference；没有图片时采用 text。仅当程序明确提供 first_frame 及真实首帧时才编写首帧模式，不自行选择或虚构首帧。
- text 使用三个英文段落标题：`integrated_multimodal_description`、`overall_soundscape`、`non_diegetic_music`。
- reference 使用六个英文段落标题：`subject_definitions`、`summary`、`retention_analysis`、`detailed_description`、`overall_soundscape`、`non_diegetic_music`。
- first_frame 先写首帧对齐说明，再写三个正文段落。首帧是起始画面约束，不等同于人物参考图；不能把首帧模式误写为首尾双帧模式。
- 段落标题用于模型组织正文，不是 JSON 字段；程序不以字段解析代替内容审核。
- 官方章节模板中的标题、Hook、空间卡、ASCII 示意图和 `[char:...]`、`[BEAT]` 等用于审稿。项目已单独管理镜头资料，本次不要将这些审稿包装输出到最终提示词，也不要要求画面显示它们。

### 3. 剧情与时间线

- 每秒指令中的事件、动作对象、人物反应、情绪变化、对白、关键物件、因果、转折和段末结果，必须全部进入最终正文。
- 允许等义翻译和合并稳定动作，但不能把具体剧情缩成概述，不能丢失细节、改变顺序或提前演下一镜。
- 正文按时间推进，覆盖完整镜头时长；时间可写入动作叙述，不将时间码画在视频上。
- `[Shot 1]` 开始交代风格、人物、环境和起始构图。只有真实剪辑切镜才增加 `[Shot 2]` 等编号，并写明递增的切镜时间；连续移动机位不增加编号。
- 项目风格优先，不套用示例的真人、卡通或配乐风格。

### 4. 人物、空间与机位

- 写清人物面向的地标或对象、机位所在侧与距离、画面可见的身体面；分别描述人物运动和摄影机运动。
- 逐段继承位置、身体与头部朝向、视线、姿态、服装、持物和动作进度。需要看见正面或侧面时移动或切换机位，不让人物无故转身。
- 明确交互的发起者、对象、相对方位、指向和结果；转移目标或改变状态须有过程。切镜不重置人物动作或身份。
- 保留地标、光位、群演规模和出入画状态。同一画面同时最多三个重要人物，群演不计；整镜可以先后呈现更多人物。
- 保留上游形容词的含义与程度；适用特效写清来源、位置、强度、发生与消退，不能新增剧情。

### 5. 图片与主体绑定

- 按本镜原文与每秒指令中的名字，核对本视频项目提供的角色卡和当前集场景卡；同一意识的不同身体身份按各自角色名匹配，不混用角色图片，不跨集借用同名场景。无名字依据时不猜测别名或图片归属。
- 程序按名称匹配并提供有序 URL 列表；任一匹配角色或场景有已确认的图片 URL，即采用 reference 多模态六段结构。没有图片的主体保留文字描述，不虚构 URL；待确认图片不能作为已确认素材使用。
- URL 绑定链必须完整：角色/场景名字 → 程序列表中的真实 URL → `<Picture N>` → `<Subject N>` → 正文中该主体的动作或环境。URL 由程序随视频请求按原顺序提交，正文使用 Picture 引用，不要求视频模型通过正文中的 URL 自行取图。

- 仅使用程序提供的有序图片列表，`<Picture N>` 对应其第 N 张图片；不增删、重排或自行返回 URL 列表，不引用不存在的素材。
- 在 `subject_definitions` 中说明每个 `<Subject N>` 是谁或什么、来自哪些图片、分别参考哪些特征。主体编号与图片编号是不同体系；一个人物可同时参考主图、服装图和道具图。
- 人物主图锁定身份、面相和体型；已提供服装/道具/发型图按指定用途参考。中性角色主图的姿势与服装不自动覆盖剧情要求。
- 场景主体参考布局、地标、材质和光位；保持镜头要求的环境规模，不能只生成角色特写而丢失场景信息。
- 在 `detailed_description` 的实际动作位置复用 Subject，不能只在开头列对应关系。每张已选图片的用途都应能在正文中找到。
- `retention_analysis` 说明保留或改变的参考特征及依据，不承诺同时完全保留与剧情冲突的状态。没有真实音频/视频素材时不虚构 Audio/Video 引用。

### 6. 对白、环境声与配乐

- 发声人物使用稳定的 `(S1)`、`(S2)`；它们与视觉 Subject 编号不同。只给实际发声者编号。
- 说话人的身份、画内/画外、音色、语气和嘴部动作写在 `<d>` 外；`<d>` 内只放语言标签与原文台词，例如 `<d>[Mandarin Chinese] 等一下。</d>`。
- 画外旁白明确声源，画内对应人物嘴部保持闭合；对白跨剪辑时说明声音连续，不把同一句重复说两遍。
- 时间线保留声音发生点；`overall_soundscape` 汇总环境声、动作声与非语言人声的方向、远近、质感、强弱、遮挡和混响，不重复完整台词。
- `non_diegetic_music` 仅描述观众听到的配乐；无配乐写 N/A。环境静默与无配乐分开，不能因无配乐而删掉环境声。

### 7. 带意见修订

- 有基稿与自审失败原因或人工意见时，在基稿上定向修改，只调整明确问题及必要的连带衔接，保留无关剧情、对白和调度。
- 返回修订后的完整提示词，不只返回片段或修改说明；不从头换写整份内容。
- 新结果继续进入独立自审，只判断新结果是否解决问题、有无新冲突，不把历史意见直接重复为失败，也不自动无限重试。

## 自检

以下为生成前自查及独立审核的语义标准，不进行 JSON 字段级校验。

1. **剧情保真**：每秒指令中的关键事件、对白、反应、因果和结果有对应表达，无漏项、擅改或新增事件。
2. **时间完整**：动作顺序、切镜时点与总时长相容，起止状态能衔接上下镜，不提前演后续剧情。
3. **身份与素材**：按名字核对本镜角色和当前集场景，已有图片不能漏关联；任一已关联图片存在时须采用多模态六段结构，Picture 编号须与程序 URL 列表逐项一致。人物没有混脸或混用身体身份；所选图片用途清楚，Subject 与 Picture 的关系和正文一致，不引用未提供的素材。
4. **调度连续**：人物朝向、姿态、道具与交互目标连续；可见身体面改变有对应机位变化，不能用人物无故转向代替运镜。
5. **环境与风格**：地标、光位、场景规模、群演和适用特效未被删减或弱化，符合项目风格。
6. **声音与语言**：台词原文、说话人、声源和语言正确；嘴部状态符合画内/画外身份，声音与动作同步且无重复对白。
7. **模式与可执行性**：正文遵循程序指定模式和真实素材；分镜标签不作为画面元素；参考特征保留说明不存在自相矛盾。
8. **修订范围**：旧意见已解决，未涉及内容保持等义，修改没有破坏其他已成立的剧情或连续性。

判定规则：只报告能指出上游依据与当前内容差异的明确遗漏或冲突，并给出位置和修正要求。等义翻译、合理合并、不同措辞、段落标题排版差异及“可以更详细”不构成失败；已满足项不列入失败意见。没有实质问题即通过。

## 8. 标准返回样本

以下均为结合官方格式与项目约束编写的 **Meiji 适配样本，不是官方原始输出**。代码围栏仅用于展示，实际返回不带围栏。样本假定上游规定：4 秒、真人电影风格、旅人朝北侧拱门站立、右手持灯；第 1 秒后切到右前方，第 2 秒后切回背后，人物不转身；旅人在第 1–2 秒用中文说“等一下。”，无配乐。实际生成替换为当前输入，不照搬剧情。

### A. 文生视频：无图片

```text
integrated_multimodal_description: [Shot 1] Cinematic live-action. During the first second, a traveler in a dark coat stands in the center of a stone courtyard, facing the northern archway four meters ahead. His right hand holds a lantern at waist height; his head and eyes face the archway, and his lips are closed. The static camera is three meters south of him at a height of 1.5 meters, framing his back in a medium shot. Moonlight enters from the west and the lantern lights his right sleeve. [Shot 2] At 00:01.000, the camera cuts to a position two meters northeast of the traveler, still at eye level, showing his right-front face with the southern wall behind him. He does not turn or move his feet. The traveler, an adult man with a low, steady voice (S1), speaks on screen with synchronized lips: <d>[Mandarin Chinese] 等一下。</d> His lantern remains at his right waist. [Shot 3] At 00:02.000, the camera cuts back to the original position three meters south, restoring the view of his back and the northern archway. From two to three seconds he remains facing north, his mouth now closed. From three to four seconds he exhales softly and relaxes his shoulders slightly without stepping, turning or lowering the lantern. The ending preserves his position, northward gaze and the rear camera view. All dialogue is spoken in Mandarin Chinese. Timing instructions are not visible text.

overall_soundscape: Low wind enters through the northern archway while leaves rustle west of the courtyard. A brief metallic lantern-ring rattle ends as his grip settles, followed near the end by a quiet exhale. The sound sources stay fixed in the environment as the camera cuts.

non_diegetic_music: N/A
```

### B. 多模态：人物、场景及道具图片

仅在程序确实提供下列对应关系时使用此样本：Picture 1 为旅人人物主图，Picture 2 为庭院场景，Picture 3 为手提灯。URL 由程序按此顺序提交，不需要模型在返回文本中复述 URL。

```text
subject_definitions:
<Subject 1> is the traveler from <Picture 1>; use his facial identity, short hair and body proportions, wearing the dark coat specified by the approved timeline. The neutral reference pose is not a required performance pose.
<Subject 2> is the courtyard from <Picture 2>; use its stone paving, northern archway and southern wall as stable spatial landmarks, with the approved western moonlight.
<Subject 3> is the lantern from <Picture 3>; preserve its metal frame, handle and warm light. It is held in <Subject 1>'s right hand throughout.

summary: A four-second cinematic live-action moment in <Subject 2>. <Subject 1> waits facing the archway and asks someone to pause; camera cuts reveal his face without changing his orientation.

retention_analysis:
<Subject 1>: partially_preserved — facial identity, hair and proportions follow <Picture 1>; clothing and standing posture follow the approved timeline rather than the neutral reference pose.
<Subject 2>: partially_preserved — architecture and layout follow <Picture 2>; lighting follows the approved night setting.
<Subject 3>: fully_preserved — its appearance follows <Picture 3>, and its position remains at the traveler's right waist.

detailed_description: [Shot 1] Cinematic live-action. During the first second, <Subject 1> stands at the center of <Subject 2>, facing the northern archway four meters away. His head and eyes face north, his lips are closed, and his right hand holds <Subject 3> at waist height. The camera is fixed three meters south at a height of 1.5 meters, showing his back in a medium shot, the archway beyond him and western moonlight across the paving. The lantern warms his right sleeve. [Shot 2] At 00:01.000, the camera cuts to two meters northeast at eye level, revealing his right-front face with the southern wall behind him. His feet, body direction, gaze and lantern position do not change. <Subject 1>, an adult man with a low, steady voice (S1), speaks on screen with synchronized lips: <d>[Mandarin Chinese] 等一下。</d> [Shot 3] At 00:02.000, the camera cuts back to its original southern position, again showing his back and the northern archway. From two to three seconds his mouth is closed and his right hand holds <Subject 3> steadily. From three to four seconds he exhales and slightly relaxes his shoulders, without moving his feet, turning or changing his grip. End on this north-facing stance in <Subject 2>. All dialogue is spoken in Mandarin Chinese. No timing marks or reference labels appear as visible graphics.

overall_soundscape: Wind remains localized at the northern archway, with softer leaf rustling to the west. A short handle rattle stops as the lantern is steadied; a quiet exhale is audible near the end. These sources retain their physical locations across the cuts.

non_diegetic_music: N/A
```

### C. 首帧模式：只有程序明确提供时使用

首帧任务与上述样本的三次构图不同。此例假定已提供的首帧本身显示旅人背面，且上游要求 4 秒内保持站姿、向前推进机位、无对白。不要在没有真实首帧时套用。

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] Cinematic live-action, starting from the supplied frame. Preserve the traveler's identity, dark coat, right-hand lantern and courtyard layout. He stands facing the northern archway four meters ahead, with his lips closed. During the first second the camera holds the initial rear view three meters south of him at eye level. From one to three seconds it advances slowly along the same axis to two meters behind him, without orbiting or changing his orientation. His head, gaze, feet and lantern position remain steady. During the final second the camera stops at that distance; he exhales softly and slightly relaxes his shoulders, still facing the archway. Keep the western moonlight and warm lantern glow continuous. No dialogue.

overall_soundscape: Wind through the archway and distant leaf rustling persist. The lantern handle gives a brief metallic sound before settling; a quiet exhale is heard at the end.

non_diegetic_music: N/A
```

## 9. 官方来源与适配说明

- [文本分镜指南](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/3d-animation-short-generator/references/storyboard-guidelines.md)：提供单镜章节模板和局部面板示例；模板并非完整成片提示词，不能直接连同审稿标记提交。
- [基础模式指南](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/base-en.txt)：提供文生、首帧、首尾帧和尾帧案例。
- [多模态参考指南](https://github.com/MiniMax-AI/MiniMax-H3/blob/main/skills/h3-prompt-writing/references/ref-en.txt)：提供六段结构与主体、图片、保留分析、声音引用的写法示例。
- 查阅日期：2026-09-25。项目采用自由文本、程序固定素材顺序、配置语言、按同框计人数、定向修订与独立语义审核；以上项目要求优先于官方通用示例。
