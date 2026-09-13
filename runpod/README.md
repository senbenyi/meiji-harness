# RunPod 模型服务

`runpod/` 只负责远端模型服务运维和 RunPod 生产脚本。

## ComfyUI

在 ComfyUI 服务器执行：

```sh
node runpod/scripts/comfyui.mjs check
node runpod/scripts/comfyui.mjs start
node runpod/scripts/comfyui.mjs stop
node runpod/scripts/comfyui.mjs restart
```

ComfyUI 目录为 `/workspace/runpod-slim/ComfyUI`，端口为 `8188`，日志写入 `/workspace/runpod-slim/comfyui.log`。

## Qwen 隧道

在需要连接 Qwen 的服务器执行：

```sh
node runpod/scripts/tunnel.mjs qwen
```

执行前需在该服务器配置可用的 `veo-qwen38` SSH 目标。隧道将服务器本机 `127.0.0.1:18000` 转发到 Qwen 服务的 `127.0.0.1:8000`。

## 生产脚本

`runpod/scripts/third-cup-preview.mjs` 是《第三杯咖啡》的冻结制作入口，使用说明见 [制作资料](../docs/implement/third-cup-preview/README.md)。
