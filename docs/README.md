# 项目文档地图

根目录 [`README.md`](../README.md) 是项目唯一总入口。本页只回答“哪份文档代表当前真相、历史记录在哪里”。机器契约与代码优先；两者与文档冲突时，应更新文档而不是新增一份并列说明。

## 现行规范

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 系统分层、核心数据流与边界。
- [`docs/workflow-contract.md`](docs/workflow-contract.md) — Agent 语义意图与 ComfyUI workflow 的解耦契约。
- [`docs/tier-strategy-design.md`](docs/tier-strategy-design.md) — capability、tier 与 manifest 的解析契约。
- [`docs/video-continuity.md`](docs/video-continuity.md) — shape、参考绑定、角色一致性与 `continuity_from` 唯一契约。
- [`docs/project-storage-layout.md`](docs/project-storage-layout.md) — Project、阶段产物与存储布局。
- [`h3-prompt-integration.md`](h3-prompt-integration.md) — H3 提示词职责与插件字段映射。
- [`docs/open-issues.md`](docs/open-issues.md) — 尚未闭环的问题登记。

## 操作与选型

- [`minimax-h3-acceleration-lora.md`](minimax-h3-acceleration-lora.md) — H3 加速 LoRA、VAE、内核与硬件组合。
- [`docs/video-upscale-guide.md`](docs/video-upscale-guide.md) — U1/U3、2K、PDD、SeedVR2 与 hires 唯一指南。
- [`docs/channel-delivery.md`](docs/channel-delivery.md) — 渠道产物送达与宿主限制。

## 活跃设计与实施

- [`docs/tier-strategy-design.md`](docs/tier-strategy-design.md) — 统一 capability → tier → manifest 调用面与档位契约。
- [`plans/2026-10-08-harness-deep-integration-refactor.md`](plans/2026-10-08-harness-deep-integration-refactor.md) — Harness 深度集成重构（做减法），待审核后交 Codex 执行。
- [`plans/2026-10-07-durable-production-architecture.md`](plans/2026-10-07-durable-production-architecture.md) — 最小持久生产架构。
- [`plans/2026-10-07-production-agents.md`](plans/2026-10-07-production-agents.md) — Agent、领域命令与 Worker 的职责分离。
- [`plans/2026-10-07-script-assets-agent-production.md`](plans/2026-10-07-script-assets-agent-production.md) — 剧本到资产、分镜和提示词的生产链。
- [`minimax-h3-native-dialogue.md`](minimax-h3-native-dialogue.md) — H3 原生对白契约与实施记录。
- [`implement/ArcReel.md`](implement/ArcReel.md) — ArcReel 高收益能力审计。
- [`implement/harness-capabilities.md`](implement/harness-capabilities.md) — Harness 能力复用登记表。

## 历史与研究

- 已完成计划、旧验收、上游快照和未验证实验不再占用工作树，需要时从 Git 历史恢复。
- [`research/`](research/) — 仍被当前实施引用的根因与外部调研。
- [`plans/`](plans/) — 尚在推进或仍具约束力的方案。
- [`implement/`](implement/) — 当前实施审计、能力台账与实施记录。

## 非产品文档

- [`../skills/`](../skills/) — 运行时操作契约，不参与普通文档合并。
- [`../.claude/README.md`](../.claude/README.md) — 文档编写规范。
- [`../tasks/`](../tasks/) — 当前任务与复盘记录。
