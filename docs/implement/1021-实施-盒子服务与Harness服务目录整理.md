# 盒子服务与Harness服务目录整理实施记录

## 已修改文件

- projects/drama/src/harness_server/：迁入原http的三份路由并增加说明；保留URL、认证、静态资源、记录查询与SSE。
- projects/drama/src/node_box/project/：原create_project改为项目管理盒子；service.js接收原项目生命周期逻辑，executor.js保留创建和恢复，index.js导出二者。
- projects/drama/src/node_box/script_revision/service.js：独立承接优化校验、幂等任务提交、等待终态和候选保存。执行器通过读取/保存窄接口调用，不依赖项目服务代理优化业务。
- projects/drama/src/project/write_queue.js：共享一个写入队列；失败不阻断后续操作，模型请求不占队列。移除旧project_service.js，不留转发文件。
- projects/drama/index.js、src/tools/optimize_script_tool.js：根插件组装共享记录和两盒服务，Tool直接注入优化服务，harness-http路由不再隐式初始化优化执行器。
- projects/drama/tests/：更新路径和服务注入；新增面板与Tool同请求并发、运行状态投影和删除保护验证。
- drama的AGENTS.md、docs/开发方向.md、src/node_box/README.md、src/client/README.md：同步结构及职责，区分现有优化稿摘要与尚未新增的原稿摘要提取。

## 验收标准核对

| AC | 状态 | 证据 |
|---|---|---|
| AC-1 | 通过 | harness-http路由测试、临时实际Harness浏览器流程 |
| AC-2 | 通过 | 创建幂等/失败恢复、编辑、导入、删除及工作区测试 |
| AC-3 | 通过 | Tool与面板共用ScriptRevisionService；并发同请求仅一组任务、三次llm-http |
| AC-4 | 通过 | 取消/外部修改拒绝晚写；活动任务阻止导入和删除；生成/审核/修订循环通过 |
| AC-5 | 通过 | 当前源码/文档无旧路径，复制目录及改名验收通过 |

## 测试

- 基线drama：71通过、0失败、0取消。
- 首次拆分后70通过、1失败、0取消：删除测试夹具曾依赖路由隐式注册优化执行器；已改为显式组装服务，之后72通过、0失败、0取消。
- 根npm test：874通过、0失败、0取消。
- verify:copy -- drama通过。
- 临时实际Harness浏览器验证通过：素材库导入、创建工作区新会话、优化输入、候选/摘要/时长、三阶段llm-http与步骤关联、任务历史、详情与多宽度。仅模拟模型和临时数据，未修改真实项目。
- 基线已有JSDOM dialog.show提示仍存在，测试未失败；未扩展修复无关UI。
- 完整detect_changes保存于/tmp/box-service-detect.json；24符号、487影响、37已跟踪文件，风险critical。scope all含此前未提交改动；无partial/truncated字段。新目录另外经源码检查、测试、复制及浏览器验证。
- git diff --check通过。
- 最终索引成功：10606节点、158848边、300聚类、490流程；status确认688覆盖文件一致。Harness已重启drama，真实服务设置页只读检查通过，配置未改、无浏览器错误。

## 人工待办

无。本次为目录/服务边界重构；未新增原稿摘要提取子Agent、所有项目管理动作任务记录或HTTP分类字段，不把规划当作已完成能力。
