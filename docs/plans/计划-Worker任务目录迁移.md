# Worker 任务目录迁移

- 类型：调研验证
- 目标：将 Server 中的任务生命周期和工作流归入 `src/worker/tasks`。
- 调研来源：`docs/research/调研-Worker任务目录迁移.md`

## 人工决策
用户已确认执行。

## 执行步骤

### 阶段 1：任务实现迁移
1. `src/server/jobs` — 修改：整体迁入 `src/worker/tasks/jobs` → AC-1、AC-2。
2. `src/server/workflows/images` — 修改：迁入 `src/worker/tasks/images` → AC-1、AC-2。
3. `src/server/workflows/videos` — 修改：视频实现迁入 `tasks/videos`，通用 worker 迁入 `tasks/runtime`，调用绑定迁入 `tasks/bindings` → AC-1、AC-2。
4. `src`、`tests`、`scripts` — 修改：重算相对导入与动态路径 → AC-3。

验证：语法检查、旧路径扫描和迁移内容比对 → AC-1、AC-2、AC-3。

### 阶段 2：架构约定与验证
1. `tests/architecture-layout.test.js`、`tests/launch-lock.test.js` — 修改：断言 Worker 任务新路径 → AC-2、AC-3。
2. `.claude/standards.md`、`README.md` — 修改：记录 Server 与 Worker 新边界 → AC-1、AC-2。

验证：专项测试、`npm test`、`npm run build`、`git diff --check` → AC-4。

## 验收标准
- AC-1：`server/jobs` 和 `server/workflows` 不再存在。
- AC-2：任务按 jobs、images、videos、runtime、bindings 职责分层。
- AC-3：源码、测试、脚本和当前文档不引用旧路径。
- AC-4：专项测试、全量测试可执行范围和构建通过。

## 验证结果
- 语法检查通过。
- 旧路径扫描通过，`src/server/jobs`、`src/server/workflows` 及对应构建目录均不存在。
- 专项测试 29/30；唯一失败为沙箱禁止 `ps`，其余任务创建、重试、恢复、媒体路由和 Harness 工具测试通过。
- 全量测试 187/188；唯一失败同为沙箱禁止 `ps`。
- `npm run build` 通过；移除无用耗时采集后，`src/worker/tasks` 与 `lib/worker/tasks` 均为 16 个文件。
