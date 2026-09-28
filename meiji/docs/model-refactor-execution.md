# Meiji 数据 Model 与响应式 UI 重构执行文档

日期：2026-09-27。依据用户确认的方案实施；不调用付费生成接口，不重新生成现有内容。

## 目标与边界

- 一部剧一个 DramaModel，剧集、剧情、角色、场景、镜头及生成结果都有对应子节点。
- 镜头表仅持有顺序和镜头集合；镜头正文只有一份。单镜包括每秒指令、文本分镜、铅笔分镜、视频。
- 可独立生成节点统一四态：未生成、生成中、未通过、已通过。自审通过即可通过，人工意见可选。
- 人工意见提交后按原内容修改并再次自审；失败保留意见，成功只清理已处理的意见。生成期间的新意见不得丢失。
- 图片仍需人工确认、上传成功、入库后才能使用；候选图不是已启用素材。
- 素材库独立，项目保存素材引用；文本分镜展示实际请求顺序、图片、引用标签与正文关联。
- 镜头阶段继续自由文本，不恢复剧情 JSON 字段级审核。
- UI 数据更新不丢失输入、焦点、展开和滚动；布局随面板宽度调整。

## 存储结构

DramaModel → EpisodeModel → PlotModel / ShotTableModel / AssemblyModel。
PlotModel 包含 Outline、Character 和 Scene 集合；它们随剧集嵌套在同一个 DramaModel 内。角色卡 ID 在剧集内唯一，共用图片由独立素材 ID 关联，不另存重复的人物定义。
ShotTableModel.items 中每个 ShotModel 包含 content、seconds、storyboard、pencil、video。
业务节点保存 id、revision、status、content、check、review、operation、error、dependencies。
状态采用 not-generated / generating / failed / passed，中文在 UI 映射。
素材引用与配置等值对象不重复增加流程状态。

磁盘和 API 只使用标准 Model。运行时禁止旧字段兼容、旧结构投影和双写。前后端同步改用新结构。一次性迁移程序只在部署时运行，不进入运行时加载路径。
迁移必须备份原始文件，保留无法归属的旧数据，禁止静默丢弃。schemaVersion 与数据 revision 分开。

## 执行步骤与验收

- [x] 1. Model 与状态：定义结构、前后端直接读写、统一更新；原始输入往返不丢失有效业务数据。
- [x] 2. 持久化迁移：旧 JSON 备份、原子迁移、schema 版本检查；API 输出标准 Model。
- [x] 3. 写入与生成：统一走 Model；版本保护；意见草稿持久化；仅清理本次已消费意见。
- [x] 4. 素材关联：展示缩略图、Picture/Subject 关系，缺失/未使用引用告警；以真实请求快照为准。
- [x] 5. UI：Store 接收服务器数据；稳定节点局部更新；宽窄布局；审核组件统一。
- [x] 6. 回归：迁移、并发、审核失败、草稿、新旧响应、图片确认、铅笔节点、文本编辑、现有全套测试。
- [x] 7. 本地迁移并验证：无生成任务时备份和迁移真实项目；核对剧集/镜头/素材数量。记录限制和未完成项。

## 并发和失败规则

- 持续保留原子写入与写队列。任务结果核对来源版本，旧任务不能覆盖新正文。
- 审核意见草稿独立版本，保存草稿不应让运行中的内容任务失效。
- 取消/异常结束必须留下失败原因，不能伪装通过。
- 上游重写清空或标记下游过期；图片引用更新不强制重跑文字流程。
- 人工直接编辑正文后自动自审，保留人工文字，不先要求模型重写。

## 验证记录

- `node --test meiji/tests/*.test.js`：148 项全部通过，0 跳过。覆盖生成、审核、草稿、并发、图片确认、素材引用、铅笔、视频、迁移及前端组件更新。
- `git diff --check -- meiji`：通过。
- 真实 JSON 一次性迁移：4 部剧、5 集、53 个镜头、33 张角色/场景卡、23 份文本分镜、14 条视频记录。逐项核对摘要、大纲、镜头正文、每秒正文、分镜内容和视频记录；补充 skill 保留。
- 原始备份：`.dsh/backups/model-v2-2026-09-27T00-20-11-110Z/`（仓库根目录下）。迁移只修改 JSON，不改图片/视频文件。
- 已重启本地 harness，浏览器验证项目首页、第一集剧情、镜头表、文本分镜、实际素材图片与 Picture/Subject 关联、编辑入口和铅笔入口。
- 本轮没有调用付费模型生成；接口生成链通过注入测试响应验证。真实供应商生成效果不属于本轮验证范围。
- 旧内容缺少自检记录时保留内容并提示尚未完成自检，不伪造通过结论。

## 主要实现文件

- `shared/drama-model.js`：共享 Model、四态、节点更新、意见版本与图片引用刷新。
- `server/data/projects.js`、`episodes.js`：原子存储、节点合并、来源版本检查。
- `server/data/self-checks.js`、`server/flow/actions.js`：任务状态、意见消费、手动编辑后复审。
- `client/model-store.js`、`app.js`：响应式数据订阅，保留编辑组件和焦点，拒绝旧响应。
- `client/workflow-review.js`、`storyboard-editor.js`、`storyboard-references.js`：通用审核、正文草稿和引用核查。
- `client/styles.css`、`shell.js`：面板容器宽度适配及窄屏布局。
- `scripts/migrate-model.js`、`migration-feedback.js`：离线一次性迁移；运行时无引用。

