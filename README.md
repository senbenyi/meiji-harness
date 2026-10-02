# dsh-short-video-studio

DeepSeek Harness 的本地 ComfyUI 图片/视频生成插件。本分支只激活根据当前 GPU 服务器配置的 Elysium 工作流；作者原始和未验证实验工作流保存在 `archive/`，不会进入运行时注册表或 npm 发布包。

## 活动工作流

活动目录 `workflows/` 只有 4 份家族清单；加载时展开为 12 个兼容的逐档运行时实现：

| capability | family | 档位 |
| --- | --- | --- |
| `image.text2image` | `qwen-image-21-t2i-elysium` | fast / balanced / quality |
| `image.image2image` | `qwen-image-21-i2i-elysium` | fast / balanced / quality |
| `video.reference2video` | `minimax-h3-ref2v-elysium` | fast / balanced / quality |
| `video.image2video` | `minimax-h3-i2v-elysium` | fast / balanced / quality |

图片使用 Qwen Image 2.1；视频使用 MiniMax H3。模型文件名、节点图、分辨率和步数以对应 manifest 为真值。
未传 `tier` 时统一使用 `fast`；`balanced` / `quality` 只有显式指定才会使用。

当前未激活：FLUX、作者原版 Qwen/H3、PDD/Sol/ctx/hires/2K 变体、抽帧和视频超分。调用方不得假设这些能力存在。

## 活动 Skills

插件只分发以下 5 个 Skill：

- `image-generate-elysium`
- `video-generate-elysium`
- `h3-prompt-writing-elysium`
- `3d-animation-short-generator-elysium`
- `brand-promo-video-generator-elysium`

所有 Skill 在首次生成前通过 `comfy_list_workflows` 核对解析结果；实现不属于 Elysium 家族时停止，不回退到已归档工作流。

## 配置

默认配置文件：`~/.dsh/dsh-short-video-studio.json`。也可以用 `DSH_SVS_CONFIG` 指定其它路径。

解析优先级：

1. `pins[capability]`
2. `tiers[capability][tier]`
3. `preferred[capability]` 家族顺序
4. 内置 Elysium 家族默认值

推荐把四个 capability 的 `preferred` 和三档 `tiers` 都显式指向对应 Elysium family/id。模型覆盖键为：

- `elysiumQwenUnet` / `elysiumQwenClip` / `elysiumQwenVae`
- `elysiumH3Unet` / `elysiumH3Clip` / `elysiumH3VideoVae` / `elysiumH3AudioVae`


## 安装与运行

```bash
dsh plugin --profile web add file:/Users/mac/ai/llm-dsh-plugins
dsh web
```

插件把活动 `skills/` 安装到 `~/.dsh/skills/`。运行中的宿主需要重启后才会重新加载工作流和 Skill。

## 验证

```bash
npm test
npm run smoke
npm pack --dry-run
```

`npm run smoke` 会验证：

- 活动目录恰好是 4 份 Elysium 家族 manifest，并展开为 12 个逐档实现；
- 四种 capability 的三档都解析到 Elysium；
- manifest 可以编译且没有残留资产占位符；
- 活动 Skill 的安装与前端工具栏契约未漂移。
