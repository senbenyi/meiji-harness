# Harness 全流程验收

- 类型：Bug 修复与既定节点要求落地
- 目标：实际走通摘要到全部剧情资料，修复编排、节点技能和可观察性问题。
- 调研：docs/research/调研-Harness全流程验收.md

## 待用户决定
无。

## 改动
### 阶段 1：输入与节点技能
1. `server/prompts/story-prompts.js:buildStoryPrompts` — 首次默认重新生成 → 首次展开本集摘要 → AC-2。
2. `shared/drama-model.js:episodeModel/assertDrama`、`server/data/node-skills.js` — 新增各集节点补充集合与验证/修改方法 → AC-3。
3. `server/http/skill-routes.js`、`server/data/task-store.js`、`server/prompts/skill-prompts.js`、各摘要/剧情接口及预览 — 节点 CRUD、冻结任务补充、生成/修订/审核复用节点要求 → AC-3。
4. `scripts/migrate-node-skills.js` — 完整备份、迁移已有阶段补充、读回核对，不自动改变运行数据 → AC-3。

验证：相关 Model、skill、迁移和接口测试；跨剧集与跨节点内容不混用。

### 阶段 2：页面与可观察性
1. `client/node-skill.js`、`skill-entry.js`、`stages.js`、`app.js` — 摘要、大纲、人物、场景独立 skill 管理与任务历史入口，移除过时“一次调用”说明 → AC-3/4。
2. `client/execution-history.js`、`app.js` — 历史响应事件、保留展开状态 → AC-4。
3. `client/episode-draft.js`、`overview.js` — 弹框显示任务步骤与完整提示词、草稿历史入口 → AC-4。

验证：UI 相关测试；真实页面新集生成、步骤/提示词、补充 CRUD、意见修改、跨集隔离。

### 阶段 3：复验与文档
1. `.agents/meiji-dev.md`、`.agents/development.md`、`.agents/architecture.md`、生成文档 — 同步已落地范围、目录及保留的后续要求 → AC-6。
2. 分析技能实际注入小节，删除有证据的过时逻辑/文案，不删除仍使用的文件 → AC-6。
3. 只跑相关功能与架构测试，`git diff --check`；重启实际 Harness 复验，更新一次 GitNexus 索引 → AC-1/5/6。

## 验收标准
AC-1 项目、两集及 AI 摘要真实生成；AC-2 大纲摘要与三步上下游一致；AC-3 节点补充 CRUD 和隔离；AC-4 实时历史步骤、完整提示词；AC-5 意见成功清理/失败保留；AC-6 相关测试与文档/目录/图谱。

## 验证结果
基线相关测试 103 通过、0 失败、0 取消。最终相关测试 152 通过、0 失败、0 取消；真实两集摘要、剧情三阶段、修订及提示词查看已完成，过程与限制见 `docs/implementation/实施-Harness全流程验收.md`。代码图谱更新成功。

## 用户追加范围：统一 skill 目录
- `meiji/skills/stages/`、`guidance/`、`shared/` → `meiji/skills/constraints/` 下对应目录；保持字段、协议和技能 ID，删除旧位置，`agent/` 保留为 Harness 操作入口。
- `skills/load.js`、相关结构测试、架构与开发说明同步新路径；迁移前后提示词差集必须为空（纯路径迁移）。
- 依赖测试新增证据：`server/data/projects.js:revisionStore` 将 supplementalSkills 当业务输入，编辑补充导致运行任务报 409。技能已冻结，应从依赖指纹排除；任务保存保留当前补充，避免覆盖新编辑内容。

## 真实复验新增问题
- 大纲审核把“记录线索细化成编号”当作缺少上游来源；还依据“地下通常没有窗”推断空间不可能。调整 `constraints/stages/outline/review.md`，区分合理展开与明确矛盾；合并重复的身体身份盘点规则，语义保持。
- 新增集历史嵌在表单内，刷新按钮必须 type=button，历史筛选不能取消生成；相关 UI 测试已加入。
- `episodeWork/materialize` 需带上摘要任务的项目级 activity，防止运行时编辑/重复生成仍可点击。
- 技能库及 `/project-skills` 不再允许无效的摘要/剧情整剧补充，明确转到当前集节点入口。
- Mac 锁屏后原生 UI 不可操作，继续经已授权的本地公开 HTTP 接口验证相同任务流程；锁屏后的 UI 操作另记未验收。
- 真实摘要修订成功后意见未清理：`opEpisodeGenerate` 在最终草稿保存后按通过结果消费同版本意见，节点释放仍走统一收尾。测试覆盖成功清空、失败保留、执行中新增意见保留。
