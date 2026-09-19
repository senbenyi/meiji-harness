# AI 自动规划 Segment 衔接

- 类型：功能调整
- 目标：由 AI 在拆分时决定是否沿用前段尾帧，移除手动开关。
- 调研来源：`docs/research/调研-AI自动规划Segment衔接.md`
- 人工决策：无。

## 执行步骤

1. 修改 `dsh-elysium/src/server/projects/production.js` 的 segments 指令及 complete 校验，要求 AI 输出 use_previous_tail/tail_reason；修改 `src/database/schemas/production.js` 保存原因；修改 `src/tools/project/production.js` 的编辑工具说明，让对话调整时一起更新决定和原因。→ AC-1/3
2. 修改 `src/client/workbench/segment-editor.js`，移除 checkbox，展示 AI 规划方式和原因；删除 `styles.js` 中仅用于此 checkbox 的样式。→ AC-2
3. 修改 `tests/segment-continuity.test.js`、`production.test.js`、`production-ui.test.js`，验证遗漏拒绝且请求可重试、原因保存及编辑保留、无手动开关和现有队列执行。测试通过后构建、打包、空闲时重启 Harness 并检查 UI。→ AC-1～4

## 验收标准

- AC-1：AI 拆分时逐段输出明确判断及原因，首段 false；遗漏或类型错误不可悄悄当作关闭保存。
- AC-2：第二段起只读展示衔接方式和 AI 原因，无手动开关；历史数据明确未评估。
- AC-3：判断持久化，进入分镜/H3 上下文，原自动抽帧、等待和恢复行为通过回归。
- AC-4：相关测试、构建、Registry 通过，运行界面为新版本。

## 验证结果

2026-09-19 AC-1～4 全部完成。15 项相关测试、222 项插件全量测试、构建和 Registry 通过；真实 Qwen 工具调用生成并保存 false/true/false 的三段衔接结果。已重启 Harness，页面确认原手动开关移除、展示只读规划结果。未覆盖另一个任务的旧 UI 清理改动。详见 `docs/implement/实施-AI自动规划Segment衔接.md`。
