# meiji界面原样迁移纠偏实施记录

## 已修改文件
- `projects/drama/src/client/project-detail.js` — 从meiji实际复制基本资料与原文展示。
- `projects/drama/src/client/project-node.js` — 复制原剧本nodeCard/nodeUi与返回栏结构，仅按drama输出和回调适配；原操作位未接执行器时禁用。
- `projects/drama/src/client/script-import.js` — 项目内文件/素材剧本导入控件，复制既有创建弹窗交互；无原文编辑器。
- `projects/drama/src/client/project-overview.js`、`project-ui.css` — 恢复旧概要/节点结构及选择器，保留公共规则/任务/HTTP页面和状态；相同快照不重建导入控件。
- `projects/drama/src/project/edit_project.js` — 明确的import_script及node_opinion保存命令、旧值检查和限制，不允许original_script自由编辑。
- `projects/drama/src/client/workbench.js` — 保存成功使此前未完成的项目快照失效，防止旧内容覆盖。
- `project-edit.test.js`、`script-import-ui.test.js` — 导入落盘/超限/冲突、意见、文件/素材、迟到和SSE控件保留回归；README与计划同步。

## 验收标准核对
| AC | 状态 | 证据 |
|---|---|---|
| AC-1 | 通过 | 实际复制原文件/节点分支，节点标题/状态→操作/意见→结果顺序一致；核对面板截图 |
| AC-2 | 通过 | HTTP及Chrome两种导入后核对磁盘JSON，冲突409、空/超限拒绝；原文无编辑器 |
| AC-3 | 通过 | 公共规则保存、任务/HTTP记录与返回真实浏览器通过，连接回归通过 |
| AC-4 | 通过 | 旧操作布局保留、未接执行器的按钮禁用；意见保存；仅基本信息与剧本节点 |
| AC-5 | 通过 | 600/360/260px无溢出，0浏览器异常、0模型调用；代码与静态资源独立 |

## 测试
基线drama51；最终54通过、0失败、0取消。根840项通过后增加1项SSE控件回归与对应保护，drama54全部再次通过；根其余787项无本次变更。实际Chrome临时存储验证创建、文件导入、素材导入、刷新、意见持久化、全文和公共UI；不修改真实项目用于测试。
完整detect_changes：changed36/affected449/CRITICAL，无partial/truncated，范围包含前序未提交改动。git diff --check通过，收尾更新索引。

## 人工待办
原meiji的改编、审核和优化稿人工编辑操作在drama尚无执行入口，显示禁用；本次不接旧执行器或新增业务执行功能。项目内导入、资料/意见保存及公共UI已可用。

真实项目720px高度验证发现底部空状态行覆盖超出main高度的节点按钮，已恢复长内容外层滚动并隐藏空状态行；该修复仅处理宿主容器尺寸适配。真实项目只读核对导入入口、原节点结构及规则打开，不修改原有项目数据。
