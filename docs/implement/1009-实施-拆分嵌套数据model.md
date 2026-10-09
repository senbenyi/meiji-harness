# 拆分嵌套数据 model 实施记录

## 已修改文件
- `meiji/server/models/data/content-node.js` — 内容节点共同形状
- `meiji/server/models/data/plot-model.js` — 剧情树
- `meiji/server/models/data/shot-model.js` — 镜头表、单镜、每秒分镜、分镜、视频、尾帧
- `meiji/server/models/data/card-model.js` — 卡片
- `meiji/server/models/data/drama-model.js` — 改为引用并转出
- `meiji/tests/status-stability.test.js` — 允许新文件写节点状态

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|---|---|---|
| AC-1 | 通过 | `plotModel()` 位于 `plot-model.js` |
| AC-2 | 通过 | `shotsModel()`、`shotModel()` 位于 `shot-model.js` |
| AC-3 | 通过 | `cardModel()` 位于 `card-model.js` |
| AC-4 | 通过 | `drama-model.js` 继续导出原函数；相关测试 27 通过 |

## 测试
27 通过，0 失败，0 取消。未跑全量。

## 人工待办
无
