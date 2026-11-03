# 主Agent与盒子能力目录边界

- 类型：重构（完整流程）。
- 目标：盒子专用执行能力进入node_box/shared，主Agent工具与宿主接入进入main_agent，双方共用基础能力保留shared。
- 非目标：复制或重写模型循环、业务Service、工具实现；修改生成策略、模型接口、用户数据及存储结构；保留旧路径转发层。

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 状态 | 依据 |
|---|---|---|---|
| AC-1 | 盒子模型上下文/工具/循环、制作调度、专属媒体处理 → 位于node_box/shared | 已确认待实施 | 实际导入与26文件清单 |
| AC-2 | 主会话工具、通知/展示接入、用户目标与主Agent模型设置 → 位于main_agent | 已确认待实施 | session/index、插件index与工具协议 |
| AC-3 | 双方使用的阶段目录、执行摘要、规则定位、原稿处理及基础媒体能力 → 保留shared，不重复实现 | 已确认待实施 | frontend/存储/主工具/盒子调用交集 |
| AC-4 | 宿主导出、静态/动态导入、规则、前端白名单及生产流程 → 可安装运行，行为保持 | 未验收 | package.json exports、根测试、复制/安装验收 |

## 调用链与证据
插件index组装共用ProjectWorkspaceService与盒子ProductionService → main_agent/session注册主Agent工具 → 工具调用同一业务Service → node_box/shared制作调度 → 单盒子runtime → node_box/shared/agent运行器 → 共享模型客户端。
main_agent/session只适配Harness，不建立新主模型循环。项目创建工具/字段是主Agent协议，实际ProjectDocumentExecutor仍归project盒子。
shared/agent/execution_activity供浏览器和主会话展示；shared/production/production_stages供浏览器/存储/盒子/记忆；shared/nodes/node_rule_files供规则HTTP、记忆与盒子；shared/text/source供Store与盒子；shared/media/media供图库与盒子，均继续共用。
GitNexus meiji-harness当前索引有效；26文件impact：HIGH 1（创建fields.js，159上游）、UNKNOWN 25，未partial/truncated。HIGH已移动前告知，UNKNOWN用实际import、导出清单与动态子进程路径补查，不当无影响。

## 待用户决定
无。

## 改动
### 阶段1：实际移动 → AC-1/2/3
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

### 阶段2：同步入口、测试与规范 → AC-4
- projects/drama/package.json exports[./session]指向main_agent/session/index.js，主导出不变。
- projects/drama/index.js、src/**和tests/**按目标模块更新import/export/new URL、嵌入式子进程模块路径与白名单拒绝访问断言。
- production-architecture.test.js识别node_box/shared为盒子共用目录，不当作第十三个盒子；验收三层归属及旧目录清理。
- projects/drama/AGENTS.md、docs/开发方向.md与相关当前说明同步；历史计划记录不改写。

验证：基线npm test：330通过（公共包143/工程7/Drama180）、0失败/取消/跳过。移动后根npm test、verify:copy、verify:install（会话公开导出路径变化）；26文件除模块路径外逐字一致性；差异检查与完整图谱变化核对；最终集中更新索引。无未结束任务才重启生效。

## 验证结果
- AC-1/2/3通过：26文件完成归位，逐一按相对模块路径字面量归一比较，业务代码与移动前一致；旧文件路径全部移除，无转发层。双方共用模块未复制。
- AC-4通过：主插件与@drama/harness-plugin/session公开导出导入通过；根npm test共330通过（公共包143、工程7、Drama180），0失败/取消/跳过，与基线一致；架构/规则9项通过。
- verify:copy通过（自动项目选择、更名、离线安装与入口），verify:install通过（5个公共npm tarball隔离离线安装运行）。规范与开发方向已同步。
- 未调用真实供应商模型，未修改业务数据/持久化结构。图谱检查与重启结果如下。
- 预检fields.js为HIGH（159上游节点），已在移动前告知；25个UNKNOWN目标经实际导入/宿主清单补查，未降级视为低风险。
- 集中索引更新成功：18543节点、196040边、512流程。完整detect-changes在更新前后均运行，最终覆盖60个差异文件但映射0符号/0流程，无partial/truncated；此纯路径移动的符号映射覆盖不足，不作为无影响结论，预检HIGH风险保留，以26文件代码一致性、公开导出、330项回归、复制/安装验收补充。
- 临时Git索引纳入新增文件检查，真实暂存区未改，git diff --check通过。
- 无未结束任务时重启成功，进程13499监听127.0.0.1:3080；启动无插件加载错误。
