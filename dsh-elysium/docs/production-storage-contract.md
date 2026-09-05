# 生产存储契约

**状态：** P2 交付，随 P4 端到端基线复核
**上游依据：** [`ai-native-factory-rollout.md`](./ai-native-factory-rollout.md) §3 P0-3、§11；[执行计划](./ai-native-factory-execution-plan.md) P2

本文件定义三个存储根各自的**所有权、生命周期与清理策略**，以及"零上传"在什么条件下才成立。

## 1. 三个根，三个所有者

| 根 | 所有者 | 内容 | 生命周期 |
|---|---|---|---|
| `<artifactsRoot>/api-<job_id>/`<br>默认 `/root/autodl-fs/artifacts/projects/` | **模型侧**（`llm-ai-model`） | 单次 job 的执行工作区与 receipt | 按 job 存在，可按保留期清理 |
| `<workspace>/projects/<projectId>/episodes/<episodeId>/` | **插件侧**（`dsh-elysium`） | manifest、剧本、任务、产物、receipt | 跟随 episode，用户删除才消失 |
| `comfyui.sharedInputRoot` | **ComfyUI**（外部） | 推理输入的寻址空间 | 缓存性质，可随时清空重建 |

### 为什么不合并成一个根

上游方案提议统一到 `/root/autodl-fs/productions/<episode-id>/`，现状是模型侧按 `api-<job_id>` 组织。两者语义不同：前者按**业务实体**，后者按**任务**。

**决定：并存，不合并。** 让模型侧按 episode 组织目录，等于要求 model API 认识"剧集/章节/分镜"——那正是 CLAUDE.md 禁止下沉到模型层的业务编排。插件侧通过**引用**（路径 + sha256）指向模型侧产物，或从中固化副本，两层因此都不需要知道对方的组织方式。

### 清理策略

- **模型侧工作区**可以按保留期清理，前提是插件侧已固化副本并记下 `outputHash`。清理前必须确认引用方已不再依赖原路径。
- **插件侧 episode 目录**只追加不覆盖：产物按版本追加，`adoptedVersionId` 决定当前采用。清理等于丢失可追溯性，只能由用户显式删除 episode。
- **ComfyUI 共享输入区**是缓存，可随时清空——插件会在下次用到时重新落入。

## 2. Receipt 的位置与归属

每个产物旁边一份 receipt，schema 见 `llm-ai-model/contracts/receipt-schema-v1.json`：

| 产出方 | receipt 位置 | `producedBy` |
|---|---|---|
| model API | `<job_dir>/receipt.json` | `model-api` |
| 插件 | `<产物路径>.receipt.json` | `plugin-local` |

**当前插件生产链路上的 receipt 全部是 `plugin-local`**：插件只直连 ComfyUI，不经过 model API，因此没有远端 receipt 可消费。这一点等插件真正走 model API 路由（P5）才会变。

## 3. 零上传：什么条件下才成立

"上传次数为 0"不是一个可以无条件宣称的指标。插件与 ComfyUI 之间是否共享文件系统，决定它能不能成立：

| 部署形态 | 能否零上传 | 走哪条路 |
|---|---|---|
| 插件与 ComfyUI 同机，或挂载同一存储 | **能** | 配置 `comfyui.sharedInputRoot`，注入路径引用 |
| 远程 ComfyUI，仅 HTTP 隧道（CLAUDE.md 的默认形态） | **不能** | 回落到 `/upload/image` |

### `comfyui.sharedInputRoot`

含义是"**本地看得到、且就是 ComfyUI `input/` 的同一个目录**"。留空（默认）保持既有上传行为。

配置后 `ingestMedia` 的行为：

1. 产物已在共享区内 → 直接注入相对路径（`shared-path`），零字节流动
2. 产物在区外 → 先落进 `<root>/elysium/<来源哈希>-<文件名>`，再注入相对路径（`shared-copy`）；这是文件系统内的复制，不走 HTTP
3. 节点是 base64 类型 → 仍走 base64，共享区不参与

来源哈希取自绝对路径，避免不同 episode 的同名产物（如 `frame.png`）互相覆盖。

**不要在不共享文件系统的部署上配置它**——注入的路径 ComfyUI 读不到，会变成一个比上传更难排查的失败。

## 4. production-manifest

一次生产请求只允许一份 manifest，实现见 `src/domain/production-manifest.js`。

- `storyHash` 只覆盖语义内容（intent、directorStyle、characters、scenes、shots）。改提示词或结构会换 hash，改任务状态、授权时间不会。
- `manifestVersion` 只在 `storyHash` 变化时递增，`manifestId` 由 `storyHash` 前 16 位派生。
- 两者合起来是状态转换的幂等键：**重复确认不会重复创建章节或重新生成已通过的资产**。
- `capabilityPlan` 照搬既有任务图的依赖拓扑，不另建一套调度语义。

`validateManifest` 会重算 `storyHash` 并比对，因此被部分更新过的 manifest 会被直接拒绝。

## 5. 尚未落实的部分

- manifest 目前是**可派生的**（`manifestFromEpisode`），但还不是运行时的唯一事实源——生产仍以 `episode/plan/tasks` 为准。切换事实源属于 P6，需要先有一句话入口来产生 manifest。
- 模型侧 receipt 的消费要等插件走 model API 路由（P5）。
- `/root/autodl-fs/productions/` 这一层在插件运行于服务器时才等同于插件侧 episode 目录；本机开发时插件用本地 `elysium-workspace`。
