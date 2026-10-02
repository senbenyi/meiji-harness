# data 职责整理

- 类型：重构
- 目标：data 负责持久化、记录快照和存储视图；执行生命周期归 runtime，纯数据规则归 shared。
- 非目标：不改变接口、权限、生成/审核行为、任务状态语义或磁盘布局，不操作用户数据迁移。

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 调研结论 | 证据 |
|---|---|---|---|
| AC-1 | 查看 data → 不再包含操作上下文、自审流程和任务步骤执行器 | 未确认，待实施 | task-store.js:1-425 混合运行/存储，operation-context.js、review-checks.js 为运行职责 |
| AC-2 | 调用纯规则 → 位于 shared，且不引用 Node 专属 API 或 server | 未确认，待实施 | output-language、preserve-story-assets、storyboard-edit、node-skills、episode-data 前半部分 |
| AC-3 | 新模块依赖 → 无循环，无中转兼容导出；架构检查覆盖新边界 | 未确认，待实施 | architecture.test.js 当前仅旧分层；上下文必须低于存储/执行两端 |
| AC-4 | 原测试输入 → 全部业务行为与存储格式不变 | 基线已确认 | npm test 586 通过，0 失败/取消/跳过 |

## 调用链与证据

面板/会话 → task-manager/run-operation → task-store.startExecution/runStep → recordStore；项目保存 → prepareContentRecords/commitContentRecords → recordStore。prompts/generate 读取 operation-context、taskSkillSet 并写步骤快照。

GitNexus status 有效；query/context 定位 prepareChecks 与 runStep。runStep impact：95 个上游、15 个直接调用、14 个流程，critical。动态导入和传入 store 的关系用源码/rg 补查。任务取消/接口失败/回退/未发布草稿/嵌套任务必须保持。

## 待用户决定
无。

## 改动

### 阶段 1：运行与持久化分离
1. `meiji/server/data/task-store.js` — 保留 recordStore、writeSteps、readStepPrompts；执行开始/结束/步骤/尝试移入 `server/runtime/task-execution.js`；内容基线、版本与草稿快照移入 `data/content-records.js` → AC-1。
2. `server/runtime/task-context.js` — 归集 AsyncLocalStorage、当前步骤/技能和活跃任务内存表；只依赖 Node，不依赖存储/执行 → AC-1/3。
3. `server/runtime/task-state.js` — 任务动作分类、创建步骤及终态规则；无文件 IO，供运行和持久化使用 → AC-1/3。
4. `server/data/operation-context.js`、`review-checks.js` → `server/runtime/`；所有调用方直接指向新定义 → AC-1/3。
验证：引用扫描、架构测试、npm test，尤其任务快照/中止/重启/嵌套/失败回退。

### 阶段 2：纯规则归位
1. `server/data/output-language.js`、`preserve-story-assets.js`、`storyboard-edit.js`、`node-skills.js` → `shared/`；UUID 使用标准 crypto.randomUUID（不引入 Node import） → AC-2。
2. `server/data/episode-data.js` — 纯剧集构造/修改/视图规则移入 `shared/episode-rules.js`；存储作用域和封面读写保留，直接引用规则 → AC-2。
3. 全部调用方和测试按符号更新 import，不保留兼容转发；`.agents/meiji-dev.md` 同步职责和路径 → AC-3。
4. `tests/architecture.test.js` — 加入 runtime 执行层及上下文/状态叶子模块，检查 shared 不依赖 server/Node、运行叶子不向上引用，防止循环重新引入 → AC-3。
验证：每阶段 npm test；最终静态引用、循环检查、git diff --check、GitNexus detect-changes；重启 Harness、HTTP 资源验证、更新索引。

## 验证结果

- 阶段 1：588 通过，0 失败/取消/跳过（新增 2 条架构边界测试）。
- 阶段 2：588 通过，0 失败/取消/跳过。
- data 从 17 个文件整理为 12 个；task-store 专注记录读写，content-records 管版本快照，episode-data 保留作用域适配及封面存储。
- 所有静态相对引用存在；源码导入图无循环。新增边界检查约束 shared 无 Node/server 依赖，以及 runtime 上下文/状态叶子不依赖存储/执行。

- 最终验证：588/588 测试通过，233 个 JS 语法检查通过，git diff --check 通过。
- GitNexus detect-changes 完成：72 条受影响流程，critical；包含之前的未提交工作，本次差异以任务开始时备份核对。
- Harness 重启成功，面板入口、应用模块和样式均返回 HTTP 200；未进行付费模型生成及浏览器人工点击验收。
- AC-1/2/3/4 均通过；完成记录后执行最终 GitNexus 索引刷新。
