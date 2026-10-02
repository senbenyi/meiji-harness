# 脚本迁移矩阵

> 状态：已更新
> 基线：2026-10-02
> 范围：说明测试和运维脚本如何使用新的 Project Domain。

| 脚本类别 | 迁移方式 | 验证状态 |
| --- | --- | --- |
| `smoke-tools.mjs` | 注入显式内存 Project Domain；工具数更新为 37 | 通过，128 项 |
| `smoke-assets.mjs` | 通过 `/canvas` 读模型断言，不再把新 `project.json` 当权威状态 | 通过，77 项 |
| `smoke-upload-assets.mjs` | 使用测试 Project Domain 和 adapter 读写 | 通过，41 项 |
| `smoke-preask-deliver.mjs` | 使用测试 Project Domain 验证送达状态持久化 | 通过，53 项 |
| `smoke-video-shape.mjs`、`mock-apply.mjs`、`e2e.mjs` | 明确声明测试内存存储，避免假装连接 Harness Domain Storage | 离线路径通过 |
| `audit-harness.mjs` | 从真实 `dsh` 安装树和 pnpm store 解析组合依赖 | 通过，144/144 |
| 远程 benchmark、probe、e2e 脚本 | 保留原 ComfyUI 实机职责；不得以离线结果替代 | 本次未运行 |

迁移约束：生产 `apply()` 默认必须使用 `ctx.storage.domain`；内存仓库仅能通过 `__testMemoryProjectDomain === true` 的测试注入启用。

