# 剧情与 Segment 时长容差调研

## 结论
- AC-1 — 已确认 — `checkDuration` 要求剧情/Segment 总时长与 `target_seconds` 相差不超过 0.05 秒，185 对 180 会被拒绝。
- AC-2 — 已确认 — 分批 Segment 用总时长等于目标判断结束，容差后应改为各 Scene 填满即结束。
- AC-3 — 已确认 — 页面 `storyMismatch` 同样按精确相等拦截下一步。

## 规格
- 目标：申请剧情和规划 Segment 时，总时长可相对项目目标上下浮动 30 秒。
- 非目标：
  1. 不放宽单 Segment 4～15 秒限制。
  2. 不放宽各 Scene 内 Segment 合计必须等于该 Scene duration。
  3. 不改分镜单段时长校验。
- 验收标准：
  - AC-1：目标 180 秒时，剧情或 Segment 合计 185 秒可保存。
  - AC-2：与目标相差超过 30 秒仍拒绝。
  - AC-3：页面在 ±30 秒内不提示总时长不一致，可进入规划 Segment。
  - AC-4：规则文本改为允许上下 30 秒。

## 调用链
```text
project_production_complete
  → checkDuration(scenes/segments, target_seconds) 现：|Δ|>0.05 失败
  → 目标：|Δ|>30 才失败
分批 segments
  → done = 总时长==目标 现会在填满 Scene 前/后误判
  → 目标：各 Scene duration 填满即 done
```

## 证据表
| 编号 | 来源 | 支持的结论 |
|------|------|-----------|
| E1 | `src/server/projects/production.js:21-23,154-155,173-176` | 精确相等与分批结束条件 |
| E2 | `src/client/workbench/production-workflow.js:39,54` | UI 精确拦截 |
| E3 | 用户截图 | 185 对 180 被拒 |

## 问题
| AC | 预期 | 实际 | 状态 | 根因 |
|----|------|------|------|------|
| AC-1 | 185 可过 | 拒绝 | 已确认 | checkDuration 0.05 |

## 人工介入
无

## 下一步
实施 ±30 秒校验、分批结束条件、规则与 UI。
