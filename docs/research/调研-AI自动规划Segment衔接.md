# AI 自动规划 Segment 衔接调研

## 结论与规格

目标：AI 拆分 Segment 时判断是否使用前段尾帧，详情页仅展示规划结果。

- AC-1 — 已确认断点：`server/projects/production.js` 的 segments 指令未要求 `use_previous_tail`，回写时遗漏会被 schema 默认成 false。需要每段显式输出布尔值与原因，首段必须 false。
- AC-2 — 已确认：`client/workbench/segment-editor.js` 暴露手动 checkbox。需要移除开关，展示决定和原因；历史无原因数据不能冒充 AI 判断。
- AC-3 — 已确认：分镜、H3 输入及队列已消费 use_previous_tail。保留执行链，通过测试验证 AI 保存的判断自动控制 i2va 与前段依赖。
- AC-4 — 未验收：测试、构建及重启后的实际页面。

非目标：不重生成现有视频，不重构分镜/队列，不通过固定 Scene ID 相等规则替代 AI 语义判断。

## 调用链与证据

规划 Segment → project_production_read/context.instructions → AI 返回 segments → complete 校验 → segmentValues 持久化 → shots/inputs 上下文 → segment-queue 抽帧执行。

源码依据：`dsh-elysium/src/server/projects/production.js` 的 context/complete；`src/database/schemas/production.js` 的 segmentValues；`src/client/workbench/segment-editor.js` 的 SegmentEditor；既有 `tests/segment-continuity.test.js`。

连续动作且起始构图能承接上一段结束时采用尾帧；换地点、跳时、闪回或主动新机位切镜时不采用。不同 Scene 编号不自动等于换场景。

## 人工介入

无。下一步按上述 AC 实施。
