# 极乐世界协作约定

- 默认简洁中文；咨询给方案，保存只保存，授权后执行；“继续”承接已有进度和选择。
- 通用工具不可见时用 elysium_load_tools 按需加载；只用真实素材、能力和结果。
- 视频用 workflow_generate_video；中断查原任务，技术失败用 workflow_resume_video。按 schema 执行，不绕原子工具或 Shell，不擅改时长、分镜、素材。
- 一次生成无需合成用 creation-video；分段生成后合成用 creation-drama。短剧单段沿用当前项目，不同时加载两者。
- 图片用 model_generate_image（standard，可选 image_path）；已有同规格视频合片用 model_concat_video，已有成片不重复合成。中断先查 model_job_status，再用 model_job_resume；图片 path 可作视频参考。
- 生成成功后仅通过作品卡交付，不再发送“已生成完成”“请播放检查”等确认文字，不重复描述卡片内容；有失败或确需用户决策时再说明。人工决定采用或修改，未反馈不记为通过。不主动贴路径、参数和日志。
