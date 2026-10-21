# node_box目录整理实施记录

## 已修改文件
- projects/drama/src/node_box/create_project/tool.js、executor.js：从原tools/executors移动，业务符号与逻辑保持。
- projects/drama/src/node_box/script_revision/tool.js、executor.js、state.js：归集优化工具、执行和状态辅助函数。
- 两盒子index.js与node_box/README.md：对外入口及目录职责。
- projects/drama/index.js、src/project/project_service.js：引用盒子新入口；两处Tool测试改引用。
- projects/drama/AGENTS.md、docs/开发方向.md、src/client/README.md：同步现行路径。历史根计划/实施文档保留当时路径。
- 移除原空tools/executors目录，不留旧路径兼容副本。

## 验收标准核对
| AC | 状态 | 证据 |
|---|---|---|
| AC-1 | 通过 | create_project/script_revision两独立目录，Tool/Executor/辅助代码归集 |
| AC-2 | 通过 | 根插件、服务与测试加载新入口，旧路径检索无命中 |
| AC-3 | 通过 | drama测试、复制验收与真实临时Harness优化链路通过 |

## 测试
基线/改后drama71通过、0失败/取消；根npm test 873通过、0失败、0取消。
verify:copy drama通过。临时真实宿主+模拟模型创建/优化/历史/预览/全文通过；没有真实模型调用或用户项目数据变更。已重启实际drama。
全范围图谱检测无截断标志，git diff --check通过，最终更新索引。

## 人工待办
无。
