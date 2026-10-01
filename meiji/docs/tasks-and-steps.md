# 任务与步骤

执行模型只有一条：**操作 → 任务 → 步骤 → 内容节点**。

| 概念 | 是什么 | 状态 | 状态由谁决定 | 位置 |
|---|---|---|---|---|
| 操作 | 按钮或会话工具对应的定义 | 无 | — | `server/flow/operations/registry.js` |
| 任务 | 一次操作的执行实例 | 排队中 / 执行中 / 等待人工（预留）/ 完成 / 审核未通过 / 失败 / 已取消 | 只从步骤推导 | `projects/<id>/history/tasks/<taskId>.json` |
| 步骤 | 任务里的一次具体工作 | 未执行 / 执行中 / 等待人工（预留）/ 完成 / 失败 / 已取消 / 已跳过 | 执行器（`runStep`） | 任务文件内 `steps` |
| 内容节点 | 项目里的一块内容（摘要、镜头表、S01 视频……） | 未生成 / 生成中 / 通过 / 失败 / 已过期 | 步骤写入、人工编辑、上游变化 | 项目剧集文件 |

- 任务与内容节点是多对多：一次逐镜成片写入所有镜头；一个节点历史上被多次任务写入。
- 节点的通过/失败描述当前内容是否有效，与某次任务的成败无关。

## 操作定义

`registry.js` 的 `definitions` 为每个操作给出：

| 字段 | 含义 |
|---|---|
| `label` | 显示名称 |
| `scope` | `project` / `episode` / `shot`：是否需要剧集作用域 |
| `queue` | `text` / `image` / `video`：只有调用图片或视频接口的操作占用 image / video 名额 |
| `plan(project, operation)` | 步骤计划 `[{ kind, target }]`，由处理函数经 `runStep` 执行 |
| `step(operation)` | 没有 `plan` 的操作整体作为一个步骤由执行入口执行（默认 `execute`；人工编辑为 `save`） |
| `agent` | 会话工具能否发起；人工专属操作（忽略自审、确认图片、编辑与删除）为 `false`，会话发起返回 403 |
| `task` | 能否经任务管理排队；`false` 的只能由面板直接执行 |

单镜制作步骤 `shotPlan(track)`：文本分镜的生成 → 自审 →（需要时）修订 → 复审 → 提交视频 → 生成视频。`produce`（单镜）与 `produce-all`（逐镜）共用；执行时按最新内容跳过已完成的部分（`operations/films.js` 的 `shotSteps`），任一步未通过即停止，因为后一镜依赖前一镜的尾帧。

图片计划顺序：`image_generate → image_download → image_save`。调用 API、下载并转 Base64、保存候选图片分别记录状态、时间与失败原因，任一步失败后不执行后续步骤。旧 `b64_json` 响应无需下载和转换，ComfyUI 保持自身生成流程，未执行的下载并转 Base64 步骤在任务结束时记为已跳过。候选登记位于保存步骤内，只有人工确认后才入素材库。

## 步骤

```js
{ id, kind, target, label, status, verdict, reasons, error, actor, attempts, inputs, outputs, startedAt, endedAt,
  scope, remoteId?, saved?, apiFailure?, preparing?, unplanned?, prompts? }
```

| kind | 执行者（worker） |
|---|---|
| generate / revise | `generateStep`（请求、续传补全、格式校验、保存草稿） |
| review / re_review | `reviewStep`（必须返回 PASS 或「FAIL 原因」） |
| save | 人工编辑的保存 |
| check | 保存时的内容校验不通过（如时长不符），只记结论 |
| override | 人工忽略自审 |
| video_submit / video_generate | 提交成片（参考图读取本地文件转为 base64）/ 等待远端并保存成片与尾帧；`remoteId` 为远端任务编号 |
| image_generate | 调用图片 API（人物、场景、部件、铅笔分镜） |
| image_download | 下载网关响应 URL 的图片并转为 Base64 |
| image_save | 图片处理、保存候选图片并登记到项目，等待人工确认 |
| tail_frame / assemble / confirm / execute | 重新处理尾帧 / 全片拼接 / 确认或放弃候选图片 / 其他操作整体 |
| checkpoint | 人工关卡（预留） |

- `target`：写入的内容，如 `summary`、`story`、`shots`、`seconds`、`storyboard:S01`、`film:S01`、`image:C01`。
- `status` 与 `verdict` 分开：自审返回 FAIL 是「完成 + 不通过」，不是执行失败。
- `attempts`：同一步骤内的多次请求（整集每秒指令续传最多 3 次），不拆成独立步骤。
- `actor`：`model` / `human`。
- `scope`：逐镜成片的每个子操作一个作用域，接口失败回退与草稿判断只看本作用域的步骤。
- `saved`：生成或审核步骤已保存草稿；`apiFailure`：步骤中发生接口失败（中止不算）。两者供 `operations/finish.js` 判断接口失败时是否回退内容。

## 执行

### 查看步骤提示词

「当前任务」和「任务历史」在生成、自审、修订、复审、图片生成、视频提交步骤显示「查看提示词」。请求发出前将实际完整 messages（含 system/user）或媒体 prompt 原子保存到 `history/prompts/<promptId>.json`；`steps.prompts` 仅保存 `{ id, kind, createdAt }`，不增加任务列表的正文体积。同一步的续传等多次请求分别保存，接口失败后仍可查看。

点击后沿用项目会话授权，按 taskId/stepId 校验归属并加载弹窗，完整展示每次请求、支持复制及失败重试。快照不保存请求头、API 密钥或参考图片 Base64。删除剧集时同时删除其任务的提示词记录，包括生成后才绑定集编号的任务。

未执行和已跳过且没有快照的步骤按钮禁用；已执行的旧步骤允许点击。没有快照时，通过任务所属会话的公开 `snapshotEvents` 读取当时的脱敏请求日志，弹窗标明来源。仅在日志存在明确任务起止边界且该步骤类型在任务中唯一时读取；同会话任务并发、同类多步骤或日志缺失时不推测归属，说明无完整记录。新字段为任务 schemaVersion 2 的可选记录，不放宽对旧任务 schemaVersion 的拒绝；不使用当前项目资料重建历史提示词，也不读取 Harness 私有文件。更新后端后需重启已配置 Harness 才能为新请求保存快照。

- 入队时（`tasks/runner.js`）写入任务记录与完整步骤计划，全部未执行 = 排队中；写入按发起顺序串行，先发起的先入队。
- 出队时（`beginTask`）按最新内容重写计划，并把第一个步骤记为「准备中」的执行中；执行器真正开始某个步骤时，准备中的步骤要么就是它，要么恢复为未执行。
- `runStep(kind, run, { target, label, remoteId })` 按「种类 + 目标」对应到第一个未执行的计划步骤；计划外的步骤追加并标 `unplanned`。
- 文本步骤（`server/generate/text-steps.js`）：`textSteps(...)` 声明 `[生成, 自审, 修订（自审不通过且可修订时）, 复审（已修订时）]`，由 `shared/steps.js` 的 `executeSteps` 顺序执行。只在 FAIL 且可修订时修订一次；接口异常、空结果、格式错误和无效审核协议不触发修订。
- 逐镜成片经 `deps.runOperation` 调用子操作（`shot-storyboard`、`film`）；子操作复用同一任务（嵌套执行：不另加锁、不单独结束任务），所有镜头的步骤都在同一个任务记录里。
- 任务结束（`finalizeSteps`）：
  - 被中止：执行中的步骤记为已取消；尚未开始时第一个未执行步骤记为已取消。
  - 内容校验不通过（`CONTENT_CHECK_FAILED`）：最新结论中还没有不通过时追加一个 `check` 步骤。
  - 其他错误：没有失败步骤时，执行中或第一个未执行步骤记为失败。
  - 没有失败或取消时，其余未执行步骤记为已跳过。
- 服务重启：未结束的任务一律按中止落定（`recordStore.interrupt`），网关不提供取消接口，已提交的远端视频如实记录可能仍在运行，不续查、不自动重做。

## 任务状态推导

`shared/steps.js` 的 `deriveTaskStatus(steps)`，按优先级：

| 步骤情况 | 任务状态 |
|---|---|
| 没有步骤或全部未执行 | 排队中 |
| 有步骤执行中 | 执行中 |
| 有步骤等待人工（预留） | 等待人工 |
| 有步骤已取消 | 已取消 |
| 有步骤失败 | 失败 |
| 仍有未执行步骤（两个步骤之间） | 执行中 |
| 某个目标最新的审核结论为不通过 | 审核未通过 |
| 其余 | 完成 |

任务文件里的 `status` 只是缓存；任何代码都不直接给任务状态赋值。`reviewPassed(steps)`：有审核结论时，全部目标最新结论通过为 true。

## 人工忽略自审

| 规则 | 说明 |
|---|---|
| 作用于内容节点，不改原任务 | 原任务保持「审核未通过」；忽略是新任务 `review-override`，只含一个 `override` 步骤，执行者为人 |
| 保留 AI 理由 | 节点 `check` 为 `{ passed: true, failures: [], revision, override: { at, actor, reasons } }`；面板显示「人工放行」与原自审意见 |
| 只能在面板操作 | 操作定义 `agent: false`；会话工具发起返回 403 |
| 只忽略语义审核 | 内容为空或格式错误（解析失败）、正在生成、已过期时不可忽略（`shared/feedback.js` 的 `overrideBlocker`） |
| 只对当前版本有效 | 内容再次生成或编辑会写入新的 `check`，放行随之失效并重新自审 |

门禁只看 `check.passed`，因此人工放行视为通过。人工编辑后仍默认自审。

## 记录文件

任务：`projects/<projectId>/history/tasks/<taskId>.json`（`schemaVersion: 2`）

| 字段 | 含义 |
|---|---|
| id / projectId / episodeId | 任务、项目、剧集标识 |
| action / source / actor | 操作，panel/session/api，human/model |
| sessionId | 发起会话，用于日志和访问归属 |
| mode / requirements / opinion | 生成模式、本次要求、修改意见 |
| status | 由步骤推导的缓存 |
| startedAt / endedAt / error | 时间与错误 |
| steps | 步骤 |
| artifacts / latestOutputs | 本任务提交过的快照引用、各目标最新结果 |
| skills | 本任务使用的技能：`[{ id, layers, hash }]`，任务开始时固定（见「技能组装」） |

快照：`projects/<projectId>/history/artifacts/<artifactId>.json`

| 字段 | 含义 |
|---|---|
| id / projectId / episodeId / target | 快照标识与内容归属 |
| version / previousArtifactId | 目标内的版本与前版本 |
| taskId / stepId | 产生该版本的任务与步骤 |
| content / createdAt | 完整内容快照与保存时间 |
| published | 项目文件原子写入成功后置 true |
| baseline | 首次留痕前的已有内容基线；不伪造历史任务 |

记录粒度：summary、story（大纲/角色/场景整包）、shots（整集镜头表）、seconds（整集每秒指令）、storyboard:Sxx、film:Sxx、assembly。
保存顺序：快照落盘（published=false）→ 项目文件原子替换 → 快照标记发布并记入当前步骤的 outputs。跨文件不承诺事务。
视频快照记录不可变的本地文件名；删除项目或剧集同时清理所属历史。

不写任务记录的操作：没有项目（创建、打开、导入素材库），或会删除记录所在目录（删除项目、删除剧集）。

旧格式（`schemaVersion: 1`，`nodes`）的记录读取时报 `OLD_TASK_RECORDS`；`configure-harness.sh` 启动前执行 `node meiji/scripts/migrate-task-steps.js <DSH_HOME>` 迁移（先备份到 `backups/task-steps-<时间>/`，可重复执行）。

## 接口与页面

- `GET /plugins/meiji/tasks/current?projectId&episodeId&sessionId`：进行中与排队中的任务、步骤与排队位置（「当前任务」页）。
- `GET /plugins/meiji/tasks?projectId&sessionId`：状态栏的未结束任务；`POST` 停止任务。
- `GET /plugins/meiji/history?projectId&episodeId&sessionId[&artifactId]`：任务历史或指定快照。
- 「当前任务」（`client/current-task.js`）与「任务历史」（`client/execution-history.js`）共用步骤清单组件 `client/task-steps.js`：按目标分组，显示类型、状态、审核结论与理由、错误、执行者、起止时间；当前任务页高亮当前步骤并显示已用时间、尝试与远端任务编号，收到 `/events` 推送即刷新，不另行轮询。

## 提示词与请求

业务阶段 → 提示词编排 → 文本步骤 → 单次请求 → 模型网关。

- `server/prompts/story-prompts.js`、`shot-prompts.js`：编排剧集摘要、剧情整包、单类卡片、镜头表、单镜修改、每秒指令与文本分镜。
- `server/prompts/interfaces/<阶段>.js`：各接口独立定义生成、意见修改、审核和自动修订的角色、段落顺序与输出格式；图片和视频独立定义 prompt。
- `server/prompts/text-prompts.js`：按接口分发并序列化，不追加语言、协议或其他统一包装。
- `server/prompts/skill-prompts.js`：提供可选片段与来源标注（如【阶段技能·生成】【武术指导】【本剧补充·生成】），接口选择后才进入请求，面板预览按来源着色。
- `server/generate/text-request.js`：`runTextRequest` 每次只发送一个编排完整的请求，处理日志、取消信号和接口异常。

编排函数返回 `{ skill, system, user, json, segments }`（审核请求 `skill` 为 `review`，`stage` 为所审阶段）；system 非空时发送 system 消息，user 由接口决定。接口可以只发送 user。网络请求和鉴权继续共用。修改入口与示例见 [接口独立提示词](prompt-interfaces.md)。

### 技能组装

以下是迁移时各接口显式选择的初始结构，不是公共层强制的模板；每个接口可以独立调整所选片段、标题和角色。

| 请求 | system（按顺序） | user |
|---|---|---|
| 生成 | 阶段通用（含共享模块，如尾帧协议）→ 阶段生成 → 本剧启用且适用本阶段的指导（通用 + 本阶段落点）→ 本剧补充（通用、生成、指导）→ 指导素材编排规则（有素材时）→ 自检标准（阶段审核 + 指导审核 + 本剧审核补充）→ 语言 → 优先级 → 输出协议 | 任务与上下文 → 分类指导素材（按指导分组）→ 本次修改意见 |
| 意见修改 | 同生成，在语言前加修订边界（阶段修订 + 共享修订边界 + 本剧修订补充），语言含修订时的语言规则 | 同生成（含修改基稿） |
| 自动修订 | 同生成，自检标准换成修订边界 | 任务与上下文 → 失败稿 → 失败原因 → 原人工意见 |
| 审核 | 审核通用协议 → 本阶段共享审核模块（镜头类审核、尾帧协议）→ 素材编排规则 → 语言 → PASS/FAIL 协议 | 阶段 → 任务与上下文 → 修改意见 → 验收标准（阶段审核 + 指导审核）→ 本剧补充 → 分类指导素材 → 连续性资料 → 待审内容 |
| 图片 | —（图片接口只有一段 prompt） | 画面要求 → 本剧补充 → 语言 → 视觉风格 → 本次画面要求 |
| 成片 | — | 最终视频提示词后追加成片技能的基础要求与本剧补充（内置为空） |

优先级（写入提示词）：输出协议 > 上游事实与本次任务 > 本剧补充 > 阶段技能 > 指导技能 > 指导素材。审核请求不附生成技能与官方参考；摘要与图片请求不使用指导技能。

技能三层：内置（`skills/`）→ 基础（面板修改，`storages/meiji/skills/<id>.json`，按字段替换内置，对所有剧生效）→ 本剧（项目索引 `skills`，追加）。任务开始执行时（`startExecution`）用 `loadSkillSet` 固定一份组合，嵌套子操作沿用；同一任务的生成、审核、修订使用同一版本，进行中的任务不受中途修改影响。任务记录写入 `skills: [{ id, layers, hash }]`（`layers` 含 `builtin`，修改过为 `base`，有本剧补充为 `project`），任务历史显示所用技能。

固定约束例外：人物图通过 `fixedConstraints: true` 读取 `skills/task/generate-character-image-skill.md`，其 `fields: []`，不再有可编辑 generate 字段，也不应用旧基础覆盖或本剧补充。固定文本纳入任务快照和内容哈希，页面/API 只读；空文件表示不注入固定约束，不使用代码默认值。所有功能均按单一只读基础生产规则管理，生成与审核共用，修订由 Model 增加基稿及意见。

面板接口（只接受同源请求，会话 agent 无对应工具）：`GET /skills`、`GET /skills/<id>`、`PUT /skills/<id>`（须 `confirm: true`）、`POST /skills/<id>/reset`、`POST /skills/<id>/preview`、`PUT /project-skills`、`PUT /project-guidance`。生成和修订剧情资料用 JSON 输出，镜头表与每秒指令用自由文本，审核用 PASS/FAIL。

剧情整包、人物卡、场景卡、镜头表与每秒指令都在自审前保存生成稿；自审或修订接口异常保留最新已保存稿，生成接口尚未产生有效稿时回退到原内容。未完成审核不标记通过。保存沿用 `revisionStore` 的依赖检查。人工编辑只执行保存与自审步骤。

剧情重新生成只接收项目总背景、剧本、本集时长/集数/风格/画幅和前后集衔接约束，不接收本集旧摘要、旧剧情或历史意见；人工修订接收本集摘要、完整剧情基稿与修改意见；审核只接收本次任务上下文与最新待审稿。

## 验证

`tests/task-steps.test.js`（状态推导、结束落定、计划与执行一一对应、逐镜成片单一任务、人工专属操作、忽略自审、当前任务、迁移）、`task-store`、`reviewed-generation`、`prompt-nodes`、`api-failure-state`、`model-ui`（步骤清单、当前任务页、忽略按钮）；技能：`skill`（结构、组装、官方参考按模式、图片提示词、指导）、`skill-store`（基础层、任务固定技能版本、接口）、`custom-skills` / `guidance`（本剧补充与指导素材）、`guidance-ui`（入口、详情页、技能库、历史）、`migrate-custom-skills`。运行 `npm test`，测试使用模拟接口。
