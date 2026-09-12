---
name: creation-preview
description: 预览创作：快速检查构图、人物和动作，默认约3秒、384×512。
---

# 预览创作

使用 `workflow_generate_video`，必须显式传 `profile="preview"`。

快速检查构图、人物和动作。默认 384×512、73 帧、24fps、约 3.04 秒、8 步，有声，无 RIFE。仅支持 t2va、i2va。只有用户明确选择低分辨率候选时才加 preview_variant=low-resolution；否则不传该参数。

- 先整理一版最终提示词，明确主体、动作、场景、镜头、光线和声音；只补关键缺项。咨询或修改文字不自动生成。
- 所有图片使用当前 RunPod 的 ComfyUI `/view` URL，不接受本地媒体路径，不上传、下载或保存媒体。
- t2va 不传图片；i2va 必须有 first_frame。高清的 fl2va/fl2va-loop 需 first_frame 与 last_frame，r2va 需 reference_image_1 与 reference_image_2。当前档位不支持的输入模式不能静默切档或丢弃素材，先说明并让用户选择。
- 不传 schema 未公开的时长、尺寸、采样器、步数等参数，不追加蒸馏 LoRA，不调用原子工具或 Shell 绕过工作流。通用工具不可见时用 elysium_load_tools 加载。
- 失败、超时、断网继续处理同一 job_id；用户要求恢复时只调用一次 workflow_resume_video，不改提示词或档位新建任务。只有明确创作另一个镜头才允许 new_video=true；失败恢复禁止使用。
- 按工具返回的 profile、规格和耗时说明结果，未返回的实际媒体规格不得猜测。作品由原视频卡展示，不手写媒体链接或额外作品卡；生成成功不等于画质、人物一致性或对白口型通过人工验收。
