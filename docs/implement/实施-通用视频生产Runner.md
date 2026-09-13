# 通用视频生产 Runner

`dsh-elysium/scripts/production-runner.mjs` 是本机生产调度入口。它读取项目清单，复用插件现有视频任务创建、恢复和等待链路，通过 HTTP 调用远端 ComfyUI；Harness 与调度状态仍只保留在本机。

《第三杯咖啡》的 `runpod/scripts/third-cup-preview.mjs` 是产品 001 的冻结制作证据，不在原文件上继续演进。

## 清单

```json
{
  "version": 1,
  "project_id": "sample-001",
  "profile": "preview",
  "max_attempts": 3,
  "shots": [
    {
      "id": "shot-001",
      "request": { "mode": "t2va", "prompt": "An empty cafe." },
      "media": {},
      "produces_anchor": { "id": "scene", "frame_index": 36 }
    },
    {
      "id": "shot-002",
      "request": { "mode": "i2va", "prompt": "Continue the cafe." },
      "media": { "first_frame": { "anchor": "scene" } }
    }
  ]
}
```

`media` 的字段由视频模式决定，值可以是服务器 HTTP(S) URL，也可以引用此前镜头产出的锚点。锚点必须先产出再引用，禁止前向依赖。清单只描述生成任务，不包含上传、下载、本地媒体路径或最终剪辑。

## 执行与恢复

```sh
COMFYUI_URL=https://example.invalid \
ELYSIUM_STATE_ROOT=/absolute/local/state \
node dsh-elysium/scripts/production-runner.mjs /absolute/project/manifest.json
```

第二个可选参数限制本次核对到前 N 镜。状态位于 `ELYSIUM_STATE_ROOT/productions/<project_id>/`，包含冻结清单、逐镜回执、尝试记录、ComfyUI history、锚点和进度。重复运行会复用已成功任务；失败任务沿用同一 `job_id` 恢复。提交状态不明或本地等待中断时停止并保留原任务，不据此自动创建新任务。

同一 `project_id` 开始执行后禁止修改清单。需要变更生成请求时应使用新的项目 ID，避免新请求错误复用旧回执。
