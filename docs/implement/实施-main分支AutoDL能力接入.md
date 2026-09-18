# main 分支 AutoDL 能力接入实施记录

## 已实施

- 建立独立 AutoDL provider，声明 ComfyUI 与 Qwen 双服务器契约，不依赖 Runpod provider。
- 原样迁移 main 的 RealVisXL/SDXL 文生图、参考图、角色正侧背和三视图拼接模板与姿态资产。
- 接入图片任务执行、产物解析、任务快照与恢复，并恢复角色视图和角色三视图工具。
- 接入 MiniMax H3 五种标准模式，以及 main 的 independent、continue、reference、reuse、多镜头合片导演计划。
- 增加 AutoDL 工作流同步编译器、模型目录和本机配置说明。

## 验证

- `pnpm test`：181/181 通过。
- `pnpm build`：通过。
- `pnpm package:registry`：通过。
- Harness 脚本测试：7/7 通过；安装脚本补充 workspace-root 参数后成功安装发布包。
- Harness 已重启，`http://127.0.0.1:3080/` 返回预期鉴权响应。
- 发布目录已检查包含姿态 PNG、图片模板、H3 五模式模板和导演模板。
- Qwen 服务器只读连接正常；未重启或修改两台远端服务。

## 未完成的运行验收

本机现有 `veo-comfyui` 指向已失效的 RunPod，历史 AutoDL ComfyUI SSH 入口也已拒绝连接；当前没有可验证的第二台 AutoDL 地址。因此没有写入本机 `settings.json`，避免把图片和视频新任务切换到不可达目标。拿到当前有效的 ComfyUI SSH 别名或 HTTP 地址后，还需完成：登记双服务器、切换 image/video、真实 T2I、T2V、I2V 和一次原任务恢复。
