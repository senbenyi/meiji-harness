# AI 原生成人短剧工厂：落地实施方案

**日期：** 2026-09-05  
**性质：** 推倒重构级实施文档  
**本阶段边界：** 只定义落地顺序、验收门槛和系统契约；不在本文件中修改业务代码、部署服务或执行 GPU 生成。

## 1. 最终结论

产品真正交付的不是“项目、章节、分镜和任务”，而是一部可播放、可复用、可局部重做、来源可追溯的短剧。

因此落地顺序必须固定为：

```text
可交付成片
  → 物理约束（角色一致、时长、画面/声音可用、成人合规）
  → 盘点并验证现有模型
  → 一份生产清单驱动全链路
  → 自动质检与局部重试
  → 最后才决定需要改多少插件界面
```

当前最严重的问题不是缺页面，而是：已有图像接口存在“任务 succeeded 但输出全黑”的假成功；创作状态与生产状态也可能分叉。没有先解决真实性和单一事实源，继续增加 Skill、页面或导演配置只会扩大返工。

## 2. 不可妥协的产品指标

| 指标 | 目标 |
|---|---|
| 用户输入 | 一句话；导演和技术参数可由 Agent 推断 |
| 默认页面 | 一个主创作界面 |
| 用户必须理解的技术参数 | 0 |
| 人工操作时间 | 从想法到提交生产不超过 3 分钟 |
| 必要人工确认 | 不超过 2 次：内容授权、最终验收 |
| 上传 | 0 次；大文件只在服务器共享路径流转 |
| 失败恢复 | 自动诊断、换参数/模型、只重做受影响镜头 |
| 资产复用 | 已通过的角色、场景、镜头不重复生成 |
| 可追溯 | 每次决策、模型、参数、输入输出 hash 可还原 |

若某一指标暂时达不到，必须记录实测数据和改造成本，不得用“接口返回成功”代替质量证明。

## 3. 第一阶段：冻结错误方向（立即执行）

### P0-1：停止继续扩展十五步创作 UI

现有 `creation` 域将剧情拆成 15 步，Skill 也要求逐步询问；这适合专业编剧工作台，不适合“一句话成片”。暂时保留其数据和专业入口，但从默认路径隐藏，不再增加步骤、表单或导演选择页。

### P0-2：建立输出真实性闸门

所有图像、视频、音频任务在标记 `succeeded` 前必须完成：

1. 文件存在、可解码、尺寸和时长合法；
2. 文件大小、sha256、媒体探针结果写入 receipt；
3. 图像检查亮度均值、方差、极值，纯黑/近纯色直接失败；
4. 视频抽样帧检查黑帧比例、静帧比例和时长；
5. 音频检查 codec、采样率、响度、静音比例；
6. 语义质检确认角色、场景、构图和提示词满足度。

当前 Model API 的任务状态主要依赖进程成功和非空输出，不能作为质量证明。必须先补闸门，再接自动生产。

### P0-3：统一事实源

每个生产请求只允许有一份 `production-manifest.json`。创作草稿、生产任务、审阅页均引用 manifest 的版本和 hash；不得让 creation state 与 episode state 各自表达“当前剧情”。

建议路径：

```text
/root/autodl-fs/productions/<episode-id>/
  input/production-manifest.json
  assets/characters/
  assets/scenes/
  shots/<shot-id>/
  audio/
  output/
  receipts/
  qc/
```

`/root/autodl-fs` 是服务器共享区域。客户端只传意图和引用，不上传媒体文件；模型服务之间传递服务器路径或内部 artifact id。

## 4. 目标用户路径

```text
DeepSeek Harness 一句话
  → Agent 解析意图、补齐默认值、检查成人授权
  → 生成 production-manifest
  → 自动选择模型和工作流
  → 角色/场景资产
  → 关键帧与镜头视频
  → 环境音/拟音
  → 机器质检与失败局部重试
  → 合成成片
  → Elysium 预览、修改单镜头或最终验收
```

默认模式只显示：输入框、可选参考图、进度时间线、阶段预览、最终结果和“重做本镜头”。章节、锚点、种子、工作流、显存和模型名称全部渐进披露到专业模式。

只有三类情况可以打断用户：

- 无法推断的内容授权或成人合规；
- 缺少生成所必需的参考素材；
- 两个质量取舍明显不同且 Agent 无法安全选择。

## 5. 自治导演 Agent 的最小契约

### 输入

```json
{
  "prompt": "用户的一句话",
  "referenceAssetIds": [],
  "userPreferences": {},
  "consent": null,
  "resumeProductionId": null
}
```

### 输出

```json
{
  "manifestId": "manifest-...",
  "intent": {},
  "directorStyle": {},
  "characters": [],
  "scenes": [],
  "shots": [],
  "capabilityPlan": [],
  "qcPolicy": {},
  "needsUserConfirmation": "consent|review|null"
}
```

### 工具边界

Agent 只调用以下原子工具，不直接操作页面状态：

`create_manifest`、`plan_story`、`generate_asset`、`generate_shot`、`generate_video_block`、`generate_audio`、`inspect_media`、`retry_task`、`finalize`。

`approve_consent` 和 `approve_final` 必须是界面按钮或宿主事件，不能放进聊天工具 action 表，防止模型自我批准。

### 失败策略

单个镜头最多自动重试 2–3 次，每次必须改变至少一项可解释变量：提示词约束、seed、采样参数、输入参考图或模型路由。重试只使该镜头及其下游失效，保留已经通过质检的资产。

## 6. 模型路由（先验证，后产品化）

当前只把“已通过真实输出验证”的能力放入默认路由；安装文件或 API 路由存在不等于可用。

| 能力 | 默认候选 | 产品规则 |
|---|---|---|
| 剧情/镜头规划 | Qwen3.8 本地文本模型 | 输出结构化 manifest，不向用户暴露 schema |
| 角色与关键帧 | Qwen Image | 必须通过非黑、可解码和语义 QC |
| 参考图编辑/连续性 | Qwen Image Edit 2509 | 只在参考图链路真实可用后启用 |
| 镜头视频 | Wan2.2 Remix | 按镜头块生成，不把失败扩散到整片 |
| 补帧/超分 | RIFE、SeedVR2 | 仅作为后处理，不掩盖源视频失败 |
| 环境音/拟音 | MMAudio | 只能声明环境音和拟音，不宣称对白、配音或音乐 |
| 语音/对白/音乐 | 待真实验证 | 未验证前不进入默认成片承诺 |

模型路由器要依据显存、预计时长、队列、历史失败率和 QC 分数决策，而不是把所有模型名称交给用户选择。

## 7. Elysium 的新职责

Elysium 不再是“用户手动编排影视流程”的表单集合，而是：

- 接收一句话和必要确认；
- 展示自治 Agent 的进度与预览；
- 保存 manifest、版本、hash、receipt 和 QC；
- 支持暂停、恢复、取消、单镜头重做；
- 在最终验收处保留人工决策；
- 为专业用户提供渐进展开的诊断视图。

原有生产 DAG、依赖 hash、任务恢复和素材保留机制优先复用；默认入口不再要求用户逐项创建项目、单集、章节、分镜和授权。

## 8. 内部状态机

```text
draft
  → awaiting_authorization
  → queued
  → producing
  → awaiting_review
  → completed
```

任何节点失败进入 `needs_attention`，由系统先自动重试；只有超过预算、合规不明确或连续 QC 失败才通知用户。`manifestVersion` 和 `storyHash` 是所有状态转换的幂等键。重复确认不得重复创建章节或生成已通过资产。

## 9. 质量闭环

每个 task 必须产生：

```json
{
  "taskId": "shot-004",
  "inputHash": "...",
  "outputPath": "/root/autodl-fs/productions/...",
  "outputHash": "...",
  "model": "...",
  "parameters": {},
  "qc": {"technical": {}, "semantic": {}, "score": 0.0},
  "attempt": 1,
  "createdAt": "..."
}
```

只有 `technical.pass && semantic.pass` 才能进入下游。最终合成前再做一次全片连续性、时长、音画同步和黑帧检查。QC 失败原因必须可用于下一次提示词或路由调整。

## 10. 30/60/90 天实施顺序

### 0–14 天：真实性和零上传基线

- 冻结默认十五步 UI 的新增；
- 完成图像/视频/音频输出健康闸门；
- 生成 receipt、hash 和 QC 结果；
- 建立 `/root/autodl-fs/productions/<id>` 目录契约；
- 将需要文件上传的路径替换为共享路径引用；
- 用一个固定短剧意图跑通“规划→一镜头→QC→结果”。

**退出条件：** 不再出现“全黑文件却 succeeded”；一次链路上传次数为 0。

### 15–30 天：一句话 MVP

- 一个 Harness Skill 接收一句话并创建 manifest；
- 默认模型路由和自动重试；
- 六状态内部机；
- Elysium 单页进度和结果视图；
- 人工确认只保留授权与最终验收。

**退出条件：** 新用户无需理解章节、工作流、种子即可提交生产。

### 31–60 天：资产复用和局部重做

- 角色/场景 bible 与引用版本；
- 镜头级输入 hash 和受影响子树失效；
- 角色一致性、场景连续性语义 QC；
- 专业模式展示模型、成本、耗时和 QC 证据。

### 61–90 天：规模化和能力分层

- 依据并发、显存和历史成功率的路由器；
- 真实验证后的对白/配音能力再接入；
- 暂停恢复、队列公平性和资源预算；
- 与开源短剧工厂和通用视频 SaaS 做同输入基准测试。

## 11. 验收标准

### 必须通过

- 一句话输入，默认页面不超过一个；
- 从输入到提交生产人工操作不超过 3 分钟；
- 上传次数为 0，大文件全在 `/root/autodl-fs`；
- 黑帧、空文件、不可解码文件不得进入 `succeeded`；
- 失败镜头可单独重做；
- 已通过资产不重复生成；
- 重复点击和重复确认幂等；
- 刷新、Harness 重启后可恢复；
- 最终结果绑定 manifest、storyHash、QC receipt 和用户确认记录。

### 必须量化

- 自动恢复率；
- 单镜头平均重试次数；
- 首次通过率；
- 黑帧/空输出泄漏率（目标为 0）；
- 一句话到预览的 P50/P95 时长；
- 每分钟视频 GPU 时间和失败成本；
- 角色一致性和镜头连续性人工评分。

## 12. 明确不做

- 不先开发更多创建页、导演页、章节页；
- 不让用户选择模型、工作流、种子和显存；
- 不把 ComfyUI 原始 `/upload/image` 当作默认生产接口；
- 不在未验证语音能力前承诺对白、配音或音乐；
- 不以“拥有很多模型”宣称竞争力；
- 不在质量闸门之前启动大规模 GPU 生成；
- 不把导演风格描述成真实导演授权、本人背书或身份冒充。

## 13. 现状证据与落点

- 15 步创作状态：[`src/domain/creation.js:33`](../src/domain/creation.js:33)。
- 生产阶段仍是八个页面：[`src/presentation/studio/views/videos/Studio.js:6`](../src/presentation/studio/views/videos/Studio.js:6)。
- 已有从故事文本到规划、授权、生产的生产 Skill：[`../.dsh/skills/elysium-director/SKILL.md:24`](../../.dsh/skills/elysium-director/SKILL.md:24)。
- 任务依赖和 input hash：[`src/domain/episode.js:179`](../src/domain/episode.js:179)。
- 生产技术 QC 目前主要检查时长和音频：[`src/application/production-service.js:260`](../src/application/production-service.js:260)。
- Comfy 引擎仍有媒体上传路径：[`src/infrastructure/comfyui/engine.js:261`](../src/infrastructure/comfyui/engine.js:261)。
- Model API 共享路径校验：[`../llm-ai-model/services/model_api/main.py:98`](../../llm-ai-model/services/model_api/main.py:98)。
- Model API 端点清单：[`../llm-ai-model/services/model_api/main.py:138`](../../llm-ai-model/services/model_api/main.py:138)。
- 当前任务成功判定仍不足以证明媒体质量：[`../llm-ai-model/services/model_api/jobs.py:116`](../../llm-ai-model/services/model_api/jobs.py:116)。
- 路由 allowlist：[`../llm-ai-model/scripts/factory/route.sh:38`](../../llm-ai-model/scripts/factory/route.sh:38)。
- 模型能力边界与共享目录说明：[`../llm-ai-model/docs/model-api/README.md:35`](../../llm-ai-model/docs/model-api/README.md:35)。

以上文件位置是实施时的优先改造入口；服务器运行状态、模型输出质量和并发数据仍需在部署环境按本方案重新验证。

## 14. 第一批执行清单

1. 建立输出健康闸门测试样本：正常图、全黑图、空文件、坏视频、静音音频。
2. 固化 `/root/autodl-fs` manifest、receipt、QC 和产物目录契约。
3. 将现有单一短剧样例改为共享路径端到端测试，不上传任何媒体。
4. 以真实可用模型为依据注册默认路由；未验证能力标为 `disabled`。
5. 新建“一句话成片” Skill，只暴露意图、授权、进度和结果。
6. 通过基线后，再决定哪些 Elysium 页面删除、合并或仅放入专业模式。

**决策门：** 第 1–4 项未通过前，不进入 UI 重构和导演人格扩展；否则仍会围绕错误的“流程复杂度”继续打转。
