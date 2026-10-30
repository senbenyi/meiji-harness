# 项目长期记忆与Drama跨项目偏好实施记录

## 范围与职责

两层都只服务视频创作，domain固定`video_production`。项目记忆保存本剧人物/剧情/视觉/声音决定、约束、偏好、未决问题；工程记忆只保存用户明确要求跨Drama项目复用的视频制作偏好。不会写入其他插件/Codex全局，不把代码规范、技术选型或开发流程存作用户偏好。没有预填从本轮开发讨论推断出的记忆。

## 已修改文件

- `projects/drama/src/memory/service.js`：项目memory.json、Drama工程memory/user-preferences.json；有界索引/查询、正文/来源、主题key更新、工程仅preference、步骤过滤/项目覆盖、版本冲突、串行原子保存、归档恢复/删除/历史；制作任务冻结记忆与媒体正文预算。项目记忆检查会话归属；工程偏好可在已鉴权的新Drama会话、尚未建项目前读取。
- `project_runtime/project_workspace_service.js`：组装/释放MemoryService。项目产物JSON Schema保持不变，记忆不混为实际剧本/分镜的另一权威来源。
- `tools/memory_tools.js`、`tools/production_tools.js`、插件`index.js`、`session/index.js`：注册drama-read-memory、drama-write-memory；主Agent按用户明确表达维护记忆/保留原话，先检索读取，工程仅跨Drama视频创作偏好；上下文工具返回有界索引。
- `production/service.js`：Task提交前冻结适用记忆到memory_snapshot_ref，失败续接沿原引用；新Task读取新版本。
- `production/model_loop.js`：首轮仅记忆索引/总数/优先级，search_memory/read_memory有界检索读取；读取事实进入外置trace；生成/独立审核/修订同快照，审核不继承作者工具上下文；长期用户要求可作为实际审核引文，旧审核意见不自动成为决定。盒子不能写长期记忆。
- `production/image_executor.js`、`video_executor.js`：实际生成输入使用当次适用记忆，输入快照记录memory_snapshot_ref，保留实际prompt；正文超过12000字符要求收窄适用范围而不静默遗漏。
- `harness_server/production_routes.js`：沿既有鉴权的production-memory GET/POST，项目归属、请求标识、冲突、搜索/分页/历史。
- `client/memory-panel.js`、`project-document-view.js`、CSS及client_assets：顶部“项目记忆”“Drama通用偏好”，维持主题；搜索、正文/来源编辑、类型/适用步骤、归档恢复、删除、历史；冲突保留输入，关闭/销毁清理面板。
- `tests/memory.test.js`、`memory-ui.test.js`、`shared-tools.test.js`及项目职责/数据契约文档。

## AC核对

| AC | 状态 | 证据 |
|---|---|---|
| AC-1 持久化与范围 | 通过 | 新MemoryService实例重读真实文件、第二项目共享工程偏好但无本项目记忆、工程偏好在未建项目会话可读 |
| AC-2 优先级与过滤 | 通过 | 同key按适用步骤项目覆盖工程、其他步骤回退工程；正式Schema不增加memory字段 |
| AC-3 维护与来源 | 通过 | 主Agent读写/注册、真实harness-http、用户原话/来源、并发旧版本拒绝、主题更新ID稳定、归档恢复与删除历史正文 |
| AC-4 文本上下文 | 通过 | 模拟真实模型网关调用read_memory，首轮索引无正文，执行中改动后生成/独立审核仍读旧版，新Task读新版；失败续接使用原快照 |
| AC-5 图片/视频 | 通过 | 真实模拟llm-http请求包含适用项目/声线记忆，不含被覆盖工程偏好和其他步骤记忆；视频输入文件关联memory_snapshot_ref |
| AC-6 面板 | 通过 | jsdom保存/冲突保留/历史/归档/删除/清理，真实Chrome新增编辑与第二项目复用，400/960px无横向溢出/脚本错误 |

## 验证

- 适用基线：上轮Drama350通过、0失败、0取消。
- 新记忆与工具/UI专项11通过、0失败、0取消；包含尚未绑定项目的新会话读取工程偏好，日志`/tmp/drama-memory-unbound-tests.log`。
- Drama全量359通过、0失败、0取消（`/tmp/drama-memory-domain-final.log`）；最后新增工程未绑定会话能力已针对同组11项补测，最终收尾复跑见计划。
- 初次全量曾出现旧分镜HTTP测试失败；该项单独复查及两轮完整复跑通过，未更改旧分镜业务。原jsdom部分既有测试会输出dialog.show未实现的控制台错误，实际Chrome检查0脚本错误。
- `npm run verify:copy -- drama`独立目录/改名/离线安装/包链接/插件入口与示例通过（`/tmp/drama-memory-copy.log`）。
- 真实Chrome：新增Drama视频制作偏好、本项目例外、正文和历史查看；新项目可看到跨剧偏好、本项目记忆为空；400/960px无溢出/脚本错误。`/tmp/drama-memory-ui-domain.log`，截图`/tmp/drama-memory-wide.png`、`/tmp/drama-memory-narrow.png`已目视检查。
- diff检查、最终图谱结果回填计划；不把图谱未覆盖的新文件或动态分派视为无影响。

## 使用和限制

用户可说“记住：本剧张飞整体沉稳”，或“以后Drama项目优先用克制的配乐”；主Agent按实际表达保存适用范围与原话，也可直接从面板维护。没有自动复制全部会话或自动把AI建议/审核意见记成用户要求。

记忆修改只影响新Task；续接保留原目标的记忆快照。删除移除当前记忆及其记忆修改历史，既有Task/提示词/媒体输入快照仍保留当时事实。字幕时长、视频模式、画幅等正式产物参数仍需通过对应编辑/生成步骤修改，记忆不会绕过程序校验直接改参数。真实供应商生成质量未测试，本轮使用本地模拟llm-http和实际媒体处理。

没有人工待办。未提交或推送代码，前序未提交改动保留。

最终收尾：最终代码Drama全量359通过、0失败、0取消（/tmp/drama-memory-final-complete.log）。diff --check通过；最终索引成功刷新，20412节点/537548边/943流程。CLI变更分析risk critical（115文件/54符号/931映射流程），建图预算截断/未跟踪新文件的差异映射限制仍存在，未宣称完整覆盖；实际调用入口及新增模块用源码与测试补查。
