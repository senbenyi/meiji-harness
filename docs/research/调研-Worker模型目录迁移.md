# Worker 模型目录迁移调研

## 结论
AC-1 — 已确认 — `dsh-elysium/src/models` 共 92 个受版本控制文件，需整体迁入 `src/worker/models`。
AC-2 — 已确认 — 源码、测试和构建脚本存在跨目录导入，迁移时必须保留原模块指向。
AC-3 — 未验收 — 迁移后需通过插件测试、构建和旧路径扫描。

## 规格
- 目标：将完整模型运行实现从 `src/models` 迁移到 `src/worker/models`。
- 非目标：不改变模型、Provider、任务或异步执行行为。
- AC-1：旧 `src/models` 不存在，全部文件位于 `src/worker/models`。
- AC-2：运行代码、测试和脚本不再引用旧目录。
- AC-3：插件测试与构建通过。

## 调用链
`config/tools/server -> worker/models/managers -> worker/models/providers/protocols`

## 证据表
| 编号 | 来源 | 支持的结论与边界 |
|------|------|----------------|
| E-1 | `git ls-files dsh-elysium/src/models` | 迁移源包含 92 个文件 |
| E-2 | `rg` 源码、测试与脚本 | 存在跨目录导入，需机械更新 |

## 问题
| AC | 预期 | 实际 | 状态 | 根因 | 证据 |
|----|------|------|------|------|------|
| AC-1 | 模型实现归属 Worker | 位于顶层 `src/models` | 已确认 | 旧目录分层未表达 Worker 归属 | E-1 |

## 人工介入
无。

## 下一步
按确认方案整体迁移并修复导入。
