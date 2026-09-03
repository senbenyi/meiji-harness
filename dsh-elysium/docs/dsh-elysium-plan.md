# dsh-elysium VMP V1

## 定位

`dsh-elysium` 是 DeepSeek Harness 的单插件短剧工厂。它内置 ComfyUI 合同驱动，
但不在本机执行媒体模型。

```text
Harness 插件界面 / 聊天框
  -> dsh-elysium（生产编排 + 工作流合同 + 任务句柄 + 产物下载）
  -> 127.0.0.1:8189 隧道
  -> 远程 ComfyUI / Qwen Image / Wan2.2
```

## 固定产品契约

- 生产单版本：`vmp-1`。
- 每集严格 2 镜：`shot-01` 和 `shot-02`。
- 每个镜头生成一个 SVI 长视频，共 2 个视频；六个工作流锚点复用该镜头图。
- 最终成片可全量解码，统一为竖屏 H.264，并且时长不少于 40 秒。
- 角色仅允许已授权的虚构成年人；生成前显式确认，技术 QC 后人工完整观看。

## 插件职责

| 组件 | 负责 | 不负责 |
|---|---|---|
| `dsh-elysium` | 工厂 UI、聊天工具、工作流合同、远程提交、任务查询、产物下载、断点续跑、FFmpeg 合成、QC、人审 | 远程模型推理 |
| 远程 ComfyUI | Qwen Image 文生图、Wan2.2 六锚点长视频推理 | Harness UI、本地生产状态 |

## 完成条件

1. 本机 3080 Harness 仅安装 `dsh-elysium`，不依赖独立的 `dsh-comfyui`、
   `dsh-better-sidebar` 或 `dsh-vmp`。
2. 插件和聊天框均可创建、检查、启动、查询、恢复、精确重试和验收生产单。
3. Harness 重启后从 Elysium 持久化的 `prompt_id` 和产物路径继续，不重复成功步骤。
4. `qc_passed` 仅代表技术 QC；只有人工验收绑定当前成片哈希后，`approved` 才代表完整交付。
