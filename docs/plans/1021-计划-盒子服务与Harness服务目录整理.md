# 盒子服务与Harness服务目录整理

- 类型：重构，完整流程。
- 目标：面板的harness-http路由与主Agent Tool直接调用对应盒子的Service，项目管理和剧本优化各自归盒子管理。
- 非目标：不新增摘要提取模型流程，不改业务字段、UI和公共包，不修改meiji或外部Harness，不把全部业务操作重新实现一遍。

## 验收标准与调研结论

| AC | 输入/状态 → 可观测结果 | 状态 | 依据 |
|---|---|---|---|
| AC-1 | 面板访问原URL → harness_server提供原接口和静态资源、SSE | 已确认待实施 | src/http/project_routes.js、record_routes.js、library_routes.js |
| AC-2 | 创建、编辑、删除、导入 → node_box/project/service.js处理，原创建和恢复行为保留 | 已确认待实施 | ProjectService现有方法，create_project/executor.js |
| AC-3 | 面板和Tool发起优化 → 同一ScriptRevisionService负责提交、等待及候选保存 | 已确认待实施 | ProjectService末段混合优化业务；OptimizeScriptTool和POST路由调用它 |
| AC-4 | 跨盒子写入并发、任务取消或原稿变化 → 串行保存，拒绝无效晚结果，无死锁 | 已确认待实施 | 原#tail、saveScriptCandidate和script-optimization测试 |
| AC-5 | 目录迁移后 → 无旧路径代理或跨项目引用，开发入口指向新结构 | 已确认待实施 | 全文引用检索和复制验证 |

## 调用链与证据

当前：index.js构建ProjectService；Tool和harness-http路由都调用它。路由初始化任务记录并注册优化执行器；ProjectService同时承载绑定、项目生命周期、优化任务和候选保存。

目标：index.js组装共享记录、ProjectService、ScriptRevisionService；路由和Tool分别注入所需服务。两个盒子共用project/write_queue.js的一个队列实例，耗时模型请求不占写队列。快照的执行状态投影由harness-http路由组合，项目服务不反向依赖优化服务。

GitNexus索引覆盖683文件且当前有效。查询、context和impact结果保存在/tmp/box-service-*.json、/tmp/box-*-impact.json。ProjectService风险CRITICAL；路由等存在UNKNOWN（动态入口未解析），已补查根插件注册、Tool、测试和所有旧路径引用；不据空结果判断无影响。

## 待用户决定

无。用户已确认盒内Service及harness_server结构。

## 改动

1. src/http → src/harness_server；更新根入口及测试导入，URL保持不变 → AC-1、5。
2. create_project盒子 → project；项目服务移入盒子，保持创建执行器符号；移除优化业务，采用共享队列并按活动任务保护编辑 → AC-2、4。
3. script_revision/service.js接收项目服务、记录及模型配置；迁入现有优化业务，执行器通过窄接口读取及保存 → AC-3、4。
4. 根入口明确组装各服务，Tool直接注入优化服务；更新已有测试和新增必要边界验证 → AC-3、4。
5. 更新drama开发入口、盒子和面板说明，明确当前实现与后续摘要能力的区别 → AC-5。

验证：drama基线、改后drama、根npm test、verify:copy -- drama、临时模型浏览器流程；git diff --check、完整detect_changes、最终索引。

## 验证结果

- drama基线71通过、0失败、0取消；改后72通过、0失败、0取消。
- 根npm test：874通过、0失败、0取消（各组53/25/11/35/671/7/72）。
- verify:copy -- drama通过，旧路径源码/当前文档检索无遗留；无兼容代理。
- 临时Harness浏览器：素材导入→创建→按意见优化→三阶段模型请求→候选/摘要/时长保存→任务/llm-http关联→详情/历史；600/360/260像素验证通过，均使用模拟模型及临时数据。
- 完整detect_changes：24符号、487影响、37已跟踪文件，风险critical；scope all包含本任务前的未提交改动。返回无partial/truncated字段，新目录未跟踪文件另经源码、完整测试及复制验收覆盖。
- git diff --check通过。最终索引和运行服务检查见实施记录。
