# ArcReel 高收益能力蒸馏实施记录

> 状态：待实机验收
> 对应设计：`docs/plans/计划-ArcReel高收益能力蒸馏.md`
> 基线：当前插件 `5d1612e`；ArcReel `v0.31.0`；2026-10-02

## 0. 结果

- 已完成：在现有 Project Domain、Capability Registry、ComfyUI 执行和 Attempt 恢复路径上增量实现 PromptSnapshot、workflow 绑定检查/预览以及 Attempt 失败分类/恢复投影。
- 未完成：尚未用当前 ComfyUI 的真实图片和视频 workflow 执行付费/耗时生成；因此不将离线测试等同于 `runtime_verified`。
- 用户可见变化：新增 `studio_prompt_preview`、`comfy_workflow_inspect`、`comfy_workflow_preview`、`comfy_workflow_verify`；`studio_attempt_list` 增加恢复建议、失败类别和重复计费风险。

## 1. 改动

| 文件 | 职责 | 改动 | 对应需求或设计 |
| --- | --- | --- | --- |
| `lib/prompts/snapshot.js` | PromptSnapshot 规范化 | 增加稳定序列化、SHA-256、64 KiB 上限和完整性校验 | P0-1 |
| `lib/prompts/compiler.js` | 生成输入编译 | 从 Shot 显式引用解析 Character、Location、Asset 和 continuity，拒绝缺失/未批准资产 | P0-1 |
| `lib/domain/commands/index.js` | 领域写入 | 保存 Shot 引用依赖，冻结 Attempt 输入快照，记录结构化失败，允许下载阶段原 Attempt 恢复 | P0-1 / P0-3 |
| `lib/domain/tools.js` | Project Domain 工具 | 新增只读 Prompt 预览，Attempt 列表返回诊断投影；保留现有 DSH content block 渲染契约 | P0-1 / P0-3 |
| `lib/domain/read-models.js` | 读模型 | 增加 AttemptDiagnostics 列表和诊断输出 | P0-3 |
| `lib/media/lineage.js` | 血缘 | PromptSnapshot 引用的领域实体和资产纳入祖先图 | P0-1 |
| `lib/capabilities/workflow-inspector.js` | workflow 检查 | 提取提示词、尺寸、帧数、seed、参考图和输出候选，显式报告歧义 | P0-2 |
| `lib/capabilities/workflow-bindings.js` | 绑定契约 | 校验语义绑定和目标节点，推导 workflow 能力 | P0-2 |
| `lib/capabilities/validation.js` | Capability 验证 | 已验证能力必须使用 `confirmed` bindings | P0-2 |
| `lib/comfy/request-builder.js` | ComfyUI 请求构造 | preview 和实发共用确定性绑定注入与 workflow hash | P0-2 |
| `lib/comfy/client.js` | ComfyUI HTTP | 增加 `object_info` 最小读取接口 | P0-2 |
| `lib/media/failures.js` | 错误分类 | 统一鉴权、限流、网络、输入、配置、远端和下载失败语义 | P0-3 |
| `lib/media/recovery.js` | 恢复投影 | 生成 recoveryState、recommendedAction、duplicateChargeRisk 和自动化边界 | P0-3 |
| `lib/media/generation.js` | 生成与恢复编排 | 区分已知插件拒绝与提交结果未知，复用原 Snapshot 恢复轮询/下载，使用确定性 Asset ID | P0-1 / P0-3 |
| `lib/index.js` | 插件装配 | 将 Snapshot 接入实际生成路径，注册 workflow inspect/preview/verify 工具与三个独立 feature gate | P0-1 / P0-2 / P0-3 |
| `README.md` | 运行配置 | 记录三个 feature gate 的默认值与回退方式 | 可运维性 |
| `tests/domain/*.test.js` | 领域回归 | 覆盖 Snapshot 稳定性/篡改、引用缺口、Capability bindings 和下载恢复 | P0-1 / P0-2 / P0-3 |
| `tests/comfy/*.test.js` | workflow 回归 | 覆盖候选识别、歧义、绑定校验和请求不变性 | P0-2 |
| `tests/media/*.test.js` | 生成/恢复回归 | 覆盖提交失败分类、`submission_unknown` 不重提、原 Attempt 下载恢复 | P0-3 |
| `scripts/checks/smoke-tools.mjs` | 工具契约 smoke | 同步 Project Domain 工具数量和新工具契约 | 回归验证 |

## 2. 验证

| 命令或检查 | 覆盖范围 | 结果 |
| --- | --- | --- |
| `node --test tests/domain/*.test.js tests/comfy/*.test.js tests/media/*.test.js` | 三个 P0 的领域、workflow 和恢复分支 | 22/22 通过 |
| `npm test` | 全部 Node 测试 | 25/25 通过 |
| `node scripts/checks/smoke-tools.mjs` | 工具 schema、输出和能力轴 | 134/134 通过 |
| `npm run smoke` | 工具、manifest、生成、画布、资产、交付和 PDF 全量 smoke | 通过，退出码 0 |
| `npm pack --dry-run --json` | npm 发布包文件集 | 通过，125 个文件 |
| `node --check lib/index.js`、`node --check lib/domain/tools.js`、`node --check lib/domain/commands/index.js` | 主要装配与领域路径语法 | 通过 |

## 3. 偏差与勘误

- 计划中的独立集成测试文件未新增；现有领域、ComfyUI 和媒体测试已在同一 `npm test` 入口串联执行，避免重复夹具。
- 未增加独立薄 UI 面板；当前插件以工具契约为主交互面，新能力经现有 Harness 工具面暴露，不引入第二份客户端状态。
- 三个 feature gate 默认开启，可在配置的 `features` 中分别设为 `false` 回退；这使用户能在当前人工验收阶段直接调用新工具，但不改变 Capability Registry 的 `runtime_verified` 门槛。

## 4. 未覆盖与风险

- 尚未对当前 ComfyUI 执行图片和视频实机生成，workflow 节点集、模型指纹、preview/实发 hash 和重启恢复需由用户继续验收。
- `submission_unknown` 只提供人工确认建议，不会自动重提；这是防止重复计费的安全边界。
- 回滚时仅需将 `features.promptSnapshots`、`features.workflowInspector`或 `features.attemptDiagnostics` 设为 `false` 并重启插件；旧项目无需数据迁移。
