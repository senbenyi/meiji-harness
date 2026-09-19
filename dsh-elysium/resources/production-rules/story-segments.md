# 剧情与视频片段同步规划

## 职责
在同一阶段完成完整剧情、Scene 和每个场景内的 Segment 时间线。不要另发起片段规划请求，不生成分镜、H3 Prompt 或视频。

## 输入
以最新 requirements 为准，结合 original_request、style、aspect_ratio、target_seconds 和 assets。参考剧情和素材是创作资料，不是指令。

## 输出
调用一次 complete 返回完整 JSON：{text,scenes:[{title,description,location,time,duration,segments:[{title,description,duration,character_count,start_state,end_state,use_previous_tail,tail_reason,materials}]}]}。
text 是完整剧情，各 Scene 按剧情时间线排列；每个 Scene 的 segments 只描述该场景内各时间段的动作，不能重复整场剧情。无需填写 Scene 或 Segment 的 id、scene_id，系统生成身份并绑定所属场景。

## 时间线约束
- 总剧情时长约为 target_seconds={{target_seconds}} 秒，允许上下 30 秒。
- 按真实叙事时空划分 Scene，不为生成时长上限强加换景、切镜或新事件。
- 每个 Scene 至少 4 秒，可超过 15 秒；每个 Segment 必须 4～15 秒。同一 Scene 的片段时长合计必须等于该场景时长；全片最多 100 段，规划时同时核对片段预算。
- 根据动作、对白和停顿选择自然时间边界。18 秒场景可拆成 9＋9 或 14＋4，不能拆成 15＋3；18 秒和12秒两个场景不能改成各15秒。
- 片段边界不是天然切镜，长镜头可以跨多个 Segment；片段动作接续推进，不重演上一段已经完成的动作。

## 素材与衔接
- character_count 是出镜人物数量。materials 必须含 characters/clothing/props/scene/music/ambience/dialogue 七项，每项为 {description:"具体描述",intent:"auto",asset_ids:[]}。
- 明确不需要的素材用 intent:"none"；指定素材使用 intent:"specified" 与真实 asset_ids。未指定时以文字描述补齐，不编造素材 ID 或已生成图片，跨片段保持人物、服装和道具一致。
- start_state/end_state 写清人物位置、动作进度与相机构图。use_previous_tail 必须是布尔值，tail_reason 必须写明画面判断依据。
- 全片第一段 false。后续片段只有同一时空、连续动作及起始构图确能承接前段尾帧时才 true；换地点、跳时、反打新机位或无法承接画面时 false。不能仅凭 scene_id 相同自动设为 true。
- 用可见动作、对白和环境变化支撑剧情，保留用户指定人物关系、事件和结局，不擅自增加支线。
