# 单机 AI 成人短剧创作工具实施记录

> 状态：待用户验收
> 对应设计：`docs/架构-单机AI成人短剧创作工具.md`
> 基线：`dsh-short-video-studio` 1.8.1，2026-10-02，本地 macOS / Node.js 22
> 范围：Project 数据底座、生成 Attempt、审核、权利门、时间线/交付、文件服务、诊断和旧画布兼容；远程 Qwen/ComfyUI 产物质量由用户手工验收。

## 0. 结果

- 已完成 Project 聚合、Harness Domain Storage repository、revision CAS、commandId 幂等、单写者租约、Outbox、状态机与读模型。
- 已完成 Project 工具、源文与剧本开发工具及 Project REST API；原 UI/HTTP/tool 写入口保留兼容契约，但权威状态不再写回 `project.json`。
- 已完成“先持久化 Attempt、再提交 ComfyUI”、提交响应不确定态、恢复决策、候选 Asset、人工 ReviewDecision 和批准资产硬门。
- 已完成成人项目的年龄/同意/许可记录与生成、交付硬门；证据接口只返回计数，不回显证据原件。
- 已完成受约束的 FileService、原子发布、血缘失效、Timeline revision、Deliverable 记录、磁盘 GC 基础能力、结构化诊断和 hash-chain 审计。
- 未把离线测试写成实机结论：真实 Qwen3.8、Qwen-Image 2.1、MiniMax H3、FFmpeg 长片交付与双集成片仍待用户环境手工验收。

## 1. 改动

| 文件或目录 | 职责 | 实施内容 |
| --- | --- | --- |
| `lib/domain/` | 唯一业务状态与写入口 | 聚合 schema、命令、策略、状态机、CAS/幂等、Harness repository、读模型、Outbox、租约和 Project 工具 |
| `lib/script/` | 源文与剧本开发 | 不可变纯文本导入、hash/分块读取、内容分析/分集/正式剧本 Proposal 契约与工具 |
| `skills/script-development-elysium/` | Agent 编排 | 强制源文引用、Proposal 审核和正式数据提交边界 |
| `lib/storage/` | 本地二进制与迁移 | 根目录解析、逻辑布局、路径逃逸防护、原子发布、hash、Trash/GC、旧画布导入 |
| `lib/comfy/`、`lib/media/` | 生成副作用编排 | ComfyUI client、Attempt 生命周期、下载发布、恢复扫描和媒体血缘 |
| `lib/review/`、`lib/rights/` | 人工审核与合规硬门 | ReviewTask/Decision 桥接、批准/拒绝状态推进、成年/同意/许可检查 |
| `lib/timeline/`、`lib/delivery/` | 时间线与交付 | approved Asset 校验、不可变 revision、导出计划与交付记录 |
| `lib/diagnostics/` | 可观测与审计 | 结构化事件脱敏、hash-chain 与 checkpoint 校验 |
| `lib/capabilities/` | 工作流选择 | manifest 校验、仅解析 `runtime_verified` 默认实现 |
| `lib/compat/legacy-canvas-adapter.js` | 旧 UI 兼容 | 首次只读导入旧画布，后续读写统一翻译成领域命令 |
| `lib/index.js` | 插件装配 | 注入 Storage、注册生命周期/REST/tools，并把原生成与画布入口接入新底座 |
| `scripts/tools/audit-harness.mjs` | Harness 依赖审计 | 修正全局 dsh/pnpm 安装树解析，避免把已安装包误报为缺失 |
| `tests/` 与 smoke 脚本 | 回归防线 | 覆盖 CAS、幂等、状态机、权利门、审核门、Attempt 恢复、FileService、租约、审计链和兼容入口 |

## 2. 验证

| 命令或检查 | 覆盖范围 | 结果 |
| --- | --- | --- |
| `npm test` | 领域、存储、媒体、审计、能力注册表 | 10/10 通过，0 失败 |
| `npm run smoke` | 19 个现有离线 smoke/预览/PDF/兼容入口 | 全部通过 |
| `node scripts/checks/smoke-tools.mjs` | 51 个工具的宿主 register 契约 | 134 项通过 |
| `node --test tests/domain/script-development.test.js tests/domain/project-service.test.js tests/domain/state-machines.test.js` | 源文、Proposal、审核提交与下游失效 | 29/29 通过 |
| `node scripts/checks/smoke-assets.mjs` | 资产兼容 API | 77 项通过 |
| `node scripts/checks/smoke-upload-assets.mjs` | 手动上传、物化、替换 | 41 项通过 |
| `node scripts/checks/smoke-preask-deliver.mjs` | 送达、失败记录与再次尝试 | 53 项通过 |
| `node scripts/tools/audit-harness.mjs web --json` | 当前 web profile 官方包解析 | 144/144 resolved，0 unresolved |

## 3. 手工验收

1. 启动当前 `web` profile，打开原短剧画布；确认旧项目首次出现后可继续新增、分组、排序、替换图片，且旧 `project.json` 时间戳不再因新写入改变。
2. 用 `studio_project_create` 创建成人项目；未记录成年确认和生成同意时尝试生成，应收到 rights gate 错误。补齐 `studio_rights_record` 后再生成。
3. 对一条 Shot 执行图片或视频生成；在 `studio_attempt_list` 中确认状态经过 created/submitting/queued/running/downloading/completed，结果进入 `studio_review_queue`。
4. 用 `studio_review_decide` 批准候选；确认 Shot 与 Asset 同时变为 approved。拒绝另一候选，确认 Shot 回到 ready。
5. 只用 approved Asset 调用 `studio_timeline_assemble`；混入 candidate/rejected Asset 时应被拒绝。
6. 调用 `studio_deliverable_export`，检查交付状态、revision、hash 与质量报告；在真实 ComfyUI/FFmpeg 环境检查最终音视频。
7. 模拟一次提交响应丢失或重启；确认 Attempt 为 `submission_unknown` 或待恢复态，必须通过 `studio_attempt_recover` 明确处理，不自动重复付费提交。

## 4. 偏差、未覆盖与风险

- 旧 UI 仍经 `LegacyCanvasCommandAdapter` 使用整体画布兼容命令；这是阶段 1 的临时边界，不是长期领域 UI。兼容层没有直接写 Domain Storage，也不会双写旧文件。
- 旧 `.dsh-assets/library.json` 仍由兼容资产库入口维护，尚未迁移为 Project 内 Asset 权威索引；因此阶段 5 的批量资产迁移和兼容层删除不在本次“已完成”范围内。
- 本次没有运行付费/长耗时远程生成、真实中途杀进程恢复、双进程 Harness 写锁争抢、完整两集或 30 秒金样；这些项目只能在用户的活动服务与模型文件上验收。
- `configured`、`manifest_verified` 与 `runtime_verified` 仍严格区分；离线 manifest 通过不会自动把工作流标为 `runtime_verified`。
