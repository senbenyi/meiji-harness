# Worker 任务目录迁移调研

## 结论
- AC-1 — 已确认 — `server/jobs` 和 `server/workflows` 共 17 个文件，均属于 Worker 任务运行时。
- AC-2 — 已确认 — `videos/launcher.js`、`worker.js`、`worker-owner.js` 是图片与视频共用运行时，`call-binding.js` 是 Harness 调用绑定。
- AC-3 — 未验收 — 迁移后需验证路径、worker 身份、任务执行和构建。

## 规格
- 目标：将任务生命周期与工作流从 Client Server 分离到 `src/worker/tasks`。
- 非目标：不改变任务同步等待、重试、恢复或模型执行行为。
- AC-1：`server/jobs` 和 `server/workflows` 不再存在。
- AC-2：任务按 jobs、images、videos、runtime、bindings 职责分层。
- AC-3：源码、测试、脚本和当前文档不引用旧路径。
- AC-4：专项测试、全量测试可执行范围和构建通过。

## 调用链
`tools/server routes -> worker/tasks -> worker/models -> database`

## 证据表
| 编号 | 来源 | 支持的结论与边界 |
|------|------|----------------|
| E-1 | `src/server/jobs` | 任务创建、查询、锁、等待、诊断和路径 |
| E-2 | `src/server/workflows` | 图片、视频编排与通用 worker 运行时 |

## 问题
| AC | 预期 | 实际 | 状态 | 根因 | 证据 |
|----|------|------|------|------|------|
| AC-1 | Server 只承担 Client 服务 | 任务运行时位于 Server | 已确认 | 旧目录边界混合 | E-1、E-2 |

## 人工介入
无。

## 下一步
按用户确认的 Worker 分层迁移。
