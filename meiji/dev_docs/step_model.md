# 任务与步骤

任务、步骤和任务组的字段与状态。项目数据结构与逐字段注释见 [project_detail.json](project_detail.json)。节点的状态、原因和依赖 hash 统一收纳在 `node_state` JSON 对象中。

## 状态枚举

节点状态存在项目 JSON 里，和原因一起保存。面板直接读项目，不从历史任务推算。

| 值 | 名称 | 来源 | 可作下游输入 | 原因 |
|---|---|---|---|---|
| `empty` | 未生成 | 创建空节点 | 否 | 空 |
| `queued` | 排队中 | 任务入队 | 否 | 空 |
| `running` | 生成中 | 任务开始 | 否 | 空 |
| `generated` | 已生成 | 任务通过或人工放行 | 是 | 空 |
| `rejected` | 未通过 | 稿件有效，自审最终未通过 | 否 | 非空 |
| `failed` | 失败 | 前置检查或执行失败，原内容保留 | 否 | 非空 |
| `cancelled` | 已取消 | 已开始的任务被取消，原内容保留 | 否 | 非空 |
| `expired` | 已过期 | 上游变化使已生成内容失效，内容保留 | 否 | 非空 |

入队前的状态和原因记在任务的 `previous_node_state`。任务还没开始就取消或作废时，恢复这份快照。排队期间上游变了，快照里的 `generated` 改成 `expired` 并写原因，不能恢复成仍然有效的旧内容。

人工放行是唯一由人改节点状态的入口：新建 `override` 任务，结构校验通过后保留稿件，状态写成 `generated`，原因清空。旧任务不变。

任务状态：

| 值 | 名称 | 说明 |
|---|---|---|
| `queued` | 排队中 | |
| `running` | 生成中 | |
| `completed` | 已通过 | |
| `rejected` | 未通过 | 有产出，自审最终未通过 |
| `failed` | 失败 | 执行出错，没有产出 |
| `cancelled` | 已取消 | |
| `superseded` | 已作废 | 组里前面的任务停下后，还没执行的任务；服务重启时，尚未完成的排队和进行中任务 |

任务一停就是终态。重新生成、继续、人工编辑、人工放行都新建任务。继续一组时新建任务组。

步骤状态：

| 值 | 名称 | 说明 |
|---|---|---|
| `ready` | 等待中 | |
| `running` | 执行中 | |
| `done` | 完成 | |
| `failed` | 失败 | 接口报错、超时或输出无法解析，没有可用产出 |
| `skipped` | 已跳过 | |
| `cancelled` | 已取消 | |
| `superseded` | 已作废 | |

任务来源：`panel` 面板，`session` 会话。

## 任务组字段

`status` 和 `reason` 不存储，只按本组任务计算。按 `group_seq` 排序后：先看第一个 `rejected`、`failed` 或 `cancelled`，原因用该任务的 `end_reason`；否则有 `running` 就是生成中；否则有 `queued` 就是排队中；任务非空且全部 `completed` 就是已通过；其余若有 `superseded` 则显示已作废。后来的新组、人工放行或编辑不改旧组结果。

| 字段 | 示例 | 说明 |
|---|---|---|
| `id` | `tg_uuid` | 任务组 id |
| `project_id` | `p_uuid` | 项目 |
| `episode_id` | `e_uuid` | 只用于按集查询。项目、角色、服装的组留空 |
| `name` | 第 1 集成片 | 展示名 |
| `group_type` | `episode-film` | 见下表 |
| `source` | `panel` | 面板或会话 |
| `shot_ids` | `["s_uuid"]` | 本组涉及的镜头。单任务可为空 |
| `status` | | 计算字段，不存储 |
| `reason` | | 计算字段，不存储 |
| `created_at` | | 创建时间 |
| `action` | `generate` | 本组动作 |

组类型：

| 值 | 名称 | 说明 |
|---|---|---|
| `single` | 单任务 | 一次独立操作默认建组。可以没有 `episode_id`，`shot_ids` 为空 |
| `workflow` | 派生流程 | 剧本生成、角色提取用。派生出的摘要或图片任务按 `group_seq` 追加到同一组 |
| `episode-seconds` | 每秒分镜 | 每镜一个 `seconds` 任务 |
| `episode-film` | 成片 | 按镜头顺序：每秒分镜、文生视频提示词、视频。视频任务内截取尾帧。可用 `shot_id` 限定当前剧集的一镜 |

组里任一任务失败、未通过或取消，后面还没执行的任务作废，节点恢复 `previous_node_state`。旧组、旧任务、旧步骤保持不动。

继续时看这组按 `group_seq` 停在哪个任务，从该任务对应的节点起，按原顺序新建一个任务组。新组不记录来源组，`group_seq` 从 1 重新计。停点之前已完成的任务不进入新组。该组已经全部完成时不建空组。修改意见只写在新组里的具体任务上。

创建或继续时，同一请求重复提交返回原组。其他请求先看目标节点是否已有 `queued` 或 `running` 任务，有重叠就整组拒绝，不建组、不改节点、不挪用旧任务。

## 任务字段

一个节点由 `business_type` + `target_id` 唯一确定。`target_id` 必填：项目 `p_`，剧集 `e_`，角色 `c_`，服装 `co_`，镜头 `s_`。`episode_id` 只用于按集查询，不参与定位；剧集和镜头任务必填，且与 `target_id` 所属剧集一致。

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
| `name` | 第 1 集 · 生成剧情 | 展示名 |
| `queue_order` | `1` | 队列顺序 |
| `end_reason` | | 终态原因 |
| `created_at` | | 创建时间 |
| `started_at` | | 开始时间 |
| `ended_at` | | 结束时间 |
| `opinion` | | 修改意见。只记在任务上，任务组不记 |
| `previous_node_state` | `{ status, reason }` | 入队前的节点状态和原因 |

动作：

| 值 | 名称 | 说明 |
|---|---|---|
| `generate` | AI 生成 | 新建任务。是否可做由前置检查决定 |
| `regenerate` | 重新生成 | 新建任务，不恢复旧任务 |
| `continue` | 继续 | 只用于组合入口。按原组进度从断点新建任务组 |
| `manual_edit` | 人工编辑保存 | 新建 `precheck` → `manual_edit` |
| `override` | 人工放行 | 新建 `precheck` → `override`。节点写成 `generated`、原因清空。旧任务保持原终态 |
| `delete` | 删除资料 | 新建删除任务 |

每个任务的第一步是程序 `precheck`：目标是否属于该项目、原状态是否允许、必需输入是否已生成、实际使用的素材和参数。人工放行在这里检查未通过的稿。人工编辑的 `precheck` 直接通过，结构在后面的 `manual_edit` 步校验；不合法则该步和任务 `failed`，旧稿保留。删除在 `precheck` 检查引用。前置检查失败时不调用模型，后面的步骤作废。

## 步骤字段

| 字段 | 示例 | 说明 |
|---|---|---|
| `id` | `st_uuid` | 步骤 id |
| `task_id` | `t_uuid` | 所属任务 |
| `name` | 生成剧情 | 展示名 |
| `seq` | `1` | 任务内顺序 |
| `kind` | `generate` | 见下表 |
| `round` | `1` | 轮次。修订、再审递增 |
| `step_status` | `ready` | 步骤状态 |
| `error_reason` | | 失败原因 |
| `prompt` | `{}` | 本次提示 |
| `result` | | 本次结果 |
| `started_at` | | 开始时间 |
| `ended_at` | | 结束时间 |

步骤种类：

| 值 | 名称 | 说明 |
|---|---|---|
| `precheck` | 前置检查 | 每个任务的第一步 |
| `generate` | 生成 | |
| `review` | 自审 | |
| `revise` | 自审修订 | |
| `manual_edit` | 人工编辑保存 | 只绕过模型审核，不绕过结构校验 |
| `override` | 人工放行 | 只绕过模型审核，不绕过结构校验 |
| `impact` | 计算影响 | 删除资料时算出要标过期的节点，只记在步骤结果里，不改项目 |
| `apply` | 写入项目 | 删除资料并一次提交过期状态 |

## 节点字段

[project_detail.json](project_detail.json) 里每个节点都有一个 `node_state` JSON 对象，统一保存状态、原因和依赖 hash。各节点自己的内容字段以该 JSON 为准，这里不另写一套。

```json
"node_state": {
  "status": "empty",
  "reason": "",
  "dependency_hash": ""
}
```

| 字段 | 说明 |
|---|---|
| `node_state.status` | 节点状态枚举 |
| `node_state.reason` | 与状态一起保存。`empty`、`queued`、`running`、`generated` 为空；`rejected`、`failed`、`cancelled`、`expired` 非空 |
| `node_state.dependency_hash` | 本节点保存时，按其依赖资料算出的 hash |

对应位置：

| 项目 JSON 位置 | 节点 |
|---|---|
| `project_summary.node_state` | 项目摘要状态。节点内容另有 `body`、`script_version` |
| `character_library.node_state` | 角色库状态。节点内容另有 `characters[]` |
| `character_library.characters[].character_image.node_state` | 角色图状态。节点内容另有 `address` |
| `character_library.characters[].costume_images[].node_state` | 定妆照状态。节点内容另有 `costume_id`、`address` |
| `episodes[].summary.node_state` | 剧集摘要状态。节点内容另有 `body` |
| `episodes[].story_outline.node_state` | 故事大纲状态。节点内容另有 `segments[]` |
| `episodes[].shot_list.node_state` | 镜头表状态。节点内容另有 `shots[]` |
| `episodes[].shot_list.shots[].seconds_storyboard.node_state` | 每秒分镜状态 |
| `episodes[].shot_list.shots[].text_to_video_prompt.node_state` | 文生视频提示词状态 |
| `episodes[].shot_list.shots[].first_last_frame_prompt.node_state` | 首尾帧提示词状态 |
| `episodes[].shot_list.shots[].multimodal_prompt.node_state` | 多模态提示词状态 |
| `episodes[].shot_list.shots[].video.node_state` | 视频状态。节点内容另有 `address` |
| `episodes[].shot_list.shots[].last_frame.node_state` | 尾帧状态。节点内容另有 `address`。不是独立任务，由视频任务写入 |
| `episodes[].assembly.node_state` | 合片状态。节点内容另有 `address` |

`episodes[].shot_list.shots[].video_generation_type` 没有节点状态，不是节点。`script`、`plot`、服装资料也没有节点状态。
