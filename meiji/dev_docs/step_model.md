# 任务与步骤

任务、步骤和任务组的字段与状态。项目数据结构与逐字段注释见 [project_detail.json](project_detail.json)。节点的状态、原因和依赖 hash 统一收纳在 `node_state` JSON 对象中。

## 状态枚举

节点状态存在项目 JSON 里，和原因一起保存。面板直接读项目，不从历史任务推算。

| 值 | 名称 | 来源 | 可作下游输入 | 原因 |
|---|---|---|---|---|
| `empty` | 未生成 | 创建空节点 | 否 | 空 |
| `generated` | 已生成 | 任务通过或人工放行 | 内容结构与当前依赖仍有效时可用 | 空 |
| `rejected` | 未通过 | 已有产出，但程序审核或 AI 审核未通过；修订次数用尽后保存最后一轮候选 | 否 | 非空 |
| `expired` | 已过期 | 上游变化使已生成内容失效，内容保留 | 否 | 非空 |

入队、开始、失败、取消均不改节点数据状态和原因。`previous_node_state` 仅记录入队时的数据快照，不再用于取消后恢复。上游变化仍按过期规则更新数据；完成或审核未通过才更新为 generated 或 rejected。执行状态和失败原因分别读取任务的 task_status、end_reason。

人工放行是唯一由人改节点状态的入口：新建 `override` 任务，只跳过 AI 审核。结构与本节点的程序审核仍须通过，包括时长范围和允许误差；通过后保留稿件，状态写成 `generated`，原因清空并记录当前依赖 hash。旧任务不变。人工编辑则沿用独立的结构校验流程，不因人工放行规则改变其步骤。

任务状态：

| 值 | 名称 | 说明 |
|---|---|---|
| `queued` | 排队中 | |
| `running` | 生成中 | |
| `completed` | 已通过 | |
| `rejected` | 未通过 | 有产出，但程序审核或 AI 审核未通过 |
| `failed` | 失败 | 执行出错，没有产出 |
| `cancelled` | 已取消 | 用户取消、服务重启时尚未完成的任务，以及组里前面的任务停下后还没执行的任务。旧记录里的 `superseded` 同样显示已取消 |
| `superseded` | 已取消 | 旧存储值，新结算不再写入 |

任务一停就是终态。重新生成、继续、人工编辑、人工放行都新建任务。继续一组时新建任务组。

步骤状态：

| 值 | 名称 | 说明 |
|---|---|---|
| `ready` | 等待中 | |
| `running` | 执行中 | |
| `done` | 完成 | |
| `rejected` | 未通过 | 有产出，但程序审核或 AI 审核未通过；原因记录在步骤结果 |
| `failed` | 失败 | HTTP、网络、超时等执行异常，没有可用产出 |
| `skipped` | 已跳过 | |
| `cancelled` | 已取消 | 未执行或被停止。旧记录里的 `superseded` 同样显示已取消 |
| `superseded` | 已取消 | 旧存储值，新结算不再写入 |

任务来源：`panel` 面板，`session` 会话。

## 任务组字段

`status` 和 `reason` 不存储，只按本组任务计算。按 `group_seq` 排序后：先看第一个 `rejected`、`failed`、`cancelled` 或旧的 `superseded`，原因用该任务的 `end_reason`；取消和旧作废都显示已取消。否则有 `running` 就是生成中；否则有 `queued` 就是排队中；任务非空且全部 `completed` 就是已通过。后来的新组、人工放行或编辑不改旧组结果。

| 字段 | 示例 | 说明 |
|---|---|---|
| `id` | `tg_uuid` | 任务组 id |
| `project_id` | `p_uuid` | 项目 |
| `episode_id` | `e_uuid` | 按集查询；成片组的成员归属和合片目标须与本集一致。项目、角色、服装的组留空 |
| `name` | 第 1 集成片 | 展示名 |
| `group_type` | `episode-film` | 见下表 |
| `source` | `panel` | 面板或会话 |
| `shot_ids` | `["s_uuid"]` | 本组逐镜任务的镜头范围。成片组的合片任务以本组 `episode_id` 定位，不加入此数组；单任务可为空 |
| `status` | | 计算字段，不存储 |
| `reason` | | 计算字段，不存储 |
| `created_at` | | 创建时间 |
| `action` | `generate` | 成片提交默认为 `generate`（补缺），`regenerate` 重跑所选逐镜节点；继续产生的新组为 `continue` |

组类型：

| 值 | 名称 | 说明 |
|---|---|---|
| `single` | 单任务 | 一次独立操作默认建组。可以没有 `episode_id`，`shot_ids` 为空 |
| `workflow` | 派生流程 | 角色提取仅提取；全集规划仅创建各集规划；人物定妆照单独组按服装顺序排入图片任务 |
| `episode-seconds` | 每秒分镜 | 接口逐镜每秒分镜；面板通过成片组执行 |
| `episode-film` | 成片 | 按镜头顺序逐镜执行：每秒分镜、文生视频提示词、按生成视频类型可选的首尾帧/多模态提示词、视频。视频任务内截取尾帧。可用 `shot_id` 限定当前剧集的一镜；所选任务完成且全剧集视频有效后，在同组追加合片 |

组里任一任务失败、未通过或取消，后面还没执行的任务记为 `cancelled`（已取消）；节点数据状态、原因和内容都不变，因为入队时本就没有改动节点。旧组、旧任务、旧步骤保持不动。

成片组 `generate` 跳过结构、状态和依赖均有效的节点，但本组或同集已排队的上游任务将使下游失效时不可跳过下游；`regenerate` 重跑所选逐镜节点。所选逐镜任务全部完成后，本集视频齐备且没有其他未结束的成片组任务，才在最后完成的组内追加唯一 `assembly`，且目标必须为本组 `episode_id`。不同单镜组可以按序排队。已有合片有效且依赖未变则不重复生成。逐镜任务仍必须属于 `shot_ids` 及本组剧集，不为允许合片而放松其他归属检查。

若停在视频程序编排且后面仍有视频任务，继续只重建视频入口，运行时按新绑定重新物化适用编排；不直接复制旧分支。其余继续时看这组按 `group_seq` 停在哪个任务，从该任务对应的节点起，按原顺序新建一个任务组。新组不记录来源组，`group_seq` 从 1 重新计。停点之前已完成的任务不进入新组；只有合片失败时，新组只建合片。该组已经全部完成时不建空组。修改意见只写在新组里的具体任务上。停点任务是未通过时，新任务的修改意见写成对应节点的未通过原因；后面的新任务不带这条原因。

创建或继续时，同一请求重复提交返回原组。其他请求先看目标节点是否已有 `queued` 或 `running` 任务，有重叠就整组拒绝，不建组、不改节点、不挪用旧任务。

## 任务字段

一个节点由 `business_type` + `target_id` 唯一确定。`target_id` 必填：项目 `p_`，剧集 `e_`，角色 `c_`，服装 `co_`，镜头 `s_`。`episode_id` 只用于按集查询，不参与定位；剧集和镜头任务必填，且与 `target_id` 所属剧集一致。

`costume-image` 有明确服装时使用 `target_id=co_id`，在所属角色的 `costume_images[]` 中按 `costume_id` 定位；仅在 `costumes: []` 时允许新任务使用 `target_id=c_id`，对应唯一 `costume_id: ""` 条目。以后新增明确服装，旧未绑定图片和任务历史仍保留，新任务不再采用角色 ID 目标。

| 字段 | 示例 | 说明 |
|---|---|---|
| `id` | `t_uuid` | 任务 id |
| `project_id` | `p_uuid` | 项目 |
| `episode_id` | `e_uuid` | 按集查询用，见上 |
| `business_type` | `outline` | 业务类型 |
| `target_id` | `e_uuid` | 目标对象 id |
| `action` | `generate` | 见下表 |
| `group_id` | `tg_uuid` | 所属任务组 |
| `group_seq` | `1` | 组内顺序 |
| `task_status` | `queued` | 任务状态 |
| `source` | `panel` | 面板或会话 |
| `name` | 第 1 集 · 生成分集改编 | 展示名 |
| `queue_order` | `1` | 队列顺序 |
| `end_reason` | | 终态原因 |
| `created_at` | | 创建时间 |
| `started_at` | | 开始时间 |
| `ended_at` | | 结束时间 |
| `opinion` | | 修改意见。只记在任务上，任务组不记 |
| `previous_node_state` | `{ status, reason, fail_message }` | 入队前的节点状态、原因和失败说明 |

动作：

| 值 | 名称 | 说明 |
|---|---|---|
| `generate` | AI 生成 | 新建任务。是否可做由前置检查决定 |
| `regenerate` | 重新生成 | 新建任务；文本首轮只用当前资料，不带上次结果 |
| `revise` | 原结果修订 | 单个文本节点，非空意见；通过多轮 assistant 带入上次完整结果 |
| `continue` | 继续 | 只用于组合入口。按原组进度从断点新建任务组 |
| `manual_edit` | 人工编辑保存 | 新建 `precheck` → `manual_edit` |
| `override` | 人工放行 | 新建 `precheck` → `override`。结构和程序审核通过后节点写成 `generated`、原因清空。只跳过 AI 审核，旧任务保持原终态 |
| `delete` | 删除资料 | 新建删除任务 |

每个任务的第一步是程序 `precheck`：目标是否属于该项目、原状态是否允许、必需输入是否已生成、实际使用的素材和参数。人工放行在这里检查未通过的稿。人工编辑的 `precheck` 直接通过，结构在后面的 `manual_edit` 步校验；不合法则该步和任务 `rejected`，旧稿保留。删除在 `precheck` 检查引用。前置业务检查未通过时任务记为 `rejected`，不调用模型，后面的步骤作废。生成之后先做程序审核，再做 AI 审核，各记一步，用步骤名称区分。时长在程序审核中判定，允许差值取该节点的误差时长。节点文档中的“重试轮次 N”是首次生成之后最多修订 N 次，生成与修订最多共 N+1 轮；程序审核和 AI 审核共用此计数。审核未通过且仍有修订次数时，把原因以及问题数组中的位置、依据和建议作为修改意见进入修订，再从程序审核做起。修订次数用尽仍未通过，才把最后一轮内容保存为未通过，原因分别写入 `node_state.reason` 和任务 `end_reason`，不更新下游依赖 hash。再次提交该节点时，必须将该原因作为修改意见带入任务和模型输入。误差时长和重试轮次写在各节点文档开头。`script-review` 为可选全文改编与审核：generate/regenerate仅precheck与AI审核，审核未通过停止且不改写；revise先按意见改编再审核，模型问题最多三次自动修订。改编结果作用于script.body及既有版本/修改记录，独立规则保存在script.adaptation_rules，不作为其他业务前置。`script-split` 是项目级 AI 任务：AI 生成全部分集安排，程序审核并写入各集plot规划文本。它不对应持久化项目节点，因此未通过原因和最后一轮候选记录在任务历史，不写项目 `node_state`，也不替换项目现有剧集。

## 步骤字段

| 字段 | 示例 | 说明 |
|---|---|---|
| `id` | `st_uuid` | 步骤 id |
| `task_id` | `t_uuid` | 所属任务 |
| `name` | 生成分集改编 | 展示名 |
| `seq` | `1` | 任务内顺序 |
| `kind` | `generate` | 见下表 |
| `round` | `1` | 轮次0至3：0为首次生成，1至3为修订及对应再审 |
| `step_status` | `ready` | 步骤状态 |
| `executor` | `ai` | 执行方式：调用模型（文本、图片、视频）为 `ai`，前置、程序审核、编排、人工与写回为 `program`；创建步骤时确定 |
| `error_reason` | | 失败原因 |
| `prompt` | `{ node, action, model, input, messages }` | 实际发给模型的消息与业务参数；`input` 中 base64 已脱敏；不保存 system/user/body 等可由 messages 推出的重复内容；程序步骤为 `null` |
| `http` | `[]` | 本步全部 HTTP 往来（请求与返回，已脱敏），每次调用一条 |
| `result` | | 本次结果 |
| `started_at` | | 开始时间 |
| `ended_at` | | 结束时间 |

工作快照仅保留仍有 queued/running 任务的整组任务与步骤，满足组内序号连续；整组全部结束并提交后移出内存，历史保留在 SQLite。启动同样只加载未结束组。工作步骤不含 `prompt`、`http`，仅带 `has_prompt`、`has_http` 两个计算标记；运行中的提示词与 HTTP 由任务管理器暂存，直接更新数据库对应步骤行，不增加项目 revision、不写幂等记录；当前任务结束后释放暂存。终态步骤拒绝迟到记录写入。

项目顶层 `latest_tasks` 保存「业务类型:目标ID → 最近任务ID」，`latest_groups` 保存最近成片/单镜成片/定妆照组ID；不进入节点依赖指纹。面板首次加载通过 `/api/meiji/records?task_ids=&group_ids=` 批量读取摘要并缓存，组状态事件与 links 增量更新节点关联。工作快照与组推送均不携带提示词和HTTP正文。面板响应的runtime只有revision，服务端幂等结果和通知记录不随面板传输。

打开任务组详情通过 `/api/meiji/group?group_id=` 一次读取本组任务、全部步骤和记录；会话 query 也按任务/组 ID 查询。切换提示词/HTTP视图不再请求。运行中记录变化经独立 record 事件通知，即使 revision 不变也使详情缓存刷新；不会重新读取整份项目。终态详情不再变化，可直接复用缓存。切换项目或会话清空缓存，晚到响应不能污染新页面。

历史列表经 `/api/meiji/history?status=&business=&episode=&offset=&limit=` 查询与分页，只读组、任务表，不读步骤；详情另按组ID获取。旧 `/api/meiji/step` 与 `/api/meiji/group-records` 不再使用。

步骤种类：

| 值 | 名称 | 说明 |
|---|---|---|
| `precheck` | 前置检查 | 每个任务的第一步 |
| `generate` | 生成 | |
| `review` | 审核 | 程序审核和 AI 审核各记一步，用步骤名称区分。程序审核在前，时长误差在这一步按节点误差时长判定。未通过且仍有修订次数时进入修订 |
| `revise` | 自审修订 | |
| `manual_edit` | 人工编辑保存 | 按结构校验保存，不调用 AI；结构错误保留旧稿 |
| `override` | 人工放行 | 只跳过 AI 审核，不绕过结构校验或本节点程序审核 |
| `impact` | 计算影响 | 删除资料时算出要标过期的节点，只记在步骤结果里，不改项目 |
| `apply` | 写入项目 | 删除资料并一次提交过期状态 |

## 节点字段

[project_detail.json](project_detail.json) 里每个节点都有一个 `node_state` JSON 对象，统一保存状态、原因和依赖 hash。各节点自己的内容字段以该 JSON 为准，这里不另写一套。

```json
"node_state": {
  "status": "empty",
  "reason": "",
  "fail_message": "",
  "dependency_hash": ""
}
```

| 字段 | 说明 |
|---|---|
| `node_state.status` | 节点状态枚举 |
| `node_state.reason` | 交给 AI 的原因。`rejected`、`expired` 非空；其余为空。时长不合适这类程序审核写在这里 |
| `node_state.fail_message` | 保留的空字段；失败原因只保存在任务 `end_reason` |
| `node_state.dependency_hash` | 最近一次成功保存时按依赖资料计算的 hash；拒绝候选保存、过期和失败不覆盖它 |

节点作为必需输入时，除 `generated` 和结构有效，还要求非空保存 hash 与当前依赖资料相符。依赖表指定上游 hash 时读取上游已保存值，不以递归重算代替。必需上游过期后继续传播，即使保留的正文和旧 hash 尚未改变，下游也不能维持有效。

程序或 AI 审核耗尽时，最后候选覆盖同一份正式内容，保留本节点原成功 hash，不主动更改下游状态、hash 或媒体。下游的新任务仍按执行时的正式资料校验依赖；发现变化时可以阻断并说明原因，不回退到历史正文。该规则不要求为候选另建草稿。

对应位置：

| 项目 JSON 位置 | 节点 |
|---|---|
| `script.node_state` | 剧本节点状态；审核与按审核意见修改都是剧本节点的任务。节点内容为 `body` 等剧本字段 |
| `project_summary.node_state` | 项目摘要状态。节点内容另有 `body`、`script_version` |
| `character_library.node_state` | 角色库状态。节点内容另有 `characters[]` |
| `character_library.characters[].costume_images[].node_state` | 定妆照状态。节点内容另有 `costume_id`、`address` |
| `episodes[].summary.node_state` | 剧集摘要状态。节点内容另有 `body` |
| `episodes[].story_outline.node_state` | 分集改编状态。节点内容另有 `segments[]` |
| `episodes[].shot_list.node_state` | 镜头表状态。节点内容另有 `shots[]` |
| `episodes[].shot_list.shots[].seconds_storyboard.node_state` | 每秒分镜状态 |
| `episodes[].shot_list.shots[].text_to_video_prompt.node_state` | 文生视频提示词状态 |
| `episodes[].shot_list.shots[].first_last_frame_prompt.node_state` | 首尾帧提示词状态 |
| `episodes[].shot_list.shots[].multimodal_prompt.node_state` | 多模态提示词状态 |
| `episodes[].shot_list.shots[].video.node_state` | 视频状态。节点内容另有 `address` |
| `episodes[].shot_list.shots[].last_frame.node_state` | 尾帧状态。节点内容另有 `address`。不是独立任务，由视频任务写入 |
| `episodes[].assembly.node_state` | 合片状态。节点内容另有 `address` |

`episodes[].shot_list.shots[].video_generation_type` 没有节点状态，不是节点。`script`、`plot`、服装资料也没有节点状态。

## 视频阶段步骤

`first-last-frame` 和 `multimodal` 是程序节点，步骤为 precheck→generate（执行编排）。文生不创建程序编排任务。视频为 precheck→generate→download→apply：生成只记录服务端地址，下载写入本地素材库，apply 做文件校验、实测、截帧与图片校验，不执行审核或自动修订。manual_edit 视频为 precheck→manual_edit→apply，不调用AI、不要求文本节点；新上传文件的服务端地址为空，沿用原文件时保留原服务端地址。`download` 是新增步骤类型，`apply` 仍是原有步骤类型；视频中前者取回文件，后者做媒体后处理。独立tail不接受新命令，历史可读，last_frame保存视频配对产物。

单项文本原结果修订的 single/workflow 组 action 可为 revise；成片/每秒组合组仍只使用原有 generate、regenerate、continue。

## 当前队列与项目取消

任务记录保留完整历史。当前任务数组由任务管理器筛选 queued/running，取消当前项目时将全部当前任务及未结束步骤结算为 cancelled，数组自然清空。执行失败或未通过会取消本项目剩余排队任务。没有项目暂停字段；新任务自动调度，旧请求清理完成前保持串行。项目运行状态由当前数组推导，不额外保存。

### 模型输出缺字段与执行失败的区分

生成或修订已返回可解析JSON但缺少必填字段时，生成步骤保存原始返回，程序审核步骤记为 `rejected` 并写入缺字段原因，按节点既有轮次修订。节点原本没有程序审核时，仅为该结构问题补充程序审核步骤。耗尽仍缺字段时任务和节点为 `rejected`，原因写入节点 `reason`；不完整候选只留任务步骤，不覆盖旧正式内容或hash。网络、接口、超时及JSON不可解析仍为 `failed`，失败原因用于展示，不自动上传模型提示词。审核接口自身返回缺协议字段仍属于接口协议失败，不作为待修订业务候选。

出镜人物及服装是镜头表的 on_screen_characters，群演为 background_characters，不是独立节点或任务。退役识别任务仅保留历史终态，不可继续执行。

模型生成/修订结果的结构、人物 ID、服装归属等契约错误均进入程序审核未通过并共用修订轮次；耗尽时保留旧正式内容和 hash。JSON 无法解析、审核协议错误、业务前置条件不满足及素材缺失/损坏记为未通过，不写入无效候选。HTTP、网络、超时等执行异常记为失败。

镜头表 AI 输出以内部 id 关联旧镜头，新增 id 为空；number 仅由程序按播放顺序生成。模型路由校验及内容组装校验均接入同一程序审核修订链，修改意见逐行去重。镜头总时长与大纲小段时长合计四舍五入相差不超过±30秒。

审核步骤的result可在原有是否通过/原因之外保留结构化问题数组（修复范围、来源、位置、依据、建议）；由任务服务附加的修订进展记录候选相同、重复程序错误及定向提示。它们属于步骤结果JSON，不新增StepModel固定字段或数据库列。上游问题及重复同一程序错误可在上限前结束任务；旧正文及hash不覆盖。

## 选择性场景节点（v21）

episode-scenes是剧集single组文本任务，大纲有效后提取并AI审核，最多三次修订，可人工编辑，空选择合法。结果引用项目场景库，不自动派生图片。scene-image是场景sc_ID上的single组图片任务，可生成/重新生成及人工导入，没有AI审核。两者沿用任务/步骤状态、历史及取消协议。
