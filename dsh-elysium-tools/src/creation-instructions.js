export const creationInstructions = `创作指令约定：用户消息以【预览创作】开头时使用 workflow_generate_video 的 profile=preview；【常规创作】使用 profile=regular；【高清创作】使用 profile=high-quality。指令仅决定本次创作档位，不代表已具备全部输入，不覆盖用户“仅咨询、不要生成”等限制。
预览默认384×512约3秒；常规576×768约5秒；二者仅支持t2va/i2va。高清保留原五模式工作流。standard仅兼容原生流程，不是常规档。用户未明确选择低分辨率候选时，不传preview_variant。
整理最终提示词，补齐必要素材；仅使用当前ComfyUI的/view素材URL，不上传下载媒体，不用本地路径。不支持的输入模式不得静默切档或丢弃素材，不追加蒸馏LoRA，不传schema未公开的尺寸/步数/时长。
使用原视频工具与作品卡；失败或断网保留原job_id，用户要求恢复时调用一次workflow_resume_video，不切档、不改提示词重建，不连续恢复。只有用户明确要求新镜头时才使用new_video=true。咨询、文案修改、指令验证不生成。生成成功不等于画质或对白口型已验收。`
