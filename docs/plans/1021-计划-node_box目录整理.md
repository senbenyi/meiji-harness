# node_box目录整理

- 类型：完整重构流程，按盒子归类现有模块。
- 目标：drama/src/node_box下一个盒子一个目录，创建项目与剧本优化分别包含Tool和执行器。
- 非目标：不新增通用运行器、不更改业务行为、任务格式或规则位置；保留公共项目模型和现有服务职责。

## 验收标准与调研结论
| AC | 输入/状态 → 结果 | 状态/依据 |
|---|---|---|
| AC-1 | 创建盒子/优化盒子 → 各自目录内包含Tool、执行器及本盒子辅助文件 | 待验收；原分散src/tools、executors、project/script_state |
| AC-2 | 插件、服务、测试导入 → 使用新位置，旧文件无兼容副本，无遗漏引用 | 待验收；根index/ProjectService/两处测试为调用方 |
| AC-3 | 创建/优化/UI/任务历史 → 行为保持，复制后正常运行 | 待验收；现drama71测试与临时浏览器覆盖 |

## 调用链与证据
根插件从node_box/<box>/index.js获取Tool；ProjectService从各盒子获取Executor；会话注册方式与HTTP入口不变。
create_project：tool.js、executor.js、index.js。
script_revision：tool.js、executor.js、state.js、index.js。
项目模型/通用提示词编排/记录服务仍在原共享目录，skills规则保持原有导入路径。
已沿用GitNexus重构流程，实际仓库显式--repo .；索引有效，query/context/impact已执行，图谱动态/未知调用补源码检索。

## 待用户决定
无。

## 改动
1. 移动五个现有实现文件，调整自身相对引用；每盒子添加统一index.js。
2. 根插件、ProjectService和测试改引用新入口；移除空tools/executors目录。
3. 更新AGENTS、当前开发说明和客户端说明，新node_box/README说明目录职责。

## 验证
基线drama71通过，0失败/取消。改后drama、根npm test、verify:copy drama；临时模拟模型真实Harness优化链路；旧路径检索、diff、全范围图谱、最终索引；重启drama。

## 验证结果
AC-1至AC-3通过。两个盒子目录各有统一入口、Tool、Executor，优化盒子包含state；旧tools/executors目录和project/script_state文件移除，源码及当前文档无遗留路径。
drama基线/改后71通过，0失败/取消；根npm test 873通过、0失败、0取消。verify:copy drama通过。
临时DSH_HOME真实Harness模拟模型浏览器：导入/创建、优化、三步审核调用记录、任务历史、四行预览和全文，600/360/260px通过；零真实模型调用。
已重启实际drama。图谱createTool/createExecutor/optimizeTool/state/ProjectService为CRITICAL，scriptExecutor LOW，插件apply UNKNOWN，均已源码补查并事先告知风险。scope=all检测29变化符号、487影响项、33已跟踪文件（含既有未提交修改），无截断标志；新目录以实际加载/运行验证补查。diff检查通过，最终刷新索引。

