# Tool移回tools目录

- 类型：完整重构流程，职责目录迁移。
- 目标：主Agent可调用的Tool集中在drama/src/tools，node_box只包含执行器及内部辅助代码。
- 非目标：不改变工具名称、参数、注册/执行行为，不接入新子Agent机制。

## 验收标准与调研结论
| AC | 输入/状态 → 结果 | 状态/依据 |
|---|---|---|
| AC-1 | 创建/优化Tool → src/tools/creat_project_tool.js与optimize_script_tool.js | 待验收；当前两Tool在node_box各目录 |
| AC-2 | 盒子index → 仅导出Executor，无Tool反向导出或兼容副本 | 待验收；原index同时导出Tool/Executor |
| AC-3 | 根插件及测试 → 新路径注册/加载，行为保持 | 待验收；index.js与两处Tool测试直接依赖 |

## 调用链与证据
session注册方式保持，根插件从tools导入工具；ProjectService继续从node_box获取执行器。Tool移出后创建字段引用重算为../project/create_project.js。
沿用GitNexus重构流程，实际仓库显式--repo .；索引有效，query/context/impact已执行。动态插件UNKNOWN由源码检索补查；高风险结果在编辑前告知。

## 待用户决定
无。

## 改动
1. 移动两Tool到src/tools，修正自身依赖。
2. 根插件/测试改路径，盒子index移除Tool导出。
3. 更新node_box/README、AGENTS及当前业务文档边界说明。

## 验证
基线drama71通过；改后drama、根npm test、verify:copy drama；实际模拟模型浏览器创建/优化/历史链路；旧路径检索、diff、图谱全范围检测与最终索引；重启drama。

## 验证结果
AC-1至AC-3通过。两Tool集中src/tools，node_box入口只导出Executor，旧路径源码/当前文档检索无命中。
drama基线/改后71通过，0失败/取消；根npm test 873通过、0失败、0取消；verify:copy drama通过。
临时DSH_HOME真实Harness模拟模型浏览器：创建/导入、优化、3步独立模型调用与记录、任务历史、预览/全文和600/360/260px均通过，零真实模型调用。已重启实际drama。
Tool类impact均CRITICAL/235，已编辑前告知；根插件UNKNOWN以源码和实际加载补查。scope=all检测17变化符号、486影响项、33已跟踪文件（含前序未提交修改），无截断标志。新目录实际导入边界检查通过，diff检查通过，最终刷新索引。

