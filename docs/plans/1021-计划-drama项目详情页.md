# drama项目详情页

- 类型：完整流程，业务UI、编辑入口与持久化。
- 目标：复制meiji的项目概要布局到drama，按新项目结构完善基本资料、剧本优化及结果详情和规则查看/保存。
- 非目标：跨项目引用、导入meiji业务兼容、执行未接入的生成器、修改项目JSON字段结构、删除真实项目。

## 验收标准与调研结论
| AC | 状态 → 可见结果 | 状态 | 依据 |
|---|---|---|---|
| AC-1 | 已创建项目 → 模式/标题编辑图标/画幅统计、基本信息、原始剧本及剧本优化卡片 | 已确认 | meiji renderOverview与panel-styles；drama当前仅h2和基本资料 |
| AC-2 | 编辑资料/原文 → 验证、保存本地JSON、名称同步工作区；失败保留表单 | 已确认 | drama已有detailsDialog和ProjectManager，无编辑API |
| AC-3 | 剧本优化卡片 → 可进入人类可读详情并返回，原节点状态及内容不丢失 | 已确认 | runtime nodeDefinitions及开发结构；不搬旧meiji字段 |
| AC-4 | 查看规则 → 公共规则UI展示项目保存的三动作base/supplement；补充规则回调持久化 | 已确认 | 公共renderRulesPanel需可自定义项目保存规则标签，默认语义不变 |
| AC-5 | 切会话/并发编辑/晚到 → 不串项目、不覆盖新数据、资源正确清理 | 已确认 | workbench生命周期及CreateProjectTool串行队列，增加项目ID与previous校验 |
| AC-6 | 窄面板、空项目、长文及恶意文本 → 可用、无溢出/脚本执行，保持现有导航 | 已确认 | Chrome260/360/600px，既有UI/工程回归 |

## 调用链与证据
workbench→新project-overview（meiji标题、编辑图标、无外框分区、卡片布局实际复制并本地维护）→detailsDialog/详情页/公共rules UI。
保存→PATCH /api/drama/project→CreateProjectTool.edit串行→ProjectManager→ProjectModel.update；绑定由服务端bindings校验，更新事件通过原SSE推送。
运行时模型字段不新增；基本信息只编辑已有name/aspect_ratio/creative_requirements/reference_episode_duration_seconds，原文单独编辑；输出只读。

图谱status有效，query/context已核对renderOverview。renderProjectDetails和createProjectHttpHandler UNKNOWN，以实际调用方与静态模块入口补查；CreateProjectTool CRITICAL/direct4，已说明，改动围绕创建/编辑串行和重试名称保持，回归覆盖原创建链。

## 待用户决定
无。按用户最新要求仅展示基本资料、原始剧本、剧本优化，不展示剧集和人物等其他节点卡片；生成执行器不在本次范围。

## 改动
1. 新drama client/project-overview.js：复制并适配meiji的头部、分区及卡片；剧本优化结果及详情、原文编辑及规则。
2. project-detail.js与project-ui.css：原基本资料保留；样式复制本地并按新组件作用域隔离，不改变顶部导航。
3. workbench.js：挂载独立项目视图、保存回调、状态保持、晚到和销毁保护。
4. 新project/edit_project.js和CreateProjectTool.edit：字段白名单、绑定、乐观并发、原子落盘；项目名同步工作区；创建重试读取当前名称。
5. project_routes.js与record_routes.js：PATCH接口、SSE更新和公共规则模块白名单。
6. prompt-composer公共UI可选baseLabel/ruleNote展示标签，不改变默认调用方行为与规则Model。
7. HTTP/编辑/DOM及公共UI测试、双方文档同步；实际Chrome闭环与项目边界检查。

## 验证结果
- 基线drama44通过、0失败、0取消；最终drama48通过、0失败、0取消。
- 根npm test通过834项，新增会话切换/晚到响应测试后drama48项再次通过，合计835项；无新增失败或取消。
- 临时DSH_HOME实际Chrome闭环：创建项目、基本资料编辑/工作区改名、原文编辑、完整剧本详情、规则补充保存、600/360/260px布局均通过；0模型请求、0浏览器异常。截图`/tmp/drama-project-detail-360.png`已检查。
- GitNexus detect_changes：changed23/affected14、HIGH，partial=false/truncated=false；涉及创建工具、HTTP和UI既有调用链，与计划一致。工具不包含尚未跟踪的新文件，另以源码导入链、HTTP/DOM及实际Chrome验证补充；收尾统一更新索引。
- 原始剧本、剧本输出与规则皆转义显示；非剧本节点数据保留，但本页面不展示。

最终已重启drama Harness；使用现有“三英战吕布”会话只读验证概要及公共规则页面，无浏览器异常。GitNexus索引更新成功，621个文件内容匹配；分析器的流程候选裁剪仍存在，不能把未列出的流程视为无影响。git diff --check通过。
