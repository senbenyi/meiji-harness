# 剧情与 Segment 时长容差实施记录

## 已修改文件
- `dsh-elysium/src/server/projects/production.js` — 剧情/Segment 相对 `target_seconds` 允许 ±30 秒；分批结束改为各 Scene 填满。
- `dsh-elysium/src/client/workbench/production-workflow.js` — 规划 Segment 入口按 ±30 秒判断总时长。
- `dsh-elysium/src/client/workbench/project-generation.js` — 申请文案改为不必精确相等。
- `dsh-elysium/resources/production-rules/{story,scenes,segments}.md` — 规则改为允许上下 30 秒。
- `dsh-elysium/tests/production.test.js`、`production-batches.test.js`、`production-rules.test.js`、`production-ui.test.js` — 锁定 185 对 180 通过、超过 30 秒拒绝。

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|----|------|--------------|
| AC-1 | 通过 | `180-second target accepts 185-second story and matching segments`；分批 185 秒 Scene 填满后 `request=null`。 |
| AC-2 | 通过 | 70 对 30、220 对 180 仍拒绝，且不消耗 request。 |
| AC-3 | 通过 | UI：185 对 180 可点「下一步：规划 Segment」；220 对 180 提示总时长不一致。 |
| AC-4 | 通过 | story/scenes/segments 规则与 context 均含「上下 30 秒」。 |

## 人工待办
- [ ] 无。Harness 已安装重启；对 185 秒剧情重试 `project_production_complete` 即可保存。
