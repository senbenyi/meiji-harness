# ArcReel 能力审计：以当前插件为主的高收益蒸馏

> 状态：已完成，蒸馏范围已由用户确认
> 基线：当前插件 `5d1612e`（工作区存在未提交改动）；ArcReel `v0.31.0` / `1f39660`；2026-10-02
> 范围：只比较能够增强当前 `dsh-short-video-studio` 的能力；不评估整套替换、商业部署或多人平台化

## 0. 三十秒结论

- ArcReel 不作为运行依赖、数据源或新后端；当前插件的 Project Domain、File Service、Attempt、Review、Rights、Timeline 和 Capability Registry 保持主导。
- 只蒸馏三个 P0 能力：引用一致性与生成输入快照、ComfyUI 工作流检查与请求预览、Attempt 对账与恢复投影。
- 轻量脚本结构化导入列为 P1 候选；多供应商、Agent Runtime、任务数据库、认证、端点市场、完整前端、TTS 和高级剪辑不进入本轮。
- ArcReel 为 AGPL-3.0，当前插件为 Apache-2.0；本轮只依据公开行为和契约进行 clean-room 实现，不复制源码或模板文本。

## 1. 当前插件基线

当前插件已经具备以下不可替换的主链：

```text
ProjectService command
  → Harness Domain Storage
  → Shot
  → Attempt
  → Asset
  → Review
  → Timeline revision
  → Deliverable
```

| 当前能力 | 实际落点 | 蒸馏时的约束 |
| --- | --- | --- |
| 项目聚合与唯一写入口 | `lib/domain/spec.js`、`lib/domain/service.js`、`lib/domain/commands/` | 不建立 ArcReel ProjectManager 或第二套 project JSON |
| 生成执行状态 | `lib/domain/state-machines.js`、`lib/media/generation.js` | Attempt 继续表示一次真实供应商调用，不新增竞争性的 Task/Job 真相源 |
| 未知提交与恢复 | `submission_unknown`、`lib/media/recovery.js` | 不允许因引入队列而自动重复付费提交 |
| 媒体血缘 | `lib/media/lineage.js` | 新引用和快照进入现有血缘，不建旁路索引 |
| 工作流选择 | `lib/capabilities/registry.js`、`validation.js` | 保留 configured / manifest_verified / runtime_verified 三层契约 |
| 审核与权利门 | `lib/review/`、`lib/rights/` | 所有新增生成入口继续经过硬门 |
| 时间线与交付 | `lib/timeline/`、`lib/delivery/` | 本轮不另建 ArcReel edit timeline |
| UI 兼容 | `lib/client.js`、`lib/compat/legacy-canvas-adapter.js` | 新 UI 只消费 command/read model，不恢复旧文件双写 |

## 2. 四栏审计

| ArcReel 能力域 | 当前插件已具备 | 需要增强 | 真正缺失 | 明确不引入 |
| --- | --- | --- | --- | --- |
| ComfyUI 执行 | 提交、轮询、下载、发布、Attempt 和血缘 | workflow 语义绑定、最终请求预览、绑定与运行时指纹校验 | 工作流检查器与绑定确认入口 | ArcReel ComfyUI backend、Python 客户端和端点市场 |
| 角色/场景一致性 | StoryBible、Character、Location、Shot、Asset、dependsOn | 稳定引用、生成前解析、缺失引用硬失败 | PromptCompiler、ReferenceBinding、PromptSnapshot | 第二套 Lorebook、名称驱动的隐式匹配 |
| 恢复与诊断 | Attempt 状态机、租约、submission_unknown、恢复扫描、审计事件 | 错误分类、远端/本地对账、面向用户的恢复动作和费用风险 | AttemptDiagnostics read model | SQL 任务表、通用 Job Queue、独立 Worker 数据真相 |
| 剧本生产 | StoryBible、Episode、Shot 可通过领域命令写入 | 外部文本到现有对象的候选映射 | 轻量结构化导入器 | 七阶段 Agent 自动流程、正式 script_plan 文件体系 |
| 多供应商 | Capability Registry 可抽象工作流 | 暂无必要 | 无当前 P0 缺口 | ArcReel 全部云供应商、发现服务和市场 |
| 前端工作台 | 当前画布、设置页、生成入口 | 三个 P0 的薄面板 | 无需独立产品前端 | React/FastAPI 工作台整体移植 |
| 音频与后期 | Timeline/Deliverable 已有扩展边界 | 需求尚未进入当前验收 | 未确认 | 本轮不引入 TTS、字幕、剪映草稿和高级非线性编辑 |
| Agent 与平台能力 | DSH Harness 已负责 Agent、Skill、Approval、Storage 等 | 无 | 无 | Claude Agent SDK、ArcReel sandbox、JWT、多用户、PostgreSQL |

## 3. 选择的三个 P0 能力

### 3.1 引用一致性与生成输入快照

采用的行为：

- Shot 显式引用当前 Project 内的 Character、Location、Asset 和 continuity source。
- 生成前把领域引用解析成最终 prompt、negative prompt、参考资产和参数。
- Attempt 保存有大小上限的不可变输入快照与 hash。
- 预览和实发共用同一个编译结果，避免“看到的”和“发送的”不同。

不采用：ArcReel 独立资产库、名称模糊匹配、由 Agent 直接拼接并写回项目 JSON。

### 3.2 ComfyUI 工作流检查与请求预览

采用的行为：

- 从 workflow 中提出 prompt、negative prompt、width、height、frames、seed、reference image 和 output 节点候选。
- 歧义绑定必须人工确认；检查器不能把猜测写成 runtime_verified。
- capability 从已确认绑定推导，不从模型文件名推断。
- preview 与 submit 使用同一 builder，运行时指纹继续进入现有 Capability Registry。

不采用：端点商店、自动安装、供应商市场、ArcReel 声明式 endpoint runtime。

### 3.3 Attempt 对账与恢复投影

采用的行为：

- 在现有 Attempt 状态之上生成派生的 recoveryState、failureClass、recommendedAction 和 duplicateChargeRisk。
- 启动恢复时对账 Attempt、ComfyUI prompt history 和本地产物。
- submission_unknown 只能人工确认外部状态，不自动再次提交。
- UI 的“生成中”完全来自 Attempt read model，不维护第二个状态字段。

不采用：ArcReel SQL TaskRepository、项目记录状态与任务状态的双重在途判定。

## 4. 候选方案

| 方案 | 收益 | 代价与风险 | 结论 |
| --- | --- | --- | --- |
| 整体移植 ArcReel | 表面能力最多 | AGPL、Python/FastAPI 双运行时、双数据真相、继承现有故障 | 否决 |
| ArcReel sidecar | 可快速试用部分 API | 运维和许可边界复杂，恢复与项目状态仍会分裂 | 否决为正式架构 |
| 重建通用任务队列 | 可扩展多供应商并发 | 当前单机模型下重复 Attempt/lease/Harness 能力 | 否决 |
| 在现有模块内增量蒸馏 | 最大化复用已验证内核，迁移风险可控 | 需要逐项建立行为测试 | 采用 |

## 5. ArcReel 已知故障对当前设计的约束

| 外部证据 | 当前设计约束 |
| --- | --- |
| 中断后记录停在 generating、队列已无任务，UI 和服务端口径不一致（#2727） | UI 状态只由 Attempt read model 派生；启动时统一对账 |
| 长篇分集规划超过 max_tokens，参数序列化又阻止缩小批次（#984） | P1 只做有界分块和候选提交；工具输入保持类型，不靠 Agent 长流程推进 |
| 剧本生成连接错误被重复尝试多次（#2399） | failureClass 决定重试；鉴权、配置和稳定连接拒绝不自动重试 |
| 分镜未稳定锚定角色、场景、道具（#1661） | 使用稳定 entity/asset id 和快照 hash，禁止名称隐式绑定 |

这些 issue 是外部故障证据，不证明 ArcReel 当前版本仍存在相同行为；它们用于定义本项目不得退化的验收场景。

## 6. 许可证结论

- ArcReel 仓库声明 AGPL-3.0；当前插件 `package.json` 声明 Apache-2.0。
- 不复制 ArcReel 源文件、测试、提示词模板或 UI 实现。
- 只使用公开行为、公开接口形态和已知失败案例形成独立契约与测试。
- 若未来决定直接链接、修改或分发 ArcReel 代码，需要单独完成法律评估；本审计不提供法律意见。

## 7. 验证路径

1. 每个蒸馏项独立 feature gate、独立测试和独立关闭路径。
2. 先用固定 workflow、固定 Project fixture 和伪 ComfyUI history 做离线验证。
3. 再用一个真实图片 workflow 和一个真实视频 workflow 做请求预览与恢复实测。
4. 任一能力必须证明关闭后原工具、旧画布和已有项目行为不变。

## 8. 诚实边界

- 未确认：ArcReel v0.31.0 的全部公开 issue 是否都能在当前版本复现。
- 未进行：ArcReel 实际安装、运行和数据迁移测试。
- 未评估：TTS、剪映草稿和高级时间线相对当前项目的真实投入产出。
- 本轮结论是能力和架构审计，不是对 ArcReel 整体质量的判定。

## 9. 参考来源

- 当前架构：`docs/架构-单机AI成人短剧创作工具.md`
- 当前实施：`docs/implementation/实施-单机AI成人短剧创作工具.md`
- 当前总计划：`docs/plans/计划-AI短剧数据底座与能力蒸馏.md`
- ArcReel README：https://github.com/ArcReel/ArcReel/blob/main/README.en.md
- ArcReel v0.31.0：https://github.com/ArcReel/ArcReel/releases/tag/v0.31.0
- ArcReel LICENSE：https://github.com/ArcReel/ArcReel/blob/main/LICENSE
- ArcReel issue #2727：https://github.com/ArcReel/ArcReel/issues/2727
- ArcReel issue #984：https://github.com/ArcReel/ArcReel/issues/984
- ArcReel issue #2399：https://github.com/ArcReel/ArcReel/issues/2399
- ArcReel issue #1661：https://github.com/ArcReel/ArcReel/issues/1661
