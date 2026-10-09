# 拆分嵌套数据 model

- 类型：重构
- 目标：把剧情、镜头（含每秒分镜、分镜、视频、尾帧）和卡片从 `drama-model.js` 拆到 `server/models/data/` 的独立文件。
- 非目标：不改字段形状，不移动提示词 model，不改调用方 import。

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 已确认/未确认/未验收 | 依据或缺口 |
|---|---|---|---|
| AC-1 | `plot-model.js` 提供剧情树：outline、characters、scenes、props | 已确认 | `episodeModel` 内联对象 |
| AC-2 | `shot-model.js` 提供镜头表和单镜，单镜含 seconds、storyboard、video、tailFrame | 已确认 | `shotModel` 与 `episodeModel` 的 shots |
| AC-3 | `card-model.js` 提供卡片及图片节点 | 已确认 | `cardModel` |
| AC-4 | `drama-model.js` 仍导出原函数，既有 import 不用改 | 已确认 | 调用方从 `drama-model.js` 引入；图谱 impact 为 UNKNOWN，源码补查 |

## 待用户决定
无

## 改动
1. 新增 `content-node.js`、`plot-model.js`、`shot-model.js`、`card-model.js`。
2. `drama-model.js` 改为引用并转出。
3. `status-stability.test.js` 允许新文件写节点状态。

验证：`node --test tests/drama-model.test.js tests/architecture.test.js tests/client-files.test.js tests/status-stability.test.js`

## 验证结果
`node --test tests/drama-model.test.js tests/architecture.test.js tests/client-files.test.js tests/status-stability.test.js tests/story-package.test.js`：27 通过，0 失败。
