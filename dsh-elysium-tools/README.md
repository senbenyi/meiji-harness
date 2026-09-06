# dsh-elysium-tools

独立的 DeepSeek Harness Function Call 工具插件。安装后可在 Harness 对话中用一句话调用图片、视频、工作流和任务查询能力。

调用链为 `Harness → dsh-elysium-tools → llm-ai-model/scripts/endpoint|workflow`，不依赖额外 HTTP 服务。

## 使用前说明

- 可以直接说“调用 `工具名`……”，也可以只描述目标，让 Harness 选择工具。
- `image_path`、`reference_path` 和 `video_path` 必须是服务器共享产物目录 `/root/autodl-fs/artifacts/` 内已有文件的绝对路径，不能传本机路径或网址。
- 生成和处理工具会直接执行服务器脚本并等待完成，成功后返回 `job_id`、产物绝对路径、文件大小和 SHA-256。
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

### `model_generate_long_video`

使用角色锚点图片和 1..6 段提示词执行 Wan2.2 Remix v3 + SVI2Pro。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `image_path` | 是 | - | 角色锚点图片绝对路径 |
| `prompts` | 是 | - | 1..6 条连续视频提示词 |
| `preset` | 否 | `long_mvp_preview` | `long_mvp_preview` 或 `long_mvp_final` |
| `seed` | 否 | `666` | 随机种子 |

一句话示例：

```text
调用 model_generate_long_video，角色图片使用 /root/autodl-fs/artifacts/projects/tool-<image-job>/assets/characters/img.png，prompts 依次为“缓慢转身”“走向窗边”“回头看向镜头”，preset 使用 long_mvp_preview。
```

### MiniMax H3 三个独立工具

| 工具 | 脚本 | 输入 |
|---|---|---|
| `model_generate_minimax_h3_t2va` | `generate_minimax_h3_t2va.sh`（文字生成带声音的视频） | `prompt` |
| `model_generate_minimax_h3_fl2va` | `generate_minimax_h3_fl2va.sh`（图片生成带声音的视频） | `prompt`、`image_path` |
| `model_generate_minimax_h3_ref2va` | `generate_minimax_h3_ref2va.sh`（参考图片、视频或音频生成音视频） | `prompt`，另至少一项参考图、视频或音频 |

均支持 `seed`（默认 666），无需 `mode` 参数。参考字段为 `image_path`、
`video_path`、`audio_path`，文件必须位于服务器共享 artifacts 目录。
分辨率、时长、采样步数和编码参数使用服务端默认值。
三个脚本固定模式，共用 `generate_minimax_h3.sh`（统一入口：T2VA 文字生成音视频、FL2VA 图片生成音视频、REF2VA 参考图片/视频/音频生成音视频）。
原 `model_generate_minimax_h3_video` 工具由这三个工具替代。

```text
调用 model_generate_minimax_h3_t2va，生成一艘纸船在晨光水面缓慢前进并带有自然水声的视频，seed 使用 666。
```

### `model_interpolate_video`

对视频插帧，提高帧率和运动流畅度。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `video_path` | 是 | - | 输入视频绝对路径 |
| `multiplier` | 否 | `2` | 插帧倍数：`2`、`3` 或 `4` |

一句话示例：

```text
调用 model_interpolate_video，把 /root/autodl-fs/artifacts/projects/tool-<job_id>/output/final.mp4 做 2 倍插帧。
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
调用 model_upscale_video，把 /root/autodl-fs/artifacts/projects/tool-<job_id>/output/interpolated.mp4 超分，resolution 使用 720，max_resolution 使用 1280，batch_size 使用 5。
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
调用 model_add_video_audio，为 /root/autodl-fs/artifacts/projects/tool-<job_id>/output/upscaled.mp4 添加雨声、脚步声和衣物摩擦声，steps 使用 25，seed 使用 42。
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

取得成功任务的产物元数据，包括服务器路径、文件大小和 SHA-256。任务尚未成功时会返回错误。

| 参数 | 必填 | 说明 |
|---|---|---|
| `job_id` | 是 | 32 位任务 ID |

一句话示例：

```text
调用 model_job_result，取得任务 c97be71c64474c228fc0fe29c2ff7da8 的结果。
```

### `workflow_adult_short_video`

执行唯一生产链：RealVisXL 首帧、IP-Adapter 人物一致性、Wan2.2 Remix v3、
SVI2Pro、RIFE、SeedVR2、MMAudio 和可选 FishAudio，返回 `output/final.mp4`。

工作流与模型任务共用插件本地任务记录；断线后可继续使用 `model_job_status` 和
`model_job_result` 查询。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `image_prompt` | 是 | - | 成年人物首帧提示词 |
| `video_prompts` | 是 | - | 1..6 条连续视频提示词 |
| `reference_path` | 否 | - | 虚拟或已授权成年人物参考图 |
| `audio_prompt` | 否 | 模型默认提示词 | 环境音和拟音描述 |
| `dialogue` | 否 | - | FishAudio 对白文本 |
| `preset` | 否 | `fast` | `fast` 或 `standard` |
| `seed` | 否 | `666` | 视频生成随机种子 |
| `authorized_adults` | 是 | - | 必须为 `true` |

一句话示例：

```text
调用 workflow_adult_short_video，首帧为 25 岁虚拟成年女性的写实电影画面，video_prompts 依次为“缓慢转身”“走向窗边”“回头看向镜头”，添加室内环境音和对白“今晚的月色真美”，preset 使用 fast，seed 使用 666，authorized_adults 为 true。
```

## 源码职责

- `src/models/`：直接调用 `scripts/endpoint/` 的 Harness 工具，每个工具一个文件。
- `src/workflows/`：直接调用 `scripts/workflow/` 的多步骤媒体工作流 Harness 工具。
- `src/index.js`：插件身份、导出和注册。

## 安装

```sh
pnpm install
pnpm build
pnpm package:registry
dsh plugin --profile web add --workspace-root ./registry
```
