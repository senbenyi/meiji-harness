# SQLite 任务存储实施记录

## 已修改文件
- `meiji/server/data/schema.sql` — projects、task_groups、tasks、task_steps、command_requests、notification_outbox、schema_migrations 七表；外键、序号唯一和单运行任务索引。
- `meiji/server/data/sqlite-store.js` — Node 内置 SQLite，WAL/FULL/外键，版本检查、增量写入、原子事务与一致读取。
- `meiji/server/data/model-repository.js` — 删除旧分代读写，实现 SQLite 唯一持久化，保留幂等、终态保护、事件发布和项目串行；拒绝未清理的旧分代数据。
- `meiji/server/runtime/app-runtime.js` — 数据库定位于 Meiji 数据根，卸载时关闭连接。
- `meiji/shared/task-labels.js`、`meiji/client/history-ui.js` — 移除无父组任务的虚拟组兼容，历史直接使用持久化三级结构。
- `meiji/package.json`、`meiji/package-lock.json` — 声明支持 node:sqlite 的 Node 版本要求；当前 Node 已内置 SQLite，不引入额外数据库依赖。
- `meiji/tests/stage02-sqlite.test.js` — 新增数据库约束、跨连接版本冲突和实际进程中断回滚/提交测试。
- `meiji/tests/stage02-commit-recovery.test.js`、`stage02-storage.test.js` — 从旧 CURRENT 发布断点改为 SQLite 事务断点及数据库断言。
- `meiji/tests/stage07-history.test.js`、`stage07-panel.test.js`、`stage07-ui-restore.test.js`、`stage08-lifecycle.test.js` — 测试数据使用真实父组，启动测试使用实际数据库布局。
- `meiji/README.md`、`.agents/meiji-dev.md`、对应计划 — 同步存储、运行、验证及不迁移规则。

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|---|---|---|
| AC-1 | 通过 | 三层表与四张支撑表存在，外键、同组序号、步骤序号、项目单 running 约束测试通过 |
| AC-2 | 通过 | 七个提交断点、两项真实进程退出、跨连接冲突、幂等与不可变历史测试通过 |
| AC-3 | 通过 | 按用户最新要求删除旧项目/任务历史及项目媒体/绑定，初始化空 SQLite；没有迁移或双写 |
| AC-4 | 通过 | 任务串行、组继续、取消、晚到结果、重启恢复及通知测试全通过 |
| AC-5 | 通过 | Harness PID 17438 持有真实库，登录后项目 API HTTP 200 / 空列表，浏览器空片库可创建项目 |

## 测试
- 基线：206 通过、0 失败、0 cancelled。
- 最终全量：210 通过、0 失败、0 cancelled，`/tmp/meiji-sqlite-final.log`。
- 中间测试发现并修正旧 fixture 无父组，以及清理测试对迁移脚本的旧规则；用户取消迁移后移除临时迁移代码与测试，恢复禁止迁移脚本的原规则。
- 数据库：SQLite 3.51.0，WAL，integrity_check=ok，foreign_key_check=0；六张业务表为空，schema_migrations=1。
- 真实库：`/Users/tom/.dsh/storages/meiji/meiji.sqlite`；原生 Node SQLite 当前发出 experimental 提示，不影响实测运行。
- `git diff --check` 通过。图谱变更分析完整（无 partial/truncated），存储及历史入口风险已报告；索引更新成功（4.4 秒，2,979 nodes / 8,393 edges / 192 flows）。分析器提示流程枚举有预算截断，未将未列出的流程解释为无影响；源码核对与全量测试作为补充证据。
- 没有调用生产 AI 或收费图片/视频接口；相关业务验证使用既有隔离测试。

## 本机数据清理
按用户明确要求删除 Meiji 数据根下 projects、media、session-projects、bindings-v1.json、workspace-links.json。保留独立 assets、模型配置与 Harness 全局会话记录。新项目由应用重新创建。

## 人工待办
无。
