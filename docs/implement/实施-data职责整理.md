# data 职责整理实施记录

## 已修改文件

- `meiji/server/data/task-store.js` — 从 425 行拆分为约 92 行，保留任务/提示词/内容记录文件读写、写步骤记录和重启记录取消更新。
- `meiji/server/data/content-records.js` — 集中基线、内容版本、发布标记、草稿快照；保持项目文件写入前准备、写入后发布的顺序。
- `meiji/server/runtime/task-execution.js` — 任务开始、执行步骤/尝试、结束与取消。
- `meiji/server/runtime/task-context.js` — 当前任务上下文、活跃任务内存表、当前步骤及冻结技能，不依赖存储或执行器。
- `meiji/server/runtime/task-state.js` — 无 IO 的操作分类、步骤创建和终态规则，供存储及执行共用。
- `meiji/server/runtime/operation-context.js`、`review-checks.js` — 从 data 移入运行职责目录。
- `meiji/shared/output-language.js`、`preserve-story-assets.js`、`storyboard-edit.js`、`node-skills.js` — 从 data 归入纯规则；UUID 用标准 crypto.randomUUID。
- `meiji/shared/episode-rules.js` — 剧集构造、修改与项目/剧集视图转换；`server/data/episode-data.js` 保留存储作用域适配和封面文件读写。
- 全部受影响业务模块、脚本与测试 — 按符号直接引用新定义，无旧路径兼容转发。
- `meiji/tests/architecture.test.js` — 登记 runtime 分层，新增上下文/状态叶子独立性及 shared 无 Node/server 依赖检查。
- `.agents/meiji-dev.md` — 更新目录职责、依赖规则及调用链。

## 验收标准核对

| AC | 状态 | 验证方式与证据 |
|---|---|---|
| AC-1 | 通过 | data 由 17 个文件整理为 12 个，执行生命周期、操作上下文、自审流程移出 |
| AC-2 | 通过 | 5 个 shared 规则模块不含文件 IO 或 Node import；对应既有测试通过 |
| AC-3 | 通过 | 静态相对模块引用均可解析；导入图无循环；新增架构边界测试通过 |
| AC-4 | 通过 | 基线 586 项、最终 588 项全部通过；存储路径/schema/协议未改 |

## 测试

- 基线：586 通过、0 失败/取消/跳过。
- 阶段 1、阶段 2、最终：588 通过、0 失败/取消/跳过。
- 233 个 JS 文件 node --check 通过，git diff --check 通过。
- GitNexus detect-changes 已运行；其包含之前未提交工作，以本次工作区备份对比界定改动范围。
- Harness 重启成功，面板入口/应用模块/样式均 HTTP 200。
- 未进行真实付费生成及浏览器人工点击验收。

## 人工待办

已打开的面板刷新以加载当前模块。
