# Worker 模型目录迁移

- 类型：调研验证
- 目标：将完整 `src/models` 归入 `src/worker/models`，不改变运行行为。
- 调研来源：`docs/research/调研-Worker模型目录迁移.md`

## 人工决策
用户已确认整个 `src/models` 迁入 `src/worker`。

## 执行步骤

### 阶段 1：目录与导入迁移
1. `dsh-elysium/src/models` — 修改：整体迁移为 `src/worker/models` — AC-1。
2. `dsh-elysium/src`、`tests`、`scripts` — 修改：旧相对导入 → 指向迁移后的同一模块 — AC-2。

验证：扫描旧路径并执行语法检查 — 旧目录和运行导入无残留 — AC-1、AC-2。

### 阶段 2：架构约定与验证
1. `.claude/standards.md` — 修改：顶层 models 规范 → worker/models 规范 — AC-1。
2. `dsh-elysium/tests/architecture-layout.test.js` — 修改：旧布局断言 → Worker 布局断言 — AC-1、AC-2。

验证：`node --test dsh-elysium/tests` 与 `npm --prefix dsh-elysium run build` — 全部通过 — AC-3。

## 验收标准
- AC-1：旧 `src/models` 不存在，全部文件位于 `src/worker/models`。
- AC-2：运行代码、测试和脚本不再引用旧目录。
- AC-3：插件测试与构建通过。

## 验证结果
- AC-1：通过。`src/models` 已不存在，`src/worker/models` 包含全部 92 个原文件。
- AC-2：通过。源码、测试、脚本和当前文档中无 `src/models` 或 `lib/models` 残留。
- AC-3：通过可执行范围。Provider/架构专项 17/17 通过，构建通过，全量测试 187/188 通过；唯一失败为沙箱禁止 `ps` 导致的已知 worker 身份测试环境限制。
