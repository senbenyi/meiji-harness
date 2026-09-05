# 极乐世界技术设计

## 1. 目标

以单集工作台替换现有“创作流程 / 素材项目 / 生产管理”三套入口，实现：

**故事 → 剧本与资产 → 长视频规划 → 文生图起始帧 → 后续关键帧 → 长视频章节 → 成片 → 人工终审**

用户首次确认内容权利和质量档后，系统自动运行到人工终审；只在无法自动恢复时进入“需要处理”。

## 2. 当前基线

可保留：

- `src/infrastructure/comfyui/`：模板扫描、参数注入、远程提交、任务恢复和产物下载。
- `templates/comfyui/`：`realvisxl-t2i`、`realvisxl-ipadapter` 与 `wan22-remix-long` 合同。
- `src/infrastructure/persistence/store.js`：目录约束、原子 JSON 写入和安全文件解析。
- `src/application/asset-service.js`：生成产物与上传素材归档。
- `src/application/legacy-factory-service.js`：FFmpeg 拼接、FFprobe 时长检查和成片哈希人审的兼容实现。
- `betterSidebar` 页签注册方式。

必须替换：

| 当前实现 | 问题 | 目标 |
| --- | --- | --- |
| `Workflow.js` | 仅本地 UI 草图，不保存、不生产 | 接入真实单集数据和任务状态 |
| `Factory.js` | 用户手写 JSON，独立于项目 | 并入单集工作台 |
| `projects/` 与 `factory/` 双存储 | 项目、单集和产物无法统一追踪 | 一个项目下管理多个单集 |
| 固定 2 镜、2 章节 | 无法按目标时长规划 | 章节数量动态计算 |
| 旧六锚点输入 | 与当前 SVI2Pro 契约不一致 | 1 张人物一致性首帧 + 6 段动作提示词 |
| `running Map` | 重启后执行态丢失 | 持久化任务队列并启动恢复 |
| 手动逐阶段运行 | 人工介入过多 | 依赖驱动的自动调度 |

插件工作流合同与模型仓库保持同步。正式生产前仍须通过远端节点和模型预检。

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
        ├─ RealVisXL：成年角色定妆图
        ├─ IP-Adapter：人物一致性章节首帧
        ├─ Wan2.2 Remix v3 + SVI2Pro：连续长视频章节
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
- 每章只生成一张人物一致性起始帧；其余连续性由 SVI2Pro latent 延续。
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

调度器按依赖拓扑选择可运行任务。P0 为避免状态文件并发覆盖，同一单集串行提交；后续并行化必须先改为单写入器或合并提交。

| 阶段 | 输入 | 执行 | 输出 |
| --- | --- | --- | --- |
| story | 用户故事、时长、风格 | 校验并保存 | `episode.json` |
| script | 故事 | Producer Agent 生成并校验结构 | `script.json` |
| assets | 剧本、风格 | 提取资产；RealVisXL 生成定妆/场景图 | 采用的资产版本 |
| plan | 剧本、目标时长 | 生成叙事镜头、锚点和动态章节 | `plan.json` |
| start_frame | 每章第 1 锚点、采用资产 | `realvisxl-ipadapter` | 人物一致性起始帧 |
| chapter | 起始帧、6 段动作提示词 | `wan22-remix-long` | SVI2Pro 连续章节视频 |
| final | 所有采用章节 | 拼接、24fps 运动插帧、目标画幅标准化、精确时长裁切 | 静音成片 |
| audio | 静音成片 | MMAudio 生成同步环境音与拟音，25fps 输出并检查音轨及时长 | 有声成片与 QC |
| review | 当前成片 | 人工完整观看 | 哈希绑定的验收记录 |

规划规则：

- 目标时长决定章节数量，不写死 2 章。
- 一个章节固定 6 个锚点和 6 段动作提示词。
- 最后一章锚点不足时先调整叙事密度；仍不足必须记录 `hold`、`reuse` 或补充锚点策略。
- 禁止静默复制一张图片填满六个输入。

自动重试默认值：图片任务 2 次、视频任务 2 次、合成任务 1 次；每次尝试都生成独立任务和产物记录。

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

## 8. 单插件模块

当前实现目录：

```text
src/
  bootstrap/
    plugin.ts              # 唯一组合根，装配插件生命周期与所有适配器
    config.ts              # 单插件统一配置实现
  domain/
    episode.js             # 单集、规划、锚点、任务图与依赖失效规则
    project.js             # 项目和镜头数据规则
    errors.js              # 领域错误模型
  application/             # 规划、调度、生成、合成与兼容用例
  infrastructure/
    comfyui/               # 内置远程 ComfyUI 合同驱动
    persistence/store.js   # 文件持久化与路径约束
    workspace/             # 文件和浏览器技术适配
  presentation/
    dsh/                   # DSH 路由、聊天工具、宿主服务和生命周期桥接
    studio/                # 单集生产工作台 UI
    workbench/             # 文件、浏览器和后台任务 UI
  public/client/           # 稳定扩展 API 兼容出口
  shared/                  # 跨层最小共享类型和约束
  index.ts                 # 稳定包入口
  config.ts                # 稳定配置入口
  invariant.ts             # 稳定运行时约束入口
```

只有 `@dsh-external/dsh-elysium` 一个安装身份、一个客户端 bundle 和一个 Cordis
配置块。`ctx.betterSidebar`、`/sidebar/*`、`/elysium/*` 与聊天工具名保持兼容；
远程 ComfyUI 驱动已内置，不再作为独立插件或依赖存在。

代码依赖以领域规则为中心：`domain/` 不引用界面、DSH、ComfyUI 或文件存储；
`application/` 执行用例并通过明确的基础设施模块完成持久化与远程调用；`presentation/`
只承载 UI、DSH 协议和宿主桥接；`bootstrap/` 负责插件级装配。根级入口只做稳定转发，
避免内部目录重组再次破坏包使用方。

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

- 顶部：项目、单集、目标时长、画幅、质量档、总体状态、开始/暂停。
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

完成条件：动态章节、单首帧 SVI 连续性和局部失效可用纯数据测试验证。

### P0-2：模型阶段

- 接入定妆和起始帧 T2I。
- 预检 RealVisXL 与 IP-Adapter 合同，再生成每章人物一致性首帧。
- 动态提交每章单首帧、六段提示词的 Wan2.2 Remix v3 + SVI2Pro。
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
6. 合同缺失和连续失败进入“需要处理”。
7. 技术 QC 与人工终审严格分离。
8. 页面刷新后恢复工作台位置和生产状态。
9. 旧数据不被自动迁移、删除或覆盖。

验证分层：单元测试 → API 集成测试 → 浏览器交互测试 → 远端 ComfyUI 预检 → 经授权的真实图片/视频生产 → 人工成片验收。
