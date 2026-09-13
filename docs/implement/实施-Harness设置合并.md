# Harness 设置合并

统一使用可直接部署的 `harness/.dsh/`，包含 Harness 设置、Web profile 与 Agent presets。`settings.yaml` 使用最终值，不保留部署占位符或脚本专用区段。

`harness/scripts/install.mjs` 是本机统一安装入口：本机不存在 `dsh` 时安装 Harness，将 `harness/.dsh/` 逐项覆盖到 `~/.dsh/`，再安装、构建、打包并注册 `dsh-elysium`。`harness/scripts/start.mjs` 只负责启动本机 Harness。

远端 Harness 部署入口已删除；远端主机只保留模型服务。统一部署入口只依赖 Node.js 和 pnpm。

安装与本机启动脚本不调用模型服务器操作。ComfyUI 生命周期和 Qwen 隧道分别由服务器上的 `runpod/scripts/comfyui.mjs`、`runpod/scripts/tunnel.mjs` 人工执行。
