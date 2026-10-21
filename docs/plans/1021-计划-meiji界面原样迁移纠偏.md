# meiji界面原样迁移纠偏

- 类型：完整流程，UI迁移纠偏与缺失的项目内导入。
- 目标：实际复制meiji概要/节点卡片/返回栏的DOM和样式到drama，本地维护，只适配数据；补全当前项目导入剧本。
- 非目标：恢复剧集/人物卡片、原文手工编辑、引入meiji执行器/旧模型、实现新的生成器。

## 验收标准
- AC-1：概要头部、基本资料、原文展示使用原meiji结构；剧本节点使用section-head/section-titles/node-data-tag/node-ui/workflow-generation-row/node-ui-buttons/node-ui-opinion，顺序一致，不再自制简化卡片。
- AC-2：项目内导入TXT/Markdown或素材库剧本→保存basic_info.original_script，读回一致；无原文编辑器，保持项目ID及其他节点输出不变，空/过大/并发旧值拒绝。
- AC-3：规则/任务/HTTP入口仍直接使用公共组件，按项目/节点隔离，返回和连接管理不退化。
- AC-4：原版操作区保留，未接入的生成/审核/优化结果编辑不可执行；意见使用已有opinion字段。只显示剧本相关卡片。
- AC-5：260/360/600px可用，实际Chrome创建→导入→查看原文→公共记录与返回闭环；无跨项目运行时依赖。

## 调研与调用链
meiji project-ui.renderOverview→task-panel.nodeCard→nodeUi（操作/状态/意见/失败原因）→结果正文；drama此前重写了标题+文本+三个按钮，未复制实际节点结构，这是偏差根因。meiji导入控件在project-forms，当前项目详情未接入；现从已有控件复制导入交互到drama，接当前项目保存入口。
目标createProjectView图谱CRITICAL，已经提示；editProject为LOW、上游3个；mount UNKNOWN，以panel挂载/读取/保存调用方补查。图谱索引当前有效。基线drama51通过（上任务）。

## 改动
1. project-detail.js从meiji实际复制；project-node.js复制剧本节点及返回栏结构，适配output/body与公共记录回调。
2. project-ui.css撤回自行重排部分，复制meiji相应选择器并限定项目页面。
3. script-import.js从创建弹窗复制导入控件及选择/文件读取逻辑，支持销毁与异步保存。
4. project-overview.js以旧overview结构组合基本资料、导入与节点，保留公共记录、规则路由和销毁。
5. edit_project.js新增明确import_script与node_opinion命令，仍按会话绑定/旧值检查/串行落盘；不恢复original_script自由编辑。
6. 相关测试、文档同步，实际Chrome核对结构和显示。

## 验证结果
- AC-1通过：基本资料文件实际复制；剧本节点DOM/样式按meiji原分支复制，操作在正文上方、状态为node-data-tag、意见栏为node-ui-opinion。截图`/tmp/drama-meiji-restored-panel.png`已查看。
- AC-2通过：HTTP验证导入落盘/冲突409，空/超限拒绝，不修改优化结果；Chrome验证项目内文件及素材库两种导入并核对JSON及重载正文。
- AC-3通过：Chrome进入公共规则保存、公共任务/HTTP及返回；原连接回归通过。
- AC-4通过：旧操作位保留但执行未接入时禁用；原文无编辑器，执行意见落盘；无剧集/人物卡片。
- AC-5通过：Chrome600/360/260px无横向溢出，0模型调用、0浏览器异常。没有跨项目代码引用。
- 基线drama51；最终54通过、0失败、0取消。根npm test840项通过后补充素材选择SSE回归及快照保护，drama54重新全部通过；根其余787项无变更。
- detect_changes覆盖前序修改：changed36/affected449/CRITICAL，无partial/truncated；动态/未跟踪入口以源码、HTTP/DOM与Chrome补查。git diff --check通过，收尾更新索引。

浏览器验证发现SSE相同快照会销毁素材选择器，已以数据相同不重建视图及保存时使旧快照过期修复，并增加回归测试。

真实项目720px高度验证发现底部空状态行覆盖超出main高度的节点按钮，已恢复长内容外层滚动并隐藏空状态行；该修复仅处理宿主容器尺寸适配。真实项目只读核对导入入口、原节点结构及规则打开，不修改原有项目数据。
