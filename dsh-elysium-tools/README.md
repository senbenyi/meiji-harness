# dsh-elysium-tools

独立的 DeepSeek Harness Model API 工具插件。安装后可在 Harness 对话中用一句话调用图片、视频和任务查询能力。

## 使用前说明

- 可以直接说“调用 `工具名`……”，也可以只描述目标，让 Harness 选择工具。
- `image_path`、`video_path` 和 `previous_video_path` 必须是服务器共享产物目录 `/root/autodl-fs/artifacts/` 内已有文件的绝对路径，不能传本机路径或网址。
- 生成和处理工具会等待任务完成，成功后返回 `job_id`、产物绝对路径、文件大小和 SHA-256。
- `seed` 相同不保证不同模型或工作流版本产生完全相同的结果。

## 工具使用

### `model_generate_image`

根据文字生成图片。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `prompt` | 是 | - | 画面描述 |
| `preset` | 否 | `standard` | `fast` 或 `standard` |
| `seed` | 否 | `666` | 随机种子 |

一句话示例：

```text
调用 model_generate_image，生成一张电影感的雨夜东京街头照片，霓虹灯倒映在路面，preset 使用 standard，seed 使用 666。
```

### `model_edit_image`

创建、重制或清理图片水印。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `operation` | 是 | - | `create`、`remake` 或 `watermark_cleanup` |
| `image_path` | 条件必填 | - | 输入图片绝对路径 |
| `prompt` | 条件必填 | - | 创建或重制时的画面描述 |
| `seed` | 否 | `666` | 随机种子 |

操作规则：

- `create`：只需要 `prompt`，不能传 `image_path`。
- `remake`：必须同时传 `image_path` 和 `prompt`。
- `watermark_cleanup`：必须传 `image_path`，不能传 `prompt`。

一句话示例：

```text
调用 model_edit_image，operation 使用 remake，输入图片 /root/autodl-fs/artifacts/projects/api-<job_id>/assets/characters/img.png，保持人物身份并改成电影灯光，seed 使用 666。
```

```text
调用 model_edit_image 清理图片 /root/autodl-fs/artifacts/projects/api-<job_id>/assets/characters/img.png 的水印，operation 使用 watermark_cleanup。
```

### `model_generate_video`

根据一张起始图片生成单段视频。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `image_path` | 是 | - | 起始图片绝对路径 |
| `prompt` | 否 | - | 视频动作、镜头和场景描述 |
| `preset` | 否 | `fast` | `fast` 或 `standard` |
| `seed` | 否 | `666` | 随机种子 |

一句话示例：

```text
调用 model_generate_video，使用图片 /root/autodl-fs/artifacts/projects/api-<job_id>/output/edited.jpg，镜头缓慢推进，人物自然眨眼，preset 使用 fast，seed 使用 666。
```

### `model_generate_long_video`

使用角色锚点图片和上一段视频继续生成长视频。该工具固定使用服务端的 `long_fast` 工作流。

| 参数 | 必填 | 说明 |
|---|---|---|
| `image_path` | 是 | 角色锚点图片绝对路径 |
| `previous_video_path` | 是 | 上一段视频绝对路径 |

一句话示例：

```text
调用 model_generate_long_video，角色图片使用 /root/autodl-fs/artifacts/projects/api-<image-job>/output/edited.jpg，接着视频 /root/autodl-fs/artifacts/projects/api-<video-job>/assets/shots/shot-01.mp4 继续生成。
```

### `model_interpolate_video`

对视频插帧，提高帧率和运动流畅度。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `video_path` | 是 | - | 输入视频绝对路径 |
| `multiplier` | 否 | `2` | 插帧倍数：`2`、`3` 或 `4` |

一句话示例：

```text
调用 model_interpolate_video，把 /root/autodl-fs/artifacts/projects/api-<job_id>/output/final.mp4 做 2 倍插帧。
```

### `model_upscale_video`

放大视频分辨率。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `video_path` | 是 | - | 输入视频绝对路径 |
| `resolution` | 否 | `720` | 目标短边，必须是偶数 |
| `max_resolution` | 否 | `1280` | 最大长边，必须是偶数；`0` 表示不限制 |
| `batch_size` | 否 | `5` | 必须满足 `4n+1`，例如 `1`、`5`、`9` |

一句话示例：

```text
调用 model_upscale_video，把 /root/autodl-fs/artifacts/projects/api-<job_id>/output/interpolated.mp4 超分，resolution 使用 720，max_resolution 使用 1280，batch_size 使用 5。
```

### `model_add_video_audio`

为视频生成并合成同步环境音和拟音；不负责对白 TTS 或配乐生成。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `video_path` | 是 | - | 输入视频绝对路径 |
| `prompt` | 否 | - | 环境音和拟音描述 |
| `steps` | 否 | `25` | 生成步数，范围 `1` 至 `100` |
| `seed` | 否 | `42` | 随机种子 |

一句话示例：

```text
调用 model_add_video_audio，为 /root/autodl-fs/artifacts/projects/api-<job_id>/output/upscaled.mp4 添加雨声、脚步声和衣物摩擦声，steps 使用 25，seed 使用 42。
```

### `model_job_status`

查询已有任务的当前状态。状态可能是 `queued`、`running`、`succeeded` 或 `failed`。

| 参数 | 必填 | 说明 |
|---|---|---|
| `job_id` | 是 | 32 位任务 ID |

一句话示例：

```text
调用 model_job_status，查询任务 c97be71c64474c228fc0fe29c2ff7da8。
```

### `model_job_result`

取得成功任务的产物元数据，包括服务器路径、文件大小、SHA-256 和结果下载接口。任务尚未成功时会返回错误。

| 参数 | 必填 | 说明 |
|---|---|---|
| `job_id` | 是 | 32 位任务 ID |

一句话示例：

```text
调用 model_job_result，取得任务 c97be71c64474c228fc0fe29c2ff7da8 的结果。
```

### `workflow_image_to_final_video`

从起始图片生成单段视频，并依次完成 2 倍插帧、720/1280 超分和环境音合成，最终返回
`output/final.mp4`。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `image_path` | 是 | - | 起始图片绝对路径 |
| `video_prompt` | 否 | 工作流默认提示词 | 视频动作、镜头和场景描述 |
| `audio_prompt` | 否 | 模型默认提示词 | 环境音和拟音描述 |
| `preset` | 否 | `fast` | `fast` 或 `standard` |
| `seed` | 否 | `666` | 视频生成随机种子 |

一句话示例：

```text
调用 workflow_image_to_final_video，使用图片 /root/autodl-fs/artifacts/projects/api-<job_id>/assets/characters/img.png，镜头缓慢推进、人物自然眨眼，添加雨声和脚步声，preset 使用 fast，seed 使用 666。
```

## 源码职责

- `src/models/`：直接调用模型能力的 Harness 工具，每个工具一个文件。
- `src/workflows/`：调用 Workflow API 的多步骤媒体工作流 Harness 工具。
- `src/index.js`：插件身份、导出和注册。

## 安装

```sh
pnpm install
pnpm test
pnpm build
pnpm package:registry
dsh plugin --profile web add --workspace-root ./registry
```
