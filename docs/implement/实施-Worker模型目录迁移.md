# Worker 模型目录迁移实施记录

## 已修改文件
- `dsh-elysium/src/worker/models/` — 完整接收原 `src/models` 的 managers、protocols 和 providers 共 92 个文件。
- `dsh-elysium/src/`、`tests/`、`scripts/` — 所有模型导入、动态路径、测试副本和构建产物路径指向 `worker/models`。
- `dsh-elysium/README.md`、`.claude/standards.md` — 更新 Worker 下的模型目录职责与路径约定。

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|----|------|--------------|
| AC-1 | 通过 | 旧目录不存在，新目录 92 个文件逐个与 Git 原内容比对通过 |
| AC-2 | 通过 | `rg` 扫描源码、测试、脚本和当前文档，无旧路径残留 |
| AC-3 | 通过（可执行范围） | 专项测试 17/17，构建通过，全量测试 187/188；剩余 1 项因沙箱禁止 `ps` 失败 |

## 人工待办
- [ ] 在允许 `ps` 的 macOS 环境复验 `tests/launch-lock.test.js`。
