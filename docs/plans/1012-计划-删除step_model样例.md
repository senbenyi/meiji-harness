# 删除 step_model 样例

- 类型：小改动
- 目标：删除 `meiji/dev_docs/step_model.json`，测试不再读取它。
- 非目标：不改任务、任务组、步骤的运行时代码，不对齐 `step_model.md` 里尚未落地的继续与修改意见设计。

## 验收标准与调研结论

| AC | 输入/状态 → 可观测结果 | 已确认/未确认/未验收 | 依据或缺口 |
|---|---|---|---|
| AC-1 | 仓库中不再有 `meiji/dev_docs/step_model.json` | 已确认 | 全库仅两处测试和一条规则引用该文件；历史计划不改 |
| AC-2 | `stage01-contracts`、`stage01-node-definitions` 不再读取该 JSON，且这两个测试通过 | 已确认 | 两个测试文件已去掉样例读取 |

## 调用链与证据

测试启动时直接 `JSON.parse` 样例文件，不经过运行时。

| 来源（文件:行） | 支持的结论 |
|---|---|
| `meiji/tests/stage01-contracts.test.js:30` | 读入样例，随后用 `node_status`、`task_status`、`step_status` 对照代码常量 |
| `meiji/tests/stage01-node-definitions.test.js:23` | 用 `node_type` 对照节点目录的目标、字段、处理器、产物、审核和前置 |
| `.cursor/rules/meiji-contracts.mdc:15` | 规则正文点名该样例 |

## 问题

| AC | 预期 | 实际 | 根因 |
|---|---|---|---|
| AC-1 | 说明以 `step_model.md` 为准 | JSON 仍在，测试把它当规格 | 样例尚未移除 |

## 待用户决定

无

## 改动

### 阶段 1：去掉样例依赖

1. `meiji/tests/stage01-contracts.test.js` — 删除样例读取；三种状态枚举改为与 `step_model.md` 一致的字面量断言 → AC-2
2. `meiji/tests/stage01-node-definitions.test.js` — 删除样例对照，保留目录自身的定位、审核一致性检查 → AC-2
3. `.cursor/rules/meiji-contracts.mdc` — 样例引用改为 `step_model.md` → AC-1
4. 删除 `meiji/dev_docs/step_model.json` → AC-1

验证：`cd meiji && node --test tests/stage01-contracts.test.js tests/stage01-node-definitions.test.js` — 两个文件通过。

## 验证结果

`cd meiji && node --test tests/stage01-contracts.test.js tests/stage01-node-definitions.test.js`：43 通过，0 失败，0 取消。`dev_docs/step_model.json` 已删除。
