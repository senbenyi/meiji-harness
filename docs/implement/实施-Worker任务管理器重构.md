# 实施-Worker 任务管理器重构

日期：2026-09-19

## 目标

按「会话入口 → 工具 → 任务管理器 → 模型层 → 工作卡 → 人工重试」重建结构，提供集中的任务管理器，统一任务受理、模型路由、执行与结果汇总；磁盘任务格式不变，旧任务无需迁移。

## 结构

| 目录 | 职责 |
|---|---|
| `src/session/` | 预设识别、会话事件解析（已加载工具、本轮失败、用户重试意图）、每轮工具投影、创作提示词 |
| `src/tools/` | 工具参数 schema；执行只调用 `worker/index.js` |
| `src/worker/index.js` | worker 唯一门面 |
| `worker/manager/` | `submitTask` / `retryTask` 流水线与复用、重试策略 |
| `worker/intake/` | 媒体工具名单、调用 ↔ 任务绑定、会话锁、自由模式工作区 |
| `worker/routing/` | 自有优先、三方回退、质量档位、计划校验 |
| `worker/store/` | 路径、任务记录、状态机（`status.json` 唯一写入口）、锁、媒体保存与登记 |
| `worker/runner/` | launcher、worker 进程、`executeTask`、TaskContext、进程归属、等待 |
| `worker/results/` | 结果摘要（Agent、工作卡、素材库共用）、代码指纹 |
| `worker/models/` | `contract.js`、`catalog/`、`protocols/`、`providers/`；不导入 worker 上层 |

依赖方向由 `tests/architecture-layout.test.js` 强制；模型层入口与 provider 边界由 `tests/provider-boundary.test.js` 强制。

## 关键变更

- 图片与视频共用一条流水线；图片采用视频的会话锁、复用与重试规则，恢复工具需用户明确要求。
- `submitTask` / `retryTask` 只返回任务句柄；Agent 工具自行等待，工作卡按钮不等待。
- Provider 统一为 `executeJob(plan, backend, ctx)`，经 TaskContext 写状态、保存产物、读取 `job:` 参考图。
- 三份 ComfyUI 执行器合并为 `protocols/comfyui/runner.js`；AutoDL 图片与 H3 导演计划也获得网络瞬断有限重试。
- `createJob` 必须接收路由结果，不再自行回退默认后端。
- 工作卡失败时显示「重试原任务」，调用 `POST /media/retry`（按会话调用定位，点击即同意）。
- worker 进程入口改为 `worker/runner/process.js`；进程归属识别同时接受旧路径，升级前启动的 worker 不被误判。
- 代码指纹改为按目录扫描执行相关代码与当前 provider。
- 删除无调用方的参考帧提取（`extractReference` / `extractBackendReference`、`protocols/comfyui/reference-frame.js`、百炼 `media.js`）。

## 验证

- 插件测试 199/199（新增 `task-manager.test.js`、`job-status.test.js`、依赖方向、工作卡重试与重试接口用例）。
- Harness 测试 10/10；构建、Registry 打包、`lib/index.js` 加载通过。
- 未做：真实服务器端到端生成与工作卡重试的人工验收。
