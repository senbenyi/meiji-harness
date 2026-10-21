# 主Agent规划与盒子报告闭环

- 类型：新功能，完整流程。
- 目标：创建项目、剧本优化由程序盒子执行，结构化报告交给真实Harness主Agent，主Agent调用工具修复规则/上游并派发关联新任务。
- 非目标：不接入Harness子Agent，不实现其他制作盒子的执行器，不改外部Harness/meiji，不自动授权规则修改，不让模型直接编辑项目文件。

## 验收标准与调研结论

| AC | 输入/状态 → 可观测结果 | 状态 | 依据 |
|---|---|---|---|
| AC-1 | 盒子通过/本节点失败/上游/规则冲突 → 报告含目标、依据、结果引用及任务关联；只有本节点问题内部修订 | 已确认待实施 | ScriptRevisionExecutor当前有分类，但最终等待结果未传review；还执行伪主Agent模型审核 |
| AC-2 | 创建/优化由会话或面板发起 → 创建/执行任务并返回或可靠投递报告到正确主Agent，主Agent使用Harness llm-http | 已确认待实施 | Tool已有exec上下文；面板缺结束投递；Harness公开agents及followup、会话模型选择可激活普通会话 |
| AC-3 | 主Agent读取规划依据 → 只能读取当前绑定项目的目标节点及依赖/过期列表，明确未实现节点不可派发 | 已确认待实施 | 目前只有创建和优化执行器，其他只有定义 |
| AC-4 | 规则冲突 → 主Agent提出具体修改，原生授权通过后校验旧值并经Model持久化、更新状态；拒绝不修改 | 已确认待实施 | Harness approval.request支持allowed-once/rejected等，项目现有写入队列与Model可复用 |
| AC-5 | 上游修复或规则变更 → 新任务关联原任务/原目标，旧任务快照不变；无变化不能盲目重试 | 已确认待实施 | task metadata和终态不可变；scriptFingerprint可核对 |
| AC-6 | 删除/跨会话/并发/取消/重启 → 不误投递或越权改写，不重复执行已完成盒子，保留记录 | 已确认待实施 | 现有绑定、队列和任务恢复；新增持久投递账本 |

## 调用链与证据

Tool或harness-http → 对应盒子Service → TaskManager → 程序Executor → llm-http（仅本盒子）→ 校验/保存 → 报告。
会话Tool直接返回报告；面板报告和新项目交接由session中的投递器送入真实主Agent的followup inbox，不伪装成人类消息。主Agent的下一轮llm-http仍由Harness组装和现有记录拦截。
规划相关代码归session，Tool协议归tools，规则保存归剧本优化盒子，Model/队列保持project_runtime。程序提供依赖和过期事实，AI选择修复/执行顺序。

已执行GitNexus状态、query/context与目标impact，ProjectService/ScriptRevisionExecutor/ScriptRevisionService/两个Tool均CRITICAL（约175—177影响），已告知；session动态apply为UNKNOWN，补查插件注册及宿主公开接口。证据/tmp/main-planning-*.json。只读核对外部Harness，不修改宿主源码。

## 待用户决定

无。按会话授权修改规则、保留源会话及新项目会话约定实现。

## 改动

1. 文档改为程序盒子+主Agent规划，保留用户要求流程及两个示例 → AC-1—5。
2. 增加通用终态等待/报告，创建纳入程序任务，优化仅本地审核/修订并报告 → AC-1、2、5。
3. session中增加规划指导、依赖上下文和持久报告投递，面板/创建交接唤醒主Agent；Tool结果不重复投递 → AC-2、3、6。
4. 添加读取规划上下文、修改项目上游、修改规则Tool；规则使用原生授权，程序执行器落盘并标过期；重试保留原目标与父任务 → AC-3—6。
5. 更新根插件/会话注册、记录节点目录和两盒Service，补模拟模型与宿主接口验证 → 全部AC。

验证：基线drama72通过、0失败、0取消。新增成功/本节点修订/规则冲突授权通过与拒绝/上游修复重试/旧值冲突/跨会话/面板投递重开去重等测试，完整npm test、复制与真实临时Harness模拟llm-http浏览器验证；git diff --check、完整detect_changes和最终索引。

## 验证结果

待执行。
