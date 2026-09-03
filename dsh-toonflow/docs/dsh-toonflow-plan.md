# dsh-toonflow VMP V1

## 定位

`dsh-toonflow` 是 DeepSeek Harness 的短剧生产界面和聊天编排层，不执行模型、
不执行媒体模型。它只调用 `dsh-comfyui` 暴露的合同制生成与任务工具。

```text
Harness 插件界面 / 聊天框
  -> dsh-toonflow（生产单、12 镜编排、续跑、QC、人审）
  -> dsh-comfyui（工作流合同、任务句柄、产物下载）
  -> 127.0.0.1:8189 隧道
  -> 远程 ComfyUI / Qwen Image / Wan2.2
```

## 固定产品契约

- 生产单版本：`vmp-1`。
- 每集严格 12 镜：`shot-01` 到 `shot-12`。
- 每 6 镜形成一个长视频块，共 2 块。
- 最终成片可全量解码，统一为竖屏 H.264，并且时长不少于 40 秒。
- 角色仅允许已授权的虚构成年人；生成前显式确认，技术 QC 后人工完整观看。

## 插件职责

| 组件 | 负责 | 不负责 |
|---|---|---|
| `dsh-toonflow` | 工厂 UI、聊天工具、12 镜状态、断点续跑、FFmpeg 合成、QC、人审 | 模型推理、ComfyUI 工作流内部结构 |
| `dsh-comfyui` | Qwen/Wan 工作流合同、远程提交、任务查询、产物下载 | 短剧业务判断、12 镜约束、成片状态 |
| 远程 ComfyUI | Qwen Image 文生图、Wan2.2 六锚点长视频推理 | Harness UI、本地生产状态 |

## 完成条件

1. 本机 3080 Harness 仅安装 `dsh-comfyui` 与 `dsh-toonflow`，不依赖独立的
   `dsh-better-sidebar` 或 `dsh-vmp`。
2. 插件和聊天框均可创建、检查、启动、查询、恢复、精确重试和验收生产单。
3. Harness 重启后从 Toonflow 持久化的 `prompt_id` 和产物路径继续，不重复成功步骤。
4. `qc_passed` 仅代表技术 QC；只有人工验收绑定当前成片哈希后，`approved` 才代表完整交付。
