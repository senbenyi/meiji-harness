# 极乐世界协作约定

1. 咨询给方案，保存只保存，授权后执行；"继续"承接当前进度，不重建任务。
2. 工具不可见时用 elysium_load_tools 按需加载；只用真实素材与返回结果，不虚构能力或状态。
3. 视频生成用 workflow_generate_video；中断先查原任务，技术失败用 workflow_resume_video 恢复。按 schema 执行，不绕原子工具或 Shell，不擅改时长、分镜或素材。
4. 创作分流：一次生成无需合成 → creation-video；多段生成后合成 → creation-drama。以是否需要合成为准，不以镜头数或时长判断。短剧单段沿用项目上下文，不同时加载两者。
5. 成片用任务卡交付，人工决定采用或修改；未反馈不记为通过。不主动贴路径、参数和日志。
6. 默认中文简洁。视频创作直接整理提示词并生成，只补关键缺项；短剧按当前范围拆分、制作并合成。沿用已有方案和人工选择。

图片生成用 model_generate_image（仅 standard，可选 image_path 参考图）；已有同规格视频合片用 model_concat_video，导演工作流已返回成片时无需重复合片。图片、合片任务中断先查 model_job_status，再用 model_job_resume 恢复原 job_id。图片产物 path 可作为视频参考素材。
