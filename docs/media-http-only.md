# 插件 HTTP 媒体约定

`dsh-elysium-tools` 仅通过 HTTP 提交工作流、读取任务历史、引用已有媒体。`dsh-elysium-ui` 的导演文本保存功能不处理媒体文件。

- 删除媒体上传客户端、下载入口、文件复制发布、SSH 媒体脚本和本地文件回传。页面保留 HTTP 预览，无下载按钮。
- `image_path`、`video_path`、`audio_path`、`video_paths` 使用当前 ComfyUI 服务或 publicUrl 下的 `/view` 地址（filename/subfolder/type）。插件将其转换为同一后端的 input/output 引用，不上传副本。其他服务及本地/SSH 路径会被拒绝。
- 分镜 `plan_path` 使用 HTTP(S) JSON 地址；在内存解析，不复制分镜素材。任务状态、参数与恢复工作流 JSON 继续保存。
- 输出从 ComfyUI history 的最终节点取得，返回 HTTP `path`/`comfyui_view_url`。无本地 path、server_path、文件大小、媒体内容哈希。产物 ID 根据服务、prompt_id 和描述符生成，不表示内容哈希。
- 不拉取产物字节进行验收；`full_decode`、`specification_match`、`human_review` 为 `not_run`。输入复用和合片需要尺寸、音轨、帧时间，FFprobe 仅通过 HTTP 流读取；不写媒体文件。
- ComfyUI 原生生成工作流仍有输出节点，产物由 ComfyUI 管理。此变更删除的是 Harness 插件中的媒体传输和副本保存能力。
- 删除 ComfyUI 输出/输入目录与 SSH 配置字段，以及插件 `ffmpeg` 设置；仅需 comfyUrl/publicUrl 和任务状态等运行配置。FFprobe 仅供需要输入时间/尺寸信息的操作使用。
- 角色姿态图不再打包上传，后端须预先存在 `input/elysium/poses/front.png`、`side.png`、`back.png`。后端节点接受带 input/output 标注的引用能力需实际服务验收；缺素材应报错，不自动上传补齐。

验证：协议测试检查无需输出目录、不请求产物字节、恢复不重复生成、HTTP 重定向及本地路径拒绝；模拟服务结果不等于 GPU 生成验收。
