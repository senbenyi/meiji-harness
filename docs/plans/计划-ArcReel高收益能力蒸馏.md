# ArcReel 高收益能力蒸馏设计与实施计划

> 状态：离线实施完成，待 ComfyUI 实机验收
> 基线：当前插件 `5d1612e`；ArcReel `v0.31.0`；2026-10-02
> 影响范围：现有 Project Domain、Capability Registry、ComfyUI 执行、Attempt 恢复、相关工具与薄 UI
> 对应审计：`../implement/ArcReel.md`

## 0. 结论

- 不改变当前插件的数据所有权、执行主链和运行时，只在现有模块内增量实现三个 P0 能力。
- 实施顺序固定为：引用与输入快照 → workflow 检查与预览 → Attempt 对账与恢复投影。
- 三项分别受独立 feature gate 控制；关闭后现有工具、旧画布和项目数据语义必须保持不变。
- 本计划不包含 P1 脚本导入、云供应商、通用队列、TTS、高级时间线、剪映导出或 UI 重构。

## 1. 不变量

1. `ProjectService.execute()` 仍是项目结构化状态的唯一写入口。
2. Harness Domain Storage 仍是项目业务状态唯一真相；不新增数据库或项目 JSON 真相源。
3. `FileService` 继续只通过现有定位器管理媒体和导出文件。
4. Attempt 继续表示一次实际供应商执行；不引入 Job/Task 聚合作为竞争状态源。
5. `submission_unknown` 不自动再次提交。
6. 生成产物仍经过 Asset candidate、Review 和 approved 门，不因 preview 或恢复而绕过。
7. Rights Gate 在任何远端提交之前执行。
8. Capability Registry 仍只解析 `runtime_verified` 条目。
9. 现有工具名称和必填输入不做破坏性修改。
10. LegacyCanvasCommandAdapter 不直接写 Domain Storage，不恢复旧文件双写。

## 2. 目标结构

```text
现有工具 / 画布
      │
      ▼
ProjectService command/read model
      │
      ├── PromptCompiler ──→ PromptSnapshot
      │                         │
      │                         ▼
      ├── CapabilityRegistry → WorkflowRequestBuilder
      │                         │
      │                         ▼
      └── Attempt ───────────→ ComfyUI
             │                    │
             └── RecoveryReconciler ← history/artifacts
                       │
                       ▼
               AttemptDiagnostics
```

新增组件只读取当前 Project 快照并通过 ProjectService 提交命令，不拥有独立持久化。

## 3. P0-1：引用一致性与 PromptSnapshot

### 3.1 数据契约

给 Shot 增加可选字段：

```json
{
  "referenceBindings": [
    {
      "kind": "character | location | asset | continuity",
      "entityId": "稳定领域 ID",
      "assetId": "可选 approved asset ID",
      "role": "subject | environment | wardrobe | prop | first_frame | last_frame",
      "required": true
    }
  ]
}
```

给 Attempt 增加有界不可变字段：

```json
{
  "inputSnapshot": {
    "schemaVersion": 1,
    "projectRevision": 12,
    "shotId": "shot-1",
    "prompt": "最终实发提示词",
    "negativePrompt": "最终实发排除项",
    "references": [
      { "kind": "character", "entityId": "char-1", "assetId": "asset-7", "assetHash": "..." }
    ],
    "parameters": { "width": 768, "height": 432, "seed": 42 },
    "capabilityKey": "image.generate:fast",
    "workflowFingerprint": "...",
    "snapshotHash": "..."
  }
}
```

约束：

- Snapshot 只保存最终提交所需的有界文本、标量、ID 和 hash，不嵌入媒体、workflow 全文或 StoryBible 全文。
- 单 Snapshot 的序列化大小必须有明确上限；超限时返回领域错误，不静默裁剪。
- Snapshot 创建后不可修改；重试复用同一 Snapshot，重新生成必须创建新 Attempt。
- `snapshotHash` 使用稳定字段顺序计算，不包含时间戳。

### 3.2 职责

| 文件 | 职责 | 计划改动 |
| --- | --- | --- |
| `lib/prompts/compiler.js` | 把 Shot 和 Project 快照编译成确定性生成输入 | 新增纯函数；解析显式引用，缺失或非法引用返回结构化错误 |
| `lib/prompts/snapshot.js` | 规范化输入并计算稳定 hash | 新增大小检查、规范序列化和 hash |
| `lib/domain/spec.js` | Project 记录的 schema 与上限 | 接受可选 referenceBindings/inputSnapshot，不改变现有默认值 |
| `lib/domain/commands/index.js` | 领域写命令 | 增加 Shot 引用更新与 Attempt 输入冻结命令；命令保持 CAS/幂等 |
| `lib/domain/service.js` | 唯一写入口 | 装配新增命令，不允许 compiler 自行持久化 |
| `lib/domain/invalidation.js` | 上游变化失效下游 | Character、Location、引用 Asset 变化时标记相关 Shot 需要重新预览，不改历史 Attempt |
| `lib/media/generation.js` | 真实生成编排 | Rights Gate 后编译/冻结，提交时只读 Snapshot |
| `lib/media/lineage.js` | 输入与产物血缘 | 把 Snapshot references 纳入祖先图 |
| `lib/domain/read-models.js` | UI/工具读取 | 输出 preview、引用缺口、snapshotHash，不暴露内部存储对象 |
| `lib/domain/tools.js` | 公共工具 | 新增 `studio_prompt_preview`；现有生成工具保持兼容 |

### 3.3 工具契约

`studio_prompt_preview`：

- 输入：`projectId`、`shotId`、`capability`、可选 `tier` 和参数覆盖。
- 输出：最终 prompt、negative prompt、引用清单、参数、workflow fingerprint、预计 snapshotHash、阻断项。
- 只读：不创建 Attempt、不提交 ComfyUI、不改变 Project revision。
- preview 成功不表示 runtime capability 已验证；状态必须单独返回。

### 3.4 验收

| 场景 | 期望结果 |
| --- | --- |
| 相同 Project revision、绑定和 capability 重复预览 | snapshotHash 一致 |
| required entity/asset 缺失 | 预览和提交都在远端调用前失败 |
| 预览后修改 Character 或引用 Asset | 新预览 hash 改变；旧 Attempt Snapshot 不变 |
| 预览后直接提交且项目未变化 | 实发请求与预览字段逐项一致 |
| submission_unknown 后恢复 | 使用原 Snapshot，不重新编译或重复提交 |

## 4. P0-2：ComfyUI workflow 检查、确认与预览

### 4.1 Binding 契约

Capability entry 增加可选绑定清单：

```json
{
  "bindings": {
    "positivePrompt": [{ "nodeId": "6", "input": "text" }],
    "negativePrompt": [{ "nodeId": "7", "input": "text" }],
    "width": [{ "nodeId": "5", "input": "width", "step": 16 }],
    "height": [{ "nodeId": "5", "input": "height", "step": 16 }],
    "frames": [{ "nodeId": "20", "input": "length" }],
    "seed": [{ "nodeId": "3", "input": "seed" }],
    "referenceImages": [{ "nodeId": "12", "input": "image", "slot": 0 }],
    "outputs": [{ "nodeId": "30", "mediaType": "video" }]
  },
  "bindingStatus": "suggested | confirmed"
}
```

约束：

- Inspector 只产生 suggested bindings，不修改注册表。
- 存在多个等价候选时必须返回 ambiguity，不自动选择。
- 只有 confirmed bindings 才能进入 manifest_verified。
- runtime_verified 仍要求 endpoint、object info、manifest 和 model 指纹满足现有契约。
- workflow preview 和真实提交调用同一个 request builder。

### 4.2 职责

| 文件 | 职责 | 计划改动 |
| --- | --- | --- |
| `lib/capabilities/workflow-inspector.js` | 从 workflow/object info 提出绑定候选 | 新增纯检查器和歧义报告 |
| `lib/capabilities/workflow-bindings.js` | 绑定 schema 与能力推导 | 新增确认校验、尺寸/帧数/参考图能力推导 |
| `lib/capabilities/registry.js` | 已确认能力注册和解析 | 保存绑定及 fingerprint；resolve 规则不变 |
| `lib/capabilities/validation.js` | verification 状态守卫 | 增加 confirmed binding 和节点存在性校验 |
| `lib/comfy/request-builder.js` | 根据 Snapshot 和 bindings 构造实发 workflow | 新增确定性 builder，不负责持久化或网络调用 |
| `lib/comfy/client.js` | ComfyUI HTTP | 增加 object info/history 所需的最小读取接口，不包含推断规则 |
| `lib/index.js` | 宿主工具和设置 API 装配 | 注册 inspect/preview/verify 入口 |
| `lib/client.js` | 现有设置 UI | 增加候选确认、请求预览和验证结果薄面板，不重做 UI 架构 |

### 4.3 工具契约

- `comfy_workflow_inspect`：读取 workflow，返回候选、歧义和未识别项；不保存。
- `comfy_workflow_preview`：使用已确认 bindings 和调用参数构建请求；不提交。
- `comfy_workflow_verify`：检查 endpoint、object info、节点/输入和 fingerprint；默认不执行付费样例。

所有工具输出必须区分 configured、manifest_verified 和 runtime_verified，禁止用“连接成功”代替 workflow 真实可用。

### 4.4 验收

| 场景 | 期望结果 |
| --- | --- |
| 标准图片 workflow | 找到提示词、尺寸、seed 和图像输出候选 |
| 标准视频 workflow | 找到提示词、帧数、参考图和视频输出候选 |
| 两个可能的正向提示节点 | 返回 ambiguity，不能确认或运行 |
| 已确认节点从 workflow 删除 | verification 降级，禁止 runtime resolve |
| preview 后提交 | 提交的 workflow hash 与 preview hash 相同 |
| 模型或 object info 变化 | runtime fingerprint 变化，要求重新验证 |

## 5. P0-3：Attempt 对账与恢复投影

### 5.1 不增加持久状态枚举

保留现有 Attempt 状态：

```text
created → submitting → submission_unknown | queued → running → downloading → completed
                                                     └────────→ failed/cancelled
```

新增信息是派生投影，不是第二个状态机：

```json
{
  "recoveryState": "none | auto_resume | manual_confirmation | retry_download | terminal",
  "failureClass": "none | configuration | authentication | invalid_input | rate_limit | transient_network | remote_failure | uncertain_submission | download_failure",
  "recommendedAction": "wait | resume | confirm_external | retry_download | fix_configuration | create_new_attempt",
  "duplicateChargeRisk": "none | possible | high",
  "lastObservedAt": "ISO-8601"
}
```

### 5.2 对账规则

| 当前事实 | 行为 |
| --- | --- |
| `submission_unknown` 且无可靠 promptId | 只提示人工确认，绝不自动重提 |
| queued/running 且有 promptId，history 仍在途 | 继续轮询 |
| queued/running 且 history 已完成、本地无 Asset | 进入下载和原子发布 |
| downloading 且目标文件已存在且 hash 匹配 | 幂等完成，不重复下载或建 Asset |
| promptId 在远端不存在 | 标记结构化 remote_failure，建议新 Attempt |
| 认证/配置/输入错误 | 不自动重试，给出修复动作 |
| 瞬时网络错误且已知未提交 | 可按有界退避重试同一阶段 |

### 5.3 职责

| 文件 | 职责 | 计划改动 |
| --- | --- | --- |
| `lib/media/recovery.js` | 从 Project/Attempt 生成恢复计划 | 扩充为对账规则，仍不直接写状态 |
| `lib/media/generation.js` | 执行恢复动作 | 复用现有 complete/download/publish 路径 |
| `lib/media/failures.js` | 统一错误分类 | 新增纯分类函数和 retryability |
| `lib/domain/read-models.js` | AttemptDiagnostics 投影 | 添加恢复状态、动作、费用风险和证据摘要 |
| `lib/domain/service.js` | 恢复命令入口 | 继续通过现有 attempt recover/cancel 命令写入 |
| `lib/diagnostics/events.js` | 结构化运行事件 | 记录对账判断和动作，沿用脱敏规则 |
| `lib/client.js` | 右栏恢复面板 | 只展示 read model 并调用既有恢复工具 |

### 5.4 验收

| 故障注入 | 期望结果 |
| --- | --- |
| ComfyUI 已接收但提交响应丢失 | submission_unknown；不自动重提；显示重复计费风险 |
| 进程在 queued/running 时退出 | 重启后根据 promptId 恢复轮询 |
| 远端完成、下载前退出 | 重启后只下载和发布一次 |
| 文件发布完成、领域命令前退出 | 依据 hash 幂等收敛，不产生重复 Asset |
| 错误 API key | failureClass=authentication，不自动重试 |
| UI 刷新或切会话 | 同一 Project revision 显示相同恢复状态 |

## 6. Feature gates 与发布顺序

三项分别设置 feature gate；具体配置位置沿用插件现有设置机制，不引入新配置服务：

```text
promptSnapshots
workflowInspector
attemptDiagnostics
```

发布顺序：

1. 先提交纯函数、schema 兼容读取和单元测试，gate 默认关闭。
2. 接入只读 preview/inspect/read model，验证不产生项目写入。
3. 接入 generation/recovery 写路径，运行故障注入。
4. 打开单个 gate 做真实图片 workflow 验收。
5. 图片通过后再验证真实视频 workflow。
6. 三项都通过后才在默认配置启用。

任一步失败都可关闭对应 gate；旧项目无需回滚或迁移删除字段。

## 7. 测试文件计划

| 测试文件 | 覆盖 |
| --- | --- |
| `tests/domain/prompt-compiler.test.js` | 引用解析、确定性、缺失引用、大小上限 |
| `tests/domain/project-service.test.js` | 新命令 CAS、幂等、失效和旧记录兼容 |
| `tests/domain/tools.test.js` | 新工具 schema 与只读/写入边界 |
| `tests/domain/capability-registry.test.js` | confirmed binding、fingerprint、verification 降级 |
| `tests/comfy/workflow-inspector.test.js` | 图片/视频候选、歧义、未知节点 |
| `tests/comfy/request-builder.test.js` | preview/submit 同构、尺寸/帧数/seed/reference 写入 |
| `tests/media/generation.test.js` | Snapshot 冻结、实发一致性、未知提交 |
| `tests/media/recovery.test.js` | 远端/本地对账矩阵、幂等下载、错误分类 |
| `tests/integration/arc-reel-distillation.test.js` | 三项 P0 串联但不依赖付费远端 |

回归命令：

```bash
node --test tests/domain/*.test.js tests/comfy/*.test.js tests/media/*.test.js tests/integration/*.test.js
node scripts/checks/smoke-tools.mjs
npm run smoke
```

实机验收不纳入离线“通过”口径：需要当前 ComfyUI 的一个图片 workflow 和一个视频 workflow，分别验证 preview hash、实发 hash、重启恢复和产物血缘。

## 8. 分批实施文件清单

### 批次 A：引用与 Snapshot

- 新增：`lib/prompts/compiler.js`、`lib/prompts/snapshot.js`、聚焦测试。
- 修改：`lib/domain/spec.js`、`commands/index.js`、`service.js`、`invalidation.js`、`read-models.js`、`tools.js`、`lib/media/generation.js`、`lineage.js`。
- 不修改：Timeline、Delivery、Review、Rights 的公共语义。

### 批次 B：workflow 检查与预览

- 新增：`lib/capabilities/workflow-inspector.js`、`workflow-bindings.js`、`lib/comfy/request-builder.js`、聚焦测试。
- 修改：`registry.js`、`validation.js`、`client.js`、`lib/index.js` 和设置 UI。
- 不修改：现有 capability 名称、tier 解析和已验证 manifest 的执行选择语义。

### 批次 C：Attempt 对账与恢复投影

- 新增：`lib/media/failures.js`、恢复聚焦测试。
- 修改：`recovery.js`、`generation.js`、`read-models.js`、`diagnostics/events.js`、`client.js`。
- 不修改：Attempt 状态枚举、submission_unknown 安全语义和 Asset/Review 晋升条件。

## 9. 实施前检查

- 当前工作区已有 `lib/domain/tools.js`、`scripts/checks/smoke-client-settings.mjs` 修改以及未跟踪测试/运行数据；实施时必须先区分用户改动，不覆盖、不 stash。
- 批次 A 会与当前 `lib/domain/tools.js` 改动相交，开始编码前必须读取并基于当前内容做最小补丁。
- 每个批次开始前重新确认 Git 状态和实际宿主工具契约。
- 如果实现证据表明必须新增第二状态机、第二存储或破坏现有工具输入，停止实施并回到设计确认，不自行扩大范围。

## 10. 完成条件

只有同时满足以下条件，P0 才能标记完成：

- 三个 feature gate 均可独立关闭，关闭后全部既有测试和 smoke 通过。
- preview 与实发请求有自动化同构断言。
- 所有引用可追踪到当前 Project 内稳定 ID 和 Asset hash。
- submission_unknown 故障注入证明不会自动重复提交。
- 重启恢复不产生重复 Asset 或重复 Timeline 引用。
- 图片和视频各完成一次真实 workflow 验收；未运行时只能标记“离线通过、实机未验证”。
- 实施记录列出所有偏差、未验证外部条件和回滚方法。

## 11. P1 触发条件

轻量脚本结构化导入只有在 P0 完成后才重新评估。进入条件：

- 用户确认真实输入主要来自纯文本或已有剧本。
- Episode/Shot 当前字段能够表达目标剧本，不需要第二套 FormalScript 权威模型。
- 能定义单批文本上限、游标和人工确认入口。
- 导入结果只调用现有领域命令，不直接写 Project 存储。

未满足以上条件时，不启动 P1，也不恢复 ArcReel 的多阶段 Agent 工作流。
