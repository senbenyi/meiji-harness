# 整理服务端 model

- 类型：重构
- 目标：在 `meiji/server/models/` 下按数据、提示词、任务归类现有 model；带状态的任务与内容状态转换放进任务。
- 非目标：不改 model 的字段、状态机语义和提示词正文；不移动网关模型配置 `meiji/models/`。

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 已确认/未确认/未验收 | 依据或缺口 |
|---|---|---|---|
| AC-1 | 数据 model 位于 `server/models/data/drama-model.js` | 已确认 | 原文件 `shared/drama-model.js`，浏览器与 shared 都引用它 |
| AC-2 | 提示词 model 位于 `server/models/prompts/` | 已确认 | 原目录 `server/prompts/models/` |
| AC-3 | 任务 model 位于 `server/models/tasks/`：`run-model.js` 与有状态的 `content-state.js` | 已确认 | 原 `shared/run-model.js`、`shared/content-state.js` |
| AC-4 | 面板仍能加载数据 model 与被 shared 引用的任务 model | 已确认 | `panel-routes.js` 只提供 client/ 与 shared/ 平铺文件；`tests/client-files.test.js` 禁止 shared 引用 server |
| AC-5 | 分层测试承认新目录，且不把内容状态写入权扩散到 flow | 已确认 | `tests/architecture.test.js`、`tests/status-stability.test.js` |

## 调用链与证据
浏览器：`client/*.js` 与 `shared/*.js` → `drama-model.js`。面板只提供这两个平铺目录，因此数据 model 与被 shared 引用的任务 model 需要单独的静态路径 `server/models/data|tasks/<文件>`。提示词 model 只在服务端组装请求，不提供给浏览器。

| 来源（文件:行） | 支持的结论 |
|---|---|
| `meiji/server/http/panel-routes.js:31` | 浏览器只加载 client/ 与 shared/ |
| `meiji/tests/client-files.test.js:46` | shared 不得引用 server，否则面板加载失败 |
| `meiji/tests/architecture.test.js:7` | 新的 server 目录必须登记分层 |
| `meiji/shared/content-state.js:1` | 内容节点状态转换集中在该文件 |

## 问题
| AC | 预期 | 实际 | 根因 |
|---|---|---|---|
| AC-1–AC-3 | model 按三类放在 server/models | 数据与任务 model 在 shared，提示词 model 在 prompts/models | 历史分层把领域 model 放在 shared |

## 待用户决定
无

## 改动
### 阶段 1：移动文件并改引用
1. `shared/drama-model.js` → `server/models/data/drama-model.js` → AC-1
2. `server/prompts/models/*.js` → `server/models/prompts/` → AC-2
3. `shared/run-model.js`、`shared/content-state.js` → `server/models/tasks/` → AC-3
4. 调用方 import 改为新路径；提示词 model 对 `server/prompts` 的相对路径同步调整 → AC-2

验证：`node --test tests/architecture.test.js tests/drama-model.test.js tests/run-model.test.js tests/story-model.test.js` — 通过

### 阶段 2：浏览器可加载边界
1. `server/http/panel-routes.js` 增加 `server/models/data` 与 `server/models/tasks` 的平铺文件响应，不公开 prompts → AC-4
2. `tests/client-files.test.js` 允许这两类引用并拒绝其它 server 路径 → AC-4
3. `tests/architecture.test.js` 登记分层：data/tasks 为叶子，prompts 与 `server/prompts` 同层互引 → AC-5
4. `tests/status-stability.test.js` 只允许数据 model 与内容状态文件写 `.status` → AC-5
5. `.agents/meiji-dev.md` 更新 model 路径

验证：`node --test tests/client-files.test.js tests/status-stability.test.js tests/architecture.test.js` — 通过

## 验证结果
- `node --test` 覆盖 architecture、client-files、status-stability、drama-model、run-model、story-model、episode-summary-model、character-image-model、scene-image-model、step-prompt-model、prompt-interfaces、text-json-output：107 通过，0 失败。
- `cd meiji && npm test`：808 项，780 通过，28 失败，0 取消。失败均为原有环境或原文：jsdom 不在本机、Harness 预设文件不存在，以及 `character-image-prompts.test.js` 期望的「不是角色设定表…」不在未改动的 `generate-character-image-skill.md` 中。本次差异未改这些文件。
