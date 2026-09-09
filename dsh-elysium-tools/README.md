# dsh-elysium-tools

Harness 图片与视频生成插件，自带任务卡和“极乐世界”预设。

角色三视图使用 `character-reference` 技能：正面确认 → 参考生成侧面／背面 → 验收拼接。将 [姿态模型](https://huggingface.co/xinsir/controlnet-openpose-sdxl-1.0) 的 `diffusion_pytorch_model.safetensors` 重命名为 `xinsir-openpose-sdxl-1.0.safetensors`，放入 ComfyUI 的 `models/controlnet/`。普通图片、视频无需此模型。

## 1. 安装插件

当前 SDXL 三视图分支仍会出现服装和姿态偏差，必须逐图确认；不适合无人验收的标准三视图生产。

需要 Harness、Node.js 20.16+、Python 3、FFmpeg、FFprobe，以及具备所需模型和节点的 ComfyUI。在本插件目录执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm package:registry
dsh plugin --profile web add --workspace-root ./registry
```

## 2. 手动复制配置

1. 确认 `.dsh/profiles/web/cordis.patch.yml` 中两个 ComfyUI 地址可用。
2. 将 `.dsh/.agent-presets/elysium/` 完整复制到 `~/.dsh/.agent-presets/elysium/`。

## 3. 重新加载

重新加载 Harness，新会话选择“极乐世界”。素材放在 `~/.dsh/elysium/artifacts`（使用自定义 DSH_HOME 时随之调整），输入绝对路径；中断后查询、恢复原任务。

导演分镜文件可直接传给 `workflow_generate_video`：`{"plan_path":"ssh://veo-comfyui/root/autodl-fs/productions/episode/plan.json"}`。需本机 SSH 可访问；JSON 保存完整 `duration`、`shots`，参考素材放在同目录或子目录，用相对路径引用。也支持 artifacts 内的本地 JSON；不要同时传其他参数。
