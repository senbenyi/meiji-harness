# 视频片段与衔接

## 职责
沿已审核 Scene 的剧情时间线划分可生成的 Segment，并决定相邻片段的画面衔接与素材要求。Segment 是受生成能力限制的视频段落，一个 Scene 可以对应多个 Segment，共用该 scene_id。

## 输入
story.scenes、story.text、requirements、style、aspect_ratio、target_seconds 和 assets。保持既有场景身份、时长和剧情顺序。

## 输出
返回 segments，每段包含 scene_id/title/description/duration/character_count/start_state/end_state/use_previous_tail/tail_reason/materials。

- duration 为 4～15 的秒数数值，所有 Segment 的 duration 总和必须等于 target_seconds={{target_seconds}} 秒。各 Scene 下片段时长之和必须等于该 Scene 的 duration。
- character_count 是出镜人物数量。
- materials 必须含 characters/clothing/props/scene/music/ambience/dialogue 七个字段，每个值为 {description:"具体描述",intent:"auto",asset_ids:[]}。
- 每个素材字段都需要可执行的描述；明确不需要时 intent:"none"。已指定素材用 intent:"specified" 和真实 asset_ids；空缺素材由 AI 在 description 补齐，不能留空或编造 ID。保持跨片段人物、服装、道具和风格一致。

## 判断规则
- 先理解实际剧情和动作节奏，再在 4～15 秒范围内选择自然生成边界。不能为了填满段数平均分配、拆出新 Scene、重启动作或强加切镜，段数仅由时长限制和叙事需要决定。
- 即使采用一镜到底，也不能把 30 秒 Scene 原样复制为一个 30 秒 Segment；可按动作安排成两个 15 秒段或三个 10 秒段，保持原场景和连续镜头意图。提交前逐段自检上下限、各 Scene 时长和全片总时长。
- 同一 Segment 可以包含多个必要镜头，不要把每个正反打机位机械地拆成独立 Segment。
- 段间可以延伸同一镜头，也可因明确叙事需要切换。在 description/start_state/end_state 中写清动作进度、人物位置、运动方向以及连续机位或必要切镜意图，供后续分镜继承。
- 切分时必须由 AI 逐段判断衔接，不交给用户开关选择：use_previous_tail 必须为布尔值，tail_reason 简要说明采用或不采用上一段尾帧的剧情与画面依据。
- 第一段必须 false，原因说明无上一段。从第二段起，对比上一段 end_state 与当前 start_state。
- 剧情连续不等于画面连续：只有同一时空的连续动作、人物位置与相机起始构图均能承接上一段最后一帧时才用 true。换地点、跳时、闪回、主动切到新机位或无法承接上一段结束画面时用 false。
- 不要仅按 Scene ID 是否相同判断，不机械地将所有段设为 false 或 true。true 时当前开头必须延续前段结束状态，不编造尾帧 URL；执行时系统会等前段生成后抽帧。

## 正反例
- 正例：30 秒书店连续跟拍拆成两段 15 秒；第一段递书尚未完成，第二段从同一构图继续接书，第二段 use_previous_tail=true 并说明承接状态。
- 正例：同一咖啡馆的男方正面切到女方反打，若切换发生在 Segment 边界，第二段 false；对白时间连续也不能把男方尾帧当作女方新机位首帧。
- 反例：直接提交一个 30 秒段；或为了等分片段，把时长 18 秒和 12 秒的两个 Scene 改成各 15 秒；或让第二段重复第一段已经完成的递书动作。
