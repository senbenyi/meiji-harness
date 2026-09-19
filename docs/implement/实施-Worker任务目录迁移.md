# Worker 任务目录迁移实施记录

## 已修改文件
- `dsh-elysium/src/worker/tasks/` — 接收原 `server/jobs` 与 `server/workflows`，删除无用 `timing.js` 后保留 16 个文件，并按 jobs、images、videos、runtime、bindings 分层。
- `dsh-elysium/src/`、`tests/`、`scripts/` — 更新任务导入、动态执行路径、代码指纹和测试路径。
- `dsh-elysium/README.md`、`.claude/standards.md` — 明确 Server 只负责 Client HTTP/共享 Store，任务生命周期归 Worker。

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|----|------|--------------|
| AC-1 | 通过 | `src/server/jobs`、`src/server/workflows` 及对应构建目录均不存在 |
| AC-2 | 通过 | `src/worker/tasks` 按五类职责分层，共 16 个文件 |
| AC-3 | 通过 | `rg` 扫描源码、测试、脚本和当前文档，无旧路径残留 |
| AC-4 | 通过（可执行范围） | 语法与构建通过；专项测试 29/30、全量测试 187/188，唯一失败为沙箱禁止 `ps` |

## 人工待办
- [ ] 在允许 `ps` 的 macOS 环境复验 `tests/launch-lock.test.js`。
