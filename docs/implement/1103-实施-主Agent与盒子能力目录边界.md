# 主Agent与盒子能力目录边界实施记录

## 已修改文件

26文件实际移动，业务代码不变，仅同步模块路径。

| 原路径 | 新路径 |
|---|---|
| `projects/drama/src/shared/agent/rules.js` | `projects/drama/src/node_box/shared/agent/rules.js` |
| `projects/drama/src/shared/agent/model_loop.js` | `projects/drama/src/node_box/shared/agent/model_loop.js` |
| `projects/drama/src/shared/agent/agent_context.js` | `projects/drama/src/node_box/shared/agent/agent_context.js` |
| `projects/drama/src/shared/agent/agent_tools.js` | `projects/drama/src/node_box/shared/agent/agent_tools.js` |
| `projects/drama/src/shared/agent/contracts.js` | `projects/drama/src/node_box/shared/agent/contracts.js` |
| `projects/drama/src/shared/production/service.js` | `projects/drama/src/node_box/shared/production/service.js` |
| `projects/drama/src/shared/production/execution_support.js` | `projects/drama/src/node_box/shared/production/execution_support.js` |
| `projects/drama/src/shared/production/text_executor.js` | `projects/drama/src/node_box/shared/production/text_executor.js` |
| `projects/drama/src/shared/production/unit_executor.js` | `projects/drama/src/node_box/shared/production/unit_executor.js` |
| `projects/drama/src/shared/production/program_executor.js` | `projects/drama/src/node_box/shared/production/program_executor.js` |
| `projects/drama/src/shared/production/executor_registry.js` | `projects/drama/src/node_box/shared/production/executor_registry.js` |
| `projects/drama/src/shared/production/text_pipeline.js` | `projects/drama/src/node_box/shared/production/text_pipeline.js` |
| `projects/drama/src/shared/media/audio_import.js` | `projects/drama/src/node_box/shared/media/audio_import.js` |
| `projects/drama/src/shared/media/subtitles.js` | `projects/drama/src/node_box/shared/media/subtitles.js` |
| `projects/drama/src/shared/media/timeline_renderer.js` | `projects/drama/src/node_box/shared/media/timeline_renderer.js` |
| `projects/drama/src/shared/tools/memory_tools.js` | `projects/drama/src/main_agent/tools/memory_tools.js` |
| `projects/drama/src/shared/tools/production_tools.js` | `projects/drama/src/main_agent/tools/production_tools.js` |
| `projects/drama/src/node_box/project/tools/fields.js` | `projects/drama/src/main_agent/tools/project/fields.js` |
| `projects/drama/src/node_box/project/tools/creat_project_tool.js` | `projects/drama/src/main_agent/tools/project/creat_project_tool.js` |
| `projects/drama/src/session/task_display_context.js` | `projects/drama/src/main_agent/session/task_display_context.js` |
| `projects/drama/src/session/index.js` | `projects/drama/src/main_agent/session/index.js` |
| `projects/drama/src/session/report_dispatcher.js` | `projects/drama/src/main_agent/session/report_dispatcher.js` |
| `projects/drama/src/session/user_goal.js` | `projects/drama/src/main_agent/session/user_goal.js` |
| `projects/drama/src/session/panel_task_messages.js` | `projects/drama/src/main_agent/session/panel_task_messages.js` |
| `projects/drama/src/shared/nodes/box_report.js` | `projects/drama/src/main_agent/session/box_report.js` |
| `projects/drama/src/settings/main-agent.js` | `projects/drama/src/main_agent/settings/main-agent.js` |

其他导入与测试调用方：
- `projects/drama/src/node_box/adaptation_plan/runtime/pipeline.js` — 同步实际模块路径。
- `projects/drama/src/node_box/asset_preparation/runtime/manual.js` — 同步实际模块路径。
- `projects/drama/src/node_box/asset_preparation/runtime/executor.js` — 同步实际模块路径。
- `projects/drama/src/node_box/video_prompt/runtime/pipeline.js` — 同步实际模块路径。
- `projects/drama/src/node_box/shot_design/runtime/pipeline.js` — 同步实际模块路径。
- `projects/drama/src/node_box/source_analysis/runtime/execute.js` — 同步实际模块路径。
- `projects/drama/src/node_box/editing/runtime/execute.js` — 同步实际模块路径。
- `projects/drama/src/node_box/editing/runtime/manual.js` — 同步实际模块路径。
- `projects/drama/src/node_box/editing/runtime/pipeline.js` — 同步实际模块路径。
- `projects/drama/src/node_box/story_segments/runtime/execution.js` — 同步实际模块路径。
- `projects/drama/src/node_box/story_segments/runtime/pipeline.js` — 同步实际模块路径。
- `projects/drama/src/node_box/delivery/runtime/execute.js` — 同步实际模块路径。
- `projects/drama/src/node_box/video_render/runtime/executor.js` — 同步实际模块路径。
- `projects/drama/src/node_box/clip_arrangement/runtime/pipeline.js` — 同步实际模块路径。
- `projects/drama/tests/node-rule-files.test.js` — 同步实际模块路径。
- `projects/drama/tests/shared-tools.test.js` — 同步实际模块路径。
- `projects/drama/tests/task-messages.test.js` — 同步实际模块路径。
- `projects/drama/tests/model-exchange.test.js` — 同步实际模块路径。
- `projects/drama/tests/project-workspace-v2.test.js` — 同步实际模块路径。
- `projects/drama/tests/memory.test.js` — 同步实际模块路径。
- `projects/drama/tests/production-pipeline.test.js` — 同步实际模块路径。
- `projects/drama/tests/main-agent.test.js` — 同步实际模块路径。
- `projects/drama/tests/adaptation-groups.test.js` — 同步实际模块路径。
- `projects/drama/tests/failure-reason.test.js` — 同步实际模块路径。
- `projects/drama/tests/production-architecture.test.js` — 同步实际模块路径。
- `projects/drama/tests/execution-activity.test.js` — 同步实际模块路径。
- `projects/drama/tests/agent-runtime.test.js` — 同步实际模块路径。
- `projects/drama/tests/helpers/production-fixture.js` — 同步实际模块路径。
- `projects/drama/index.js` — 同步实际模块路径。

- `projects/drama/package.json` — ./session公开导出指向main_agent/session/index.js。
- `projects/drama/tests/production-architecture.test.js` — 验证main_agent、node_box/shared与shared三层归属，共用目录不计作第十三盒子；服务端仍不公开。
- `projects/drama/tests/node-rule-files.test.js` — 复制src后的子进程契约导入指向盒子共用层。
- `projects/drama/AGENTS.md`、`projects/drama/docs/开发方向.md` — 同步主Agent与盒子边界；历史记录不改写。
- `docs/plans/1103-计划-主Agent与盒子能力目录边界.md` — 调研、计划与验证回填。

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|---|---|---|
| AC-1 | 通过 | 盒子专用运行器、工具、规则/契约、制作调度及后期辅助归node_box/shared |
| AC-2 | 通过 | 主会话工具/参数、Harness接入、通知/展示、主模型配置归main_agent |
| AC-3 | 通过 | 双方实际共用模块保留shared，没有复制业务Service或模型循环 |
| AC-4 | 通过 | 26文件代码一致性、公开导入、330项根回归、复制与安装验收 |

## 测试
- 基线与最终均330通过（公共包143、工程7、Drama180）、0失败、0取消、0跳过。
- 架构与规则加载9项通过；复制验收通过；5公共tarball隔离离线安装与运行通过。
- 26文件仅相对模块路径变化，业务代码一致；原路径全部移除。
- 预检fields.js HIGH（159上游）已移动前告知；25个UNKNOWN用源码补查。索引更新成功：18543节点、196040边、512流程。
- detect-changes更新前后重复核对，最终60差异文件但0映射符号/流程，无partial/truncated。纯路径移动的图谱覆盖有限，不作为无影响证据，不降低HIGH风险；26文件业务代码一致性、导入与330项回归、复制/安装验收补充。
- git diff --check通过；完整检测使用临时索引纳入新增文件，真实暂存区未改。
- 确认无未结束任务后重启成功，进程13499监听3080；启动无插件加载错误。

## 人工待办
无。未调用真实供应商模型，未修改持久化结构与运行数据。
