# 剧情与 Segment 时长容差

- 类型：Bug 修复
- 目标：剧情和 Segment 总时长相对项目目标允许 ±30 秒。
- 调研来源：`docs/research/调研-剧情Segment时长容差.md`

## 人工决策
无

## 执行步骤

### 阶段 1：服务端容差
1. `dsh-elysium/src/server/projects/production.js:checkDuration` — 修改：阈值 0.05 → 30 秒 → AC-1 AC-2
2. `dsh-elysium/src/server/projects/production.js:complete` 分批 done — 修改：按各 Scene 填满结束，不再要求总时长等于目标 → AC-1
3. `dsh-elysium/tests/production.test.js` — 修改/新增：185 对 180 通过，超过 30 秒拒绝 → AC-1 AC-2

验证：`node --test tests/production.test.js tests/production-batches.test.js tests/segment-continuity.test.js`

### 阶段 2：规则与页面
1. `resources/production-rules/{story,scenes,segments}.md` — 修改：允许上下 30 秒 → AC-4
2. `src/client/workbench/production-workflow.js` — 修改：storyMismatch 用 30 秒 → AC-3
3. `src/client/workbench/project-generation.js` — 修改：提示允许 ±30 秒 → AC-4

验证：相关测试 + 构建

## 验收标准
引用调研 AC-1～AC-4。

## 验证结果
阶段 1 通过：`production.test.js`、`production-batches.test.js` 中 185 对 180 保存成功，70/220 超差拒绝。
阶段 2 通过：规则注入「上下 30 秒」，页面 185 对 180 可规划 Segment。
