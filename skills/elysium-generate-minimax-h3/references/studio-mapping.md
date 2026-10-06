# Elysium Studio → H3 prompt 映射

本映射只适用于当前活动的两个视频家族：

- `elysium-minimax-h3-ref2v-{fast,balanced,quality}`
- `elysium-minimax-h3-i2v-{fast,balanced,quality}`

解析到其它实现时停止，不使用本映射。

## Ref2VA

来源：镜头表行、分镜章节、`ref_nodes`、音频与对白要求。

分镜的 `audioDialogue` 保存逐行“说话人：具体台词”，`audioNotes` 保存语气、音色、环境声及音效。Ref2VA 将对白写入 `detailed_description`，I2VA 写入 `integrated_multimodal_description`；均使用稳定说话人 `(Sx)` 与 `<d>[语言] 原文台词</d>`，只让对应说话人口型同步。声音备注写入 `overall_soundscape`。这些声音由 H3 与视频一起原生生成，不创建独立旁白产物；无对白时不编造台词，明确静音时不生成可听声音。

输出六段：

1. `subject_definitions`：每个参考图绑定的主体、服装、材质和身份特征。
2. `summary`：本镜一句话目标。
3. `retention_analysis`：必须从参考图保留的身份与环境特征。
4. `detailed_description`：按时间展开动作、构图、运镜、光线、对白和字幕。
5. `overall_soundscape`：环境声、对白位置和必要音效。
6. `non_diegetic_music`：非画内音乐；不需要时明确无。

`ref_nodes` 只传单视图、无文字、无拼图的角色卡或场景卡。

## I2VA

来源：镜头表行、分镜章节、`first_frame_node`，以及可选的 `last_frame_node`。

输出：

1. 首帧/末帧对齐指令。
2. `integrated_multimodal_description`：从首帧出发的动作、镜头、光线、对白与字幕；有末帧时说明如何自然收束。
3. `overall_soundscape`。
4. `non_diegetic_music`。

I2VA 不接收 `ref_nodes`。首末帧必须是现有图片节点；当前活动注册表没有抽帧工作流。

## 当前不支持

- `continuity_from` / latent 链式续接。
- 抽帧生成首末帧。
- 生成内放大或视频后处理超分。

不得把这些已归档能力写入 prompt 或调用计划。
