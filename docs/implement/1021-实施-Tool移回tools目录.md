# Tool移回tools目录实施记录

## 已修改文件
- projects/drama/src/tools/creat_project_tool.js：从创建盒子移回，项目字段依赖改相对路径。
- projects/drama/src/tools/optimize_script_tool.js：从优化盒子移回。
- projects/drama/src/node_box/create_project/index.js、script_revision/index.js：移除Tool导出，仅导出Executor。
- projects/drama/index.js、tests/create-project-tool.test.js、tests/script-optimization.test.js：使用tools目录入口。
- projects/drama/AGENTS.md、docs/开发方向.md、src/client/README.md、src/node_box/README.md：同步职责与路径。

## 验收标准核对
| AC | 状态 | 证据 |
|---|---|---|
| AC-1 | 通过 | 两Tool文件已移至tools，盒子内无Tool副本 |
| AC-2 | 通过 | 导出键检查确认盒子入口只有Executor |
| AC-3 | 通过 | 注册、创建、优化、复制和实际模拟浏览器均通过 |

## 测试
基线/改后drama71通过，0失败/取消；根npm test 873通过、0失败、0取消。
verify:copy drama通过。临时真实Harness模拟优化浏览器通过，未调用真实模型或修改真实项目数据。实际Harness已重启。
完整图谱检测无截断标志，差异检查通过，最终更新索引。

## 人工待办
无。
