# 分镜

## 目标

把本集剧本切成可以逐个生成的镜头：每个镜头覆盖连续的几行剧本，写清拍什么人、用什么景别和运镜、多长、画面怎么动、第一帧长什么样。代码会把镜头块插回剧本，再编译成首帧图和视频任务。

## 输入

- series：总览。人物只用这里的角色名。
- episode：本集序号。
- numbered_lines：带临时序号的本集剧本行，例如“1. 动作：……”。镜头起始行只取这里的序号；场标题、空行不计入序号，不能按原 Markdown 的物理行号推算。序号不会保存。
- scenes：每场的场号、场景、人物、first_line 与 last_line。first_line 是该场第一条 numbered_lines 的序号，整集输出必须包含每一个 first_line 对应的镜头块。例如两场分别覆盖 1–6、7–13 行，即使第二场标题位于 Markdown 第 9 行，第二场的镜头也必须从第 7 行开始，不能从第 8 行开始。
- target_shot：单镜重写时提供目标 ID、first_line 与时长；只能输出这一个起始行的镜头，不能重新规划整集。
- correction：校验失败时提供原输出与错误；先核对 scenes 的每个 first_line，再修正并返回完整结果。
- requirements：补充要求（可为空）。

## 输出格式

只输出镜头块，按起始行从小到大排列。每块固定三行，中间不空行：

### 从第 <起始行号> 行｜<景别>｜<运镜>｜<时长> 秒｜人物：<角色名>、<角色名>
视频：<分秒动作描述，一行写完>
首帧：<English still image description, one line>

- 景别：远景、全景、中景、近景、特写、大特写、双人中景、双人近景 等。
- 运镜：固定、缓推、缓拉、跟拍、横移、摇镜、手持 等。
- 时长：整数秒。
- 空镜（画面里没有角色）省略“｜人物：…”。

## 切分规则（代码校验，违反会整份失败）

- 第一个镜头必须从第 1 行开始。
- 起始行号严格递增；一个镜头覆盖从它的起始行到下一个镜头起始行之前的所有行。
- 先按 scenes 为每个 first_line 安排一个镜头块，再在各场 first_line 与 last_line 之间添加需要的切镜；不得省略或改写任何 first_line，镜头不能跨场。最后按起始行号排序输出，不输出规划过程。
- 音效行、台词行和动作行都占一个 numbered_lines 序号。若新场的 first_line 是“音效：…”，仍必须在这一行开镜；视频和首帧描述该场当时可见的环境、人物或随后动作，不把音效写成画面，也不能把这一行归入上一场的镜头。
- 每块三行：标题行、视频行、首帧行，顺序固定，视频和首帧各自一行写完。
- 单镜重写时只输出一个镜头块。

## 写作方法

1. **切分**：一个镜头只表达一个画面意图（一个动作、一次对话来回或一个反应）；同一句台词不拆到两个镜头。按导演分镜的“单镜时长”确定每镜时长，全集时长之和接近导演规定的单集时长。
2. **台词量**：一个镜头内的台词总字数不超过“时长 × 5”，放不下就拆镜头。
3. **人物**：写本镜画面里实际出现的角色；**画面主体放第一位**，首帧按第一位的定妆图生成，写错就会换人。只在台词里被提到、画面里没出现的人不写。
4. **视频**：
   - 用“【起始–结束 秒】动作”标记时间，从 0 开始、依次递增、最后一段结束于本镜时长。
   - 只写看得见的动作、表情变化、运镜和开口时刻，例如“【1–3 秒】顾川递出旧伞，林晚在 2 秒处开口”。
   - 按导演分镜的“视频描述要求”补足风格要素（人物距离、情绪细节的时间点等）。
5. **首帧**：英文一句到两句，写第一秒的静止画面：人物用性别、年龄和服装指代（不写中文名），写位置与姿态、景别、机位角度、场景要素、光线与色调，并注明 vertical 9:16 composition。

## 质量自查

- [ ] 把 scenes 的全部 first_line 与输出标题中的起始行号逐一核对：每个 first_line（包括音效行）都有镜头；若 first_line 为 1、7，输出标题必须同时有“从第 1 行”和“从第 7 行”，不能用第 8 行替代。
- [ ] 每块正好三行，格式与上面一致。
- [ ] 人物只用总览角色名，主体在第一位。
- [ ] 视频时间段首尾相接、不超出时长；没有台词原文。
- [ ] 首帧是英文静止画面，没有中文人名。
- [ ] 每镜台词字数不超过时长 × 5；全集总时长接近导演规定。

## 不得

- 不改动、不复述剧本行，不输出剧本原文。
- 视频不写台词原文、语气、音色、角色外观、场景布置、字幕、画面文字或环境音；对白原文和音色由代码附加。
- 首帧不写动作过程、镜头运动、文字、水印。
- 不输出导语或代码围栏。

## 示例（对应“单集剧本”示例的 10 行剧本；仅示意格式，不要照抄内容）

### 从第 1 行｜全景｜缓推｜5 秒｜人物：林晚、顾川
视频：【0–2 秒】雨夜走廊，林晚抱着纸箱停在门口；【2–5 秒】隔壁门打开，顾川撑着旧伞出现，镜头缓推向两人。
首帧：A young woman in a cream cardigan holding a cardboard box stands at an apartment door in a narrow corridor, a closed door beside her, cold blue window light at the far end, rainy night, wide shot, eye level, vertical 9:16 composition.
### 从第 4 行｜双人近景｜固定｜5 秒｜人物：顾川、林晚
视频：【0–2 秒】顾川站在门里看着林晚，1 秒处开口；【2–5 秒】林晚愣住，抱紧纸箱，3 秒处开口，两人相隔一步。
首帧：A man in a charcoal coat stands in a doorway facing a young woman holding a box, one step apart, dim corridor light, medium close two-shot, eye level, vertical 9:16 composition.
### 从第 6 行｜特写｜缓推｜5 秒｜人物：顾川、林晚
视频：【0–2 秒】顾川把旧伞递向林晚，伞柄上的褪色丝带晃动；【2–5 秒】镜头推近伞柄，顾川在 3 秒处开口。
首帧：Close-up of a man's hand holding out an old umbrella with a faded ribbon on the handle toward a young woman, shallow depth of field, cool blue light, vertical 9:16 composition.
### 从第 7 行｜近景｜缓推｜6 秒｜人物：林晚
视频：【0–3 秒】旧书店内，林晚坐在窗边翻过信封；【3–6 秒】镜头推近信封背面的字迹，她的手指停住，5 秒处开口。
首帧：A young woman in a cream cardigan sits by a bookstore window holding a yellowed envelope, warm lamp light, bookshelves behind her, medium close shot, vertical 9:16 composition.
