# dsh-elysium-tools

Harness 图片与视频生成插件，自带任务卡和“极乐世界”预设。

角色三视图使用 `character-reference` 技能：正面确认 → 参考生成侧面／背面 → 验收拼接。将 [姿态模型](https://huggingface.co/xinsir/controlnet-openpose-sdxl-1.0) 的 `diffusion_pytorch_model.safetensors` 重命名为 `xinsir-openpose-sdxl-1.0.safetensors`，放入 ComfyUI 的 `models/controlnet/`。普通图片、视频无需此模型。

## 1. 安装插件

需要 Harness、Node.js 20.16+、Python 3、FFprobe，以及具备所需模型和节点的 ComfyUI。在本插件目录执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm package:registry
dsh plugin --profile web add --workspace-root ./registry
```

## 2. 手动复制配置

1. 核对 `.dsh/profiles/web/cordis.patch.yml` 中 ComfyUI 的 HTTP 服务与浏览器访问地址。
2. 将 `.dsh/.agent-presets/elysium/` 完整复制到 `~/.dsh/.agent-presets/elysium/`。


