# 整理服务端 model 实施记录

## 已修改文件
- `meiji/server/models/data/drama-model.js` — 从 `shared/` 移入数据 model
- `meiji/server/models/prompts/` — 提示词 model 从 `server/prompts/models/` 移入
- `meiji/server/models/tasks/run-model.js`、`content-state.js` — 任务记录与内容节点状态转换
- 调用方 import、面板静态路径、分层测试与开发指引中的路径

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|---|---|---|
| AC-1 | 通过 | 文件位于 `server/models/data/drama-model.js`，引用已改 |
| AC-2 | 通过 | 十个提示词 model 位于 `server/models/prompts/`，story-model 等测试通过 |
| AC-3 | 通过 | `run-model.js` 与 `content-state.js` 位于 `server/models/tasks/` |
| AC-4 | 通过 | `client-files.test.js` 确认浏览器只解析 client、shared、data、tasks |
| AC-5 | 通过 | `architecture.test.js`、`status-stability.test.js` 通过 |

## 测试
相关测试 107 通过。全量 `cd meiji && npm test`：780 通过，28 失败，0 取消。失败不来自本次差异：缺少 jsdom、缺少 Harness 预设文件，以及人物图 skill 正文与既有测试期望不一致。

## 人工待办
无
