# 执行记录与产物版本

项目 JSON 保留最新合法内容；审核失败不回退，接口或格式错误不覆盖旧内容。
任务执行状态与当前内容审核状态分开。审核结论只适用于审核输入的版本。
不引入数据库，以下为逻辑表，文件写入采用临时文件与原子重命名。

## 任务表：projects/<projectId>/history/tasks/<taskId>.json

| 字段 | 含义 |
|---|---|
| id / projectId / episodeId | 执行、项目、剧集标识 |
| action / source / actor | 业务动作，panel/session/api，human/model |
| sessionId | 发起会话，用于日志和访问归属 |
| mode / requirements / opinion | 生成模式、本次要求、修改意见 |
| status | running/completed/review_failed/failed/cancelled；旧记录可能为 interrupted |
| startedAt / endedAt / error | 时间与执行错误 |
| nodes | 节点表，内嵌在同一个任务文件 |
| artifacts / latestOutputs | 本任务提交过的快照引用、各目标最新结果 |

## 节点表：task.nodes

| 字段 | 含义 |
|---|---|
| id / kind | 节点标识；execute/generation/review/revision/re_review/video_submit/video_generate |
| status | running/succeeded/failed/cancelled；旧记录可能为 interrupted |
| inputs / outputs | 输入输出 artifactId；审核绑定实际输入版本 |
| reviewResult / reasons | pass/fail 及具体原因；审核返回 FAIL 仍是执行 succeeded |
| target | 可选的镜头或内容目标 |
| startedAt / endedAt / error | 时间与错误 |

只创建实际执行的节点；未触发修订时不伪造修订记录。execute 是任务范围的执行节点，
记录验证、人工保存等本地工作；模型调用另有生成和审核节点。

## 产物表：projects/<projectId>/history/artifacts/<artifactId>.json

| 字段 | 含义 |
|---|---|
| id / projectId / episodeId / target | 快照标识与内容归属 |
| version / previousArtifactId | 目标内的版本与前版本 |
| taskId / nodeId | 产生该版本的执行来源 |
| content / createdAt | 完整内容快照与保存时间 |
| published | 项目文件原子写入成功后置 true |
| baseline | 首次留痕前的已有内容基线；不伪造历史任务 |

记录粒度：summary、story（大纲/角色/场景整包）、shots（整集镜头表）、
seconds（整集每秒指令）、storyboard:Sxx（文本提示词）、film:Sxx（成片）、assembly（整集合成）。
镜头表和每秒指令不拆逐镜执行记录。它们的镜头编号只是完整内容内部的结构。

项目内容节点的 source 保存 taskId/nodeId/artifactId/version，指向产生当前内容的记录。
运行失败的任务可没有新 artifact；不能把这种失败当成当前旧内容审核失败。
人工提交正文也记录快照并清除新版本的旧审核通过状态；输入框草稿或修改意见暂存不算正文发布。

## 写入与恢复

保存顺序：快照落盘（published=false）→ 项目 JSON 原子替换 → 快照标记发布并关联节点。
跨文件不承诺事务；任一步失败会报告任务失败。重启将 running 任务与节点标记 cancelled（已提交的远端视频尽力取消），
不会自动重复生成。既有未记录内容在第一次执行时保存 baseline，不补造过去时间。
视频快照记录不可变本地文件名；逐镜视频和新合成视频使用唯一文件名，不覆盖历史文件。
删除项目或剧集同时清理所属历史；图片素材删除策略不变。

GET /plugins/meiji/history?projectId=...&episodeId=...&sessionId=... 返回任务历史。
附加 artifactId 返回指定快照，接口先验证会话项目归属。
项目总览与剧集详情的任务历史按钮跳转到独立列表页，可按状态筛选、刷新、展开节点与快照，并返回原页面。
