# 极乐世界技术设计

## 1. 目标

以单集工作台替换现有“创作流程 / 素材项目 / 生产管理”三套入口，实现：

**故事 → 剧本与资产 → 长视频规划 → 文生图起始帧 → 后续关键帧 → 长视频章节 → 成片 → 人工终审**

用户首次确认内容权利、质量档和预算后，系统自动运行到人工终审；只在无法自动恢复时进入“需要处理”。

## 2. 当前基线

可保留：

- `server/comfyui/`：模板扫描、参数注入、远程提交、任务恢复和产物下载。
- `templates/comfyui/`：`qwen-image-t2i` 与 `wan22-remix-long` 合同。
- `store.js`：目录约束、原子 JSON 写入和安全文件解析。
- `assets.js`：生成产物与上传素材归档。
- `factory.js`：FFmpeg 拼接、FFprobe 时长检查和成片哈希人审的实现思路。
- `betterSidebar` 页签注册方式。

必须替换：

| 当前实现 | 问题 | 目标 |
| --- | --- | --- |
| `Workflow.js` | 仅本地 UI 草图，不保存、不生产 | 接入真实单集数据和任务状态 |
| `Factory.js` | 用户手写 JSON，独立于项目 | 并入单集工作台 |
| `projects/` 与 `factory/` 双存储 | 项目、单集和产物无法统一追踪 | 一个项目下管理多个单集 |
| 固定 2 镜、2 章节 | 无法按目标时长规划 | 章节数量动态计算 |
| 每章重复同一张图 6 次 | 不是真实六锚点长视频 | 1 张起始帧 + 5 张后续关键帧 |
| `running Map` | 重启后执行态丢失 | 持久化任务队列并启动恢复 |
| 手动逐阶段运行 | 人工介入过多 | 依赖驱动的自动调度 |

插件已从模型仓库引入 Qwen Image Edit 2509 工作流合同。正式生产前仍须通过远端节点和模型预检；不能用 `anima-i2i` 冒充。

## 3. 总体结构

```text
单集工作台 / DeepSeek 对话
        │
        ▼
Elysium API + Producer Agent
        │
        ▼
Episode Orchestrator
  ├─ 依赖计算与失效传播
  ├─ 持久化任务队列
  ├─ 自动重试与问题汇总
  └─ 版本采用与来源追踪
        │
        ├─ Qwen T2I：定妆图、章节起始帧
        ├─ Qwen Image Edit：后续关键帧
        ├─ Wan2.2 Remix：六锚点长视频章节
        └─ FFmpeg / FFprobe：成片与技术 QC
```

职责边界：

- Producer Agent：把自然语言故事转换为结构化剧本、资产和长视频规划。
- Orchestrator：只执行确定性状态流，不自行猜测业务内容。
- ComfyUI Driver：按合同提交模型任务，不承载产品状态。
- UI：展示同一份服务端状态，不在浏览器保存生产真相。

## 4. 存储模型

继续使用文件存储和原子写入，P0 不引入数据库。

```text
elysium-workspace/projects/<projectId>/
  project.json
  episodes/<episodeId>/
    episode.json
    script.json
    assets.json
    plan.json
    state.json
    tasks.json
    issues.json
    artifacts/
      anchors/<anchorVersion files>
      chapters/<chapterVersion files>
      final/<finalVersion files>
```

核心实体：

| 实体 | 必要字段 |
| --- | --- |
| Project | `id`、`title`、`styleBible`、`createdAt`、`updatedAt` |
| Episode | `id`、`projectId`、`title`、`sourceText`、`targetDurationSec`、`profile`、`budget`、`status`、`activeStage` |
| Asset | `id`、`type`、`prompt`、`adoptedVersionId`、`revision` |
| Anchor | `id`、`chapterId`、`order`、`role`、`prompt`、`imageVersionId`、`dependencyHash`、`status` |
| Chapter | `id`、`order`、`anchorIds[6]`、`motionPrompts[6]`、`videoVersionId`、`status` |
| Task | `id`、`type`、`entityId`、`inputHash`、`status`、`attempt`、`maxAttempts`、`remoteJobId`、`error` |
| ArtifactVersion | `id`、`kind`、`entityId`、`path`、`template`、`args`、`seed`、`inputVersions`、`sha256`、`qc`、`createdAt` |
| Issue | `id`、`taskId`、`code`、`message`、`resolutionOptions`、`status` |
| Approval | `reviewer`、`reviewedAt`、`finalVersionId`、`finalSha256` |

约束：

- 每章恰好 6 个有序锚点；第 1 个 `role=start`，其余 5 个 `role=continuation`。
- 起始帧属于六锚点，不额外增加模型输入。
- 所有生成产物只新增版本；`adoptedVersionId` 决定当前采用版本。
- `inputHash` 由模板版本、提示词、参数、种子和上游采用版本计算，用于复用与失效判断。

## 5. 状态机

单集状态：

```text
draft → ready → running → awaiting_review → approved
                   ├─ paused
                   └─ needs_attention
```

任务状态：

```text
pending → queued → running → succeeded
                     ├─ retry_wait → queued
                     ├─ needs_attention
                     └─ cancelled
succeeded → stale
```

规则：

- `paused` 只停止提交新任务；已经产生费用的远端任务继续收敛并保存结果。
- 进程重启时，带 `remoteJobId` 的任务向 ComfyUI 历史恢复；没有远端 ID 的 `queued/running` 任务回到 `pending`。
- 常规错误按退避策略自动重试；合规、输入缺失、合同不兼容、连续失败和超预算进入 `needs_attention`。
- 技术 QC 通过只能进入 `awaiting_review`；人工终审绑定当前成片哈希后才能 `approved`。

## 6. 自动生产编排

调度器按依赖拓扑选择可运行任务，同一单集串行修改状态，独立章节可以并行生成。

| 阶段 | 输入 | 执行 | 输出 |
| --- | --- | --- | --- |
| story | 用户故事、时长、风格 | 校验并保存 | `episode.json` |
| script | 故事 | Producer Agent 生成并校验结构 | `script.json` |
| assets | 剧本、风格 | 提取资产；Qwen T2I 生成定妆/场景图 | 采用的资产版本 |
| plan | 剧本、目标时长 | 生成叙事镜头、锚点和动态章节 | `plan.json` |
| start_frame | 每章第 1 锚点、采用资产 | `qwen-image-t2i` | 每章起始帧版本 |
| keyframes | 起始帧、采用资产、后续锚点 | `qwen-image-edit` | 每章 5 张后续关键帧 |
| chapter | 6 张有序锚点、6 段动作提示词 | `wan22-remix-long` | 章节视频版本 |
| final | 所有采用章节 | 拼接、24fps、竖屏标准化、转场 | 成片版本与 QC |
| review | 当前成片 | 人工完整观看 | 哈希绑定的验收记录 |

规划规则：

- 目标时长决定章节数量，不写死 2 章。
- 一个章节固定 6 个锚点和 6 段动作提示词。
- 最后一章锚点不足时先调整叙事密度；仍不足必须记录 `hold`、`reuse` 或补充锚点策略。
- 禁止静默复制一张图片填满六个输入。

自动重试默认值：图片任务 2 次、视频任务 2 次、合成任务 1 次；每次尝试都生成独立任务和产物记录。具体次数允许配置，但不能突破预算。

## 7. 依赖与局部重做

| 变化 | 标记失效 |
| --- | --- |
| 故事、目标时长、剧本 | 相关资产、规划、锚点、章节、成片 |
| 资产采用版本 | 引用该资产的起始帧、后续关键帧、章节、成片 |
| 起始帧采用版本 | 本章 5 张后续关键帧、章节、成片 |
| 后续关键帧采用版本 | 本章章节、成片 |
| 锚点顺序或章节边界 | 受影响章节及成片 |
| 章节采用版本 | 成片 |
| 成片版本 | 旧人工验收 |

失效只修改状态，不删除旧产物。重新调度前先查找相同 `inputHash` 的成功版本，命中则直接复用。

## 8. 服务端模块

P0 实现目录：

```text
server/
  lib/
    episodes.js           # 单集 schema、存储、任务图与依赖失效
    production.js         # 调度、恢复、重试、模型阶段、合成与 QC
    factory.js            # 旧 VMP V1 兼容入口
  comfyui/                # 保留现有合同驱动
```

关键实现要求：

- 所有单集写操作经过 `episodeId` 级互斥锁。
- 状态先持久化为 `queued`，再提交远端任务；远端 ID 返回后立即持久化。
- 调度器启动时扫描未结束单集并恢复，不依赖进程内 `Map` 作为真相。
- Producer Agent 输出必须经过 JSON Schema 校验；不合法结果可自动修复一次，仍失败则进入“需要处理”。
- 模型合同先执行远端节点与模型预检，通过后才允许产生付费任务。

## 9. API

新增 API 使用现有 `/elysium/api` 前缀：

| 路由 | 作用 |
| --- | --- |
| `/project.list`、`/project.create`、`/project.get` | 项目管理 |
| `/episode.list`、`/episode.create`、`/episode.get`、`/episode.update` | 单集与故事输入 |
| `/production.start`、`/production.pause`、`/production.resume` | 自动生产控制 |
| `/production.status` | 单集、阶段、任务和问题快照 |
| `/production.retry` | 精确重试任务或实体 |
| `/artifact.adopt` | 手动采用指定版本 |
| `/issue.resolve` | 处理集中异常 |
| `/review.approve` | 绑定成片哈希的人审 |

`/factory.execute` 暂时保留为兼容入口，但内部转调新服务；新 UI 不再直接使用旧 `vmp-1` JSON。

聊天工具调整为同一组领域动作，不再暴露固定 `shot-01`、`block-01` 等实现细节。GPU 阶段仍要求一次明确授权，授权记录写入单集。

## 10. UI

仅保留两个一级入口：

1. 项目：项目、单集、最近进度和需要处理。
2. 单集工作台：完成一集生产。

工作台结构：

- 顶部：项目、单集、目标时长、质量档、预算、总体状态、开始/暂停。
- 左侧：故事、剧本、资产、长视频规划、文生图起始帧、故事关键帧、长视频章节、成片。
- 中间：当前阶段的结构化产物和版本。
- 右侧：自动任务、重试信息和“需要处理”，默认可收起。

交互规则：

- 默认展示结果和异常，不要求用户手动推进每个阶段。
- 每章明确展示 1 张起始帧和 5 张后续关键帧。
- 修改上游前展示失效范围；确认后只重做受影响部分。
- 任务详情默认折叠，错误展示可执行的处理动作，不直接展示原始 JSON。
- 页面重开后从服务端恢复当前单集、阶段和任务状态。

## 11. 迁移与实施顺序

### P0-1：领域与存储

- 新增项目/单集统一 schema、状态机、版本和依赖哈希。
- 建立单集级锁、任务队列和启动恢复。
- 旧 `projects/`、`factory/` 数据只读保留，不自动删除或覆盖。

完成条件：动态章节、六锚点和局部失效可用纯数据测试验证。

### P0-2：模型阶段

- 接入定妆和起始帧 T2I。
- 预检已引入的 Qwen Image Edit 2509 合同，再生成 5 张后续关键帧。
- 动态提交每章六锚点 Wan2.2 Remix。
- 接入产物版本、技术 QC、自动重试和复用。

完成条件：测试桩能跑通多章节；真实 ComfyUI 验证需单独授权 GPU 成本。

### P0-3：单集工作台

- 用真实工作台替换 `Workflow.js` 和 `Factory.js`。
- 接入项目、单集、阶段导航、任务和异常面板。
- 保留设置页；旧素材页面在新资产页覆盖后移除入口。

完成条件：刷新页面可恢复状态，用户无需编辑 JSON 或逐阶段启动。

### P0-4：对话与验收

- Producer Agent 生成结构化剧本和规划。
- 更新聊天工具与技能说明。
- 完成成片 QC、播放、人审哈希绑定和旧接口兼容。

完成条件：一次授权可自动运行到 `awaiting_review`，人工确认后进入 `approved`。

## 12. 验证

必须覆盖：

1. 每章严格为 1 张起始帧、5 张后续关键帧和 6 段动作提示词。
2. 40、60、120 秒目标可生成动态章节，不依赖固定数量。
3. 重启后恢复远端任务，不重复已成功或已付费步骤。
4. 上游变化只使依赖产物失效，历史版本仍可读取。
5. 相同 `inputHash` 命中时复用产物。
6. 超预算、合同缺失和连续失败进入“需要处理”。
7. 技术 QC 与人工终审严格分离。
8. 页面刷新后恢复工作台位置和生产状态。
9. 旧数据不被自动迁移、删除或覆盖。

验证分层：单元测试 → API 集成测试 → 浏览器交互测试 → 远端 ComfyUI 预检 → 经授权的真实图片/视频生产 → 人工成片验收。
