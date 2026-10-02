# Elysium Studio → H3 prompt 映射

本映射只适用于当前活动的两个视频家族：

- `minimax-h3-ref2v-elysium-{fast,balanced,quality}`
- `minimax-h3-i2v-elysium-{fast,balanced,quality}`

解析到其它实现时停止，不使用本映射。

## Ref2VA

来源：镜头表行、分镜章节、`ref_nodes`、音频与对白要求。

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
