# 项目长期记忆与Drama跨项目偏好

- 类型：完整流程，新增持久记忆存储/上下文/工具/面板。
- 目标：项目决定、约束、未决问题跨Task/会话复用；用户偏好仅在Drama工程内跨项目复用；每次任务冻结记忆，模型有界按需读取，人工可维护。
- 非目标：不保存整个聊天当提示词，不做盒子独立长期记忆，不自动把AI推断/审核意见变为用户决定，不影响其他插件/Codex全局，不改正式项目产物Schema。
- 已确认：工程级是Drama跨项目。没有其他待决定项。

## AC与取证

| AC | 输入/操作 → 可观测结果 | 调研状态 |
|---|---|---|
| AC-1 | 记录/重启/新会话 → 记忆持久存在；项目隔离、工程偏好跨Drama项目共享 | 待实现，当前仅phase remember |
| AC-2 | 同key冲突/范围过滤 → 本次明确目标优先，其次项目记忆、工程偏好；正式产物/程序契约仍权威 | 待实现 |
| AC-3 | 人工/主Agent维护 → 查看/搜索/新增/更新/归档/删除/历史，冲突拒绝覆盖，有来源记录 | 待实现 |
| AC-4 | 文本生成/审核 → 首轮仅记忆索引，按需读冻结正文；审核不继承作者上下文 | model_loop.js已有工具循环，待接入 |
| AC-5 | 图片/视频生成 → 使用当次适用记忆，记录真实输入/快照；执行中修改不改变任务，续接原快照 | service及独立媒体执行器待接入 |
| AC-6 | 面板 → 保留既有风格，可管理两层记忆并提示工程共享/历史快照边界 | project-document-view.js待接入 |

## 调用链与风险

主Agent/面板 → MemoryService → 项目memory.json或Drama根memory/user-preferences.json；模型只读Task的memory_snapshot_ref。ProductionService.run在任务提交前冻结，resume_of继承原记忆引用。项目JSON仍为结构/实际内容权威。

GitNexus修改前status及刷新成功，CLI query定位生产流程；Workspace/Service影响162、Image161、Video146，均CRITICAL，已在修改前告知。modelTurn/View为UNKNOWN，已通过实际调用/模块注册源码补查。当前Drama基线为上轮350通过、0失败/取消；不覆盖前面未提交工作。

## 改动与验证

1. `src/memory/service.js`：独立持久存储、版本/原子写入/审计/删除/有效合并/有界索引与任务快照 → AC-1至3。
2. `src/tools/memory_tools.js`、index/session/context工具：主Agent读取与用户明确记忆写入，作用域和来源说明 → AC-3/4。
3. production Service/model_loop/image/video：冻结记忆、按需检索读取及媒体输入应用，审核独立 → AC-2/4/5。
4. production_routes及client memory-panel/view/assets/CSS：共用Service，手工维护、历史与冲突 → AC-3/6。
5. 记忆持久化/隔离/优先级/并发/归档删除/快照/续接/模型引用/媒体实际输入/面板交互测试；原Drama全量、verify:copy、真实Chrome检查；diff与最终图谱。

## 验证结果

未执行新实现验证。


用户补充：两层记忆均围绕视频生成而非写代码。已将domain固定为video_production，工具/主Agent指导/面板明确仅保存视频创作决定与偏好，不将开发规范或本轮实现细节写入用户记忆。

验收：AC-1至AC-6均通过。两层video_production记忆、维护工具/面板、独立审核读取/媒体实际输入、冻结快照/失败续接已验证。Drama全量359通过（基线350），0失败/0取消；记忆与注册/UI11项针对最终范围补测通过，Chrome400/960px交互无脚本错误/溢出，独立复制安装通过。实现路径与边界见[实施记录](../implement/1028-实施-项目长期记忆与Drama跨项目偏好.md)。工程偏好在尚未建项目的Drama会话也可读取，项目记忆仍要求当前项目归属。

最终收尾：最终代码Drama359项通过、0失败/0取消（/tmp/drama-memory-final-complete.log）；git diff --check通过。图谱刷新成功（20412节点/537548边/943流程），CLI detect-changes重跑显示115文件/54符号/931映射流程，risk critical。MCP传输不可用使用CLI；建图仍提示入口/分支预算截断，且Git差异映射不覆盖未跟踪新文件，因此未把图谱当作完整无影响证明；动态入口、新模块由源码、工具/界面和全流程回归补查。未提交推送。
