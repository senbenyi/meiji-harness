# 公共任务系统

`@agent-modules/task` 提供任务组、任务、步骤、节点状态 Model，任务管理器，内存/SQLite 存储，以及完整历史 UI。任务核心使用内置能力，历史UI依赖公共http-client包。业务节点、项目结构、网络端点和提示词规则由调用方提供；包内不包含 meiji 适配。

## 入口

| 导入路径 | 内容 |
|---|---|
| `@agent-modules/task` | 四个 Model、状态、TaskManager、MemoryTaskStore |
| `@agent-modules/task/models` | 浏览器可用的纯数据 Model、groupSummary |
| `@agent-modules/task/store` | TaskStore 接口与 MemoryTaskStore |
| `@agent-modules/task/sqlite` | Node 内置 SQLite 的 SQLiteTaskStore |
| `@agent-modules/task/ui` | 浏览器 createTaskHistory |

## 四个 Model

构造时用 `new TaskModel(fields)` 等；`toJSON()` 返回深拷贝，也支持 JSON.stringify。非法字段、类型、状态或记录关系抛出 `INVALID_TASK`，含 path。ID 默认由 crypto.randomUUID 创建，不解析业务 ID 前缀。

| Model | 字段与默认值 |
|---|---|
| TaskGroupModel | `id` 自动 UUID；`name='任务组'`；`group_type='single'`；`action='generate'`；`source='api'`；`metadata={}`；`created_at` 当前时间 |
| TaskModel | `id` 自动 UUID；必填 `group_id`、`node_type`；`group_seq=1`；`action='generate'`；`name='任务'`；`task_status='queued'`；`queue_order=1`；`source='api'`；`metadata={}`；`end_reason=''`；`created_at` 当前时间；`started_at=null`；`ended_at=null` |
| StepModel | `id` 自动 UUID；必填 `task_id`、`kind`；`name='步骤'`；`seq=1`；`round=0`；`executor='program'`（或 ai）；`step_status='ready'`；`error_reason=''`；`prompt=null`；`http=[]`；`result=null`；`metadata={}`；`started_at=null`；`ended_at=null` |
| NodeStateModel | `status='empty'`；`reason=''`；`dependency_hash=''` |

任务状态：queued/running/completed/rejected/failed/cancelled。步骤状态：ready/running/done/rejected/failed/skipped/cancelled。节点数据状态：empty/generated/rejected/expired；rejected、expired 必须有原因，其他状态原因须为空。节点状态没有 running、failed，执行失败只记录在任务/步骤。

项目 ID、业务目标 ID、意见、入队前节点状态等全部放 `metadata`，task 不定义 input；metadata 必须是可持久化的 JSON 对象，不可包含函数、undefined 或循环引用。组类型、节点类型、动作的业务取值由调用方提供。组的 status/reason/total_tasks/completed_tasks 由任务查询计算，不重复存储。

```js
const task = new TaskModel({
  group_id: 'group-id', node_type: 'summarize',
  metadata: { project_id: 'project-id', target_id: 'document-id', opinion: '保持简洁' },
});
```

## 注册与执行

```js
import { TaskManager } from '@agent-modules/task';
import { SQLiteTaskStore } from '@agent-modules/task/sqlite';

const store = new SQLiteTaskStore('./tasks.sqlite');
const manager = new TaskManager({ store, nodes: {
  summarize: {
    label: '资料整理',
    plan: task => [{ name: '生成摘要', kind: 'generate', executor: 'ai' }],
    async execute({ scope, task, step, signal, previousResults, recordPrompt, recordHttp }) {
      // 业务读取 task.metadata，生成提示词并执行；异步工作在数据库事务之外。
      return { status: 'done', result: '业务结果' };
    },
    commit({ scope, task, steps, result, database }) {
      // 可选同步提交；业务表与任务共用 database 时，同一事务完成。
    },
  },
} });
const group = manager.submit('opaque-scope', {
  group: { name: '整理资料' },
  tasks: [{ node_type: 'summarize', name: '整理文档', metadata: { target_id: 'document-id' } }],
});
await manager.idle('opaque-scope');
console.log(manager.detail('opaque-scope', group.group.id));
await manager.dispose();
store.close();
```

- `scope` 是调用方指定的隔离键，不是 Model 字段。manager 不读取 metadata.project_id。一个 scope 串行，不同 scope 可并行；同一 scope 同时只交给一个运行中的 manager 实例。
- `plan(task)` 为同步函数，返回非空步骤数组；kind、name、round 和 executor 由业务提供，不固定业务类型或三轮修订预算。执行器通过 previousResults 读取前面步骤的实际结果。
- `execute(context)` 返回 `{ status: 'done' | 'rejected' | 'skipped', result, reason }`；默认 done/result=null。rejected 必须有 reason；异常为 failed。业务审核/重试/分支由业务计划和执行器决定，公共包不自动添加审核或重试步骤。
- 某任务未通过、失败或取消，该组后续未执行任务取消；其他组继续。`continueGroup(scope, groupId)` 从第一个未完成任务新建组，保留业务 metadata、重新获取业务计划，不修改旧终态记录。
- `cancel(scope, groupId, reason)` 保存取消状态并发送 AbortSignal。执行器必须配合信号终止外部工作；忽略信号的执行仍会阻塞当前 scope，但迟到结果不能覆盖终态。
- `activeGroups(scope)` 返回未结束的任务组及成员；内存执行上下文只保留当前运行信息，完整事实由 store 保存。
- `recover(scope)` 在启动后调用：中断的 running 任务记 failed，同组后续取消，独立 queued 组仍可执行。不会自动重放可能已产生外部副作用的请求。需要继续时显式新建组。
- `autoStart: false` 可只入队，用 `start(scope)` 开始。`dispose()` 取消正在执行的组并等待执行器结束，保留其他 queued 组；store 由调用方关闭。

## 提示词与 HTTP 连接

```js
// 以下代码位于 execute(context) 内。
const { messages } = composeMessages({ system: '基础规则', user: '执行要求' });
recordPrompt({ model: 'chosen-model', messages, input: {} });
const response = await requestData(request, { signal, record: recordHttp });
```

composer 只编排，HTTP 包只请求，task 按执行上下文保存记录。task 无需反向控制这两个包。传入记录前应按调用方策略脱敏；http-client 的标准回调已经过滤其凭据和媒体正文，业务额外字段由业务脱敏。任务 metadata 也不应包含密钥。

prompt 固定结构：`{id, model, messages, input, created_at}`。一套实际消息对应一个步骤，多次独立模型调用拆成多个步骤。messages 保留实际顺序和多模态结构，不保存可推导的 system/user/body 副本。

每条 http 为公共 HTTP 回调数据，加稳定 `id` 和可空 `prompt_id`。同一个回调对象的请求、响应更新同一条记录；轮询/下载可在无提示词步骤中记录，此时 prompt_id=null；`recordHttp(transfer,{drop:true})` 删除该次记录。终态步骤拒绝迟到记录，错误码 STEP_CLOSED。step 本身提供所属任务关系，group_id 通过任务查询，无需重复嵌入。

## 存储与事务

MemoryTaskStore 适用于测试和临时执行；SQLiteTaskStore 持久化全部历史。`store.transaction(scope, (snapshot, database) => ...)` 是同步事务；模型/关系校验失败回滚，组定义与终态任务/步骤不可变。history 查询只读组、任务，不加载提示词和 HTTP；detail 按组返回完整记录。

内置调度器提交时只追加新组，执行、提示词和 HTTP 记录只加载当前任务所在组，调度与恢复只加载活动组。SQLite 按差异执行 INSERT/UPDATE，空修改不写入；历史筛选、排序、计数及分页在数据库完成，仅把当前页组与任务解析到内存，详情按目标组读取。组内顺序、全局队列顺序与单个运行任务通过索引约束保护；既有数据库打开时自动创建索引，公共 Model 与记录 JSON 无需迁移。

显式调用 `store.read(scope)` 或不带第三参数的 `store.transaction(scope, change)` 仍会读取完整 scope，适用于批量操作。需要受限更新时可传第三参数 `{ groupId }`、`{ taskId }`（任务所属组）或 `{ activeOnly: true }`；受限事务只允许更新已有记录，不能新增或换归属，仍执行相同校验。SQLite 负责跨工作集合的唯一性检查并在冲突时回滚。内存后端保留相同语义，适用于临时、小规模数据；长期历史推荐 SQLite。

SQLite 使用独立 agent_task_* 表，scope 在存储列中；可用 `new SQLiteTaskStore(':memory:', { database })` 接入已有 DatabaseSync 连接，不关闭调用方的连接。注册节点的同步 commit 在任务完成的同一事务内运行，抛错会回滚业务表写入并将任务记失败。独立数据库、文件、网络等外部写入不具备跨系统原子性，应由业务提供幂等提交或恢复机制。不要把异步操作放入 commit。

## 公共历史 UI

```js
import { createTaskHistory } from '@agent-modules/task/ui';
const history = createTaskHistory({
  source: manager.historySource('opaque-scope'),
  nodeTypes: manager.nodeTypes(),
  title: '任务历史', onBack: () => showPreviousPage(),
});
container.append(history.element);
await history.ready;
// 卸载时清理订阅；不取消后台任务。
history.dispose();
```

UI 保留原历史面板的通用展示与交互，筛选只有节点类型、任务状态，无选集：

| 页面 | 保留的展示与交互 |
|---|---|
| 列表 | 原卡片 DOM 顺序与紧凑布局：名称+状态、组 ID、来源+创建时间、完成数+当前任务、原因、进度条；整行点击、Enter/空格进入，复制 ID 不导航；分页、筛选 |
| 任务组 | 组标题/状态、组 ID/进度，各任务名称/状态、ID、来源/创建时间、带分类原因及复制；展示全部任务，不只展示入口任务 |
| 步骤 | 原有序时间线、序号、AI/程序标记、状态、内联原因/时间/结果与复制；展开/收起完整结果，返回和刷新保留展开状态；仍可单独查看步骤 |
| 提示词 | 任务名和步骤序号，实际消息顺序、原文完整展示、统一复制全部；不附加可推导的重复正文或业务输出 |
| HTTP | 始终提供入口，包括程序步骤和空记录；多次请求标签、请求/返回标签、尚未返回状态、完整原文复制及记录关联 ID |
| 数据交互 | 任务/组直达、缓存页与终态详情复用、运行中事件刷新、失败重试保留旧详情、晚到拒绝、卸载取消订阅、多实例隔离 |

未知历史节点类型仍按原标识显示。`initialView` 可包含 `{ groupId, taskId, stepId, record: 'prompt' | 'http', status, node_type, offset }` 作为初始页面；控制器提供 `openGroup(groupId)`、`openTask(taskId)`。返回列表保留原筛选和页码。

审核结果的业务格式通过可选 `presentation` 注入：

```js
const history = createTaskHistory({
  source, nodeTypes,
  presentation: {
    taskName: task => task.name,
    stepName: (step, task) => step.name,
    sourceLabel: source => source === 'api' ? 'API 发起' : source,
    review: (step, task) => ({
      rejected: step.result?.passed === false,
      reason: step.result?.reason || '',
      type: step.result?.category || '',
    }),
  },
});
```

`review` 返回的 rejected 补充步骤的显示判断，reason 在 error_reason 为空时展示，type 用于原因分类。基础任务状态和步骤数据不被 UI 改写。公共组件不读取任何业务特有审核字段。

远程 source 可自行实现 `history({node_type,status,offset,limit})`、`detail(groupId)` 和可选 `subscribe(listener)`（返回取消订阅函数），返回结构同 manager。支持 task ID 入口时，另提供 `resolveTask(taskId)` 返回组 ID 或 null；manager.historySource 已提供。切换业务范围时销毁旧控制器再创建，拒绝旧请求回写。UI 不内置 HTTP 路由、鉴权、项目定位或业务标签。`document`、`copyText(text)` 可注入；Shadow DOM 隔离样式，支持 --task-background、--task-card-background、--task-color、--task-muted、--task-border、--task-accent CSS 变量。

`examples/history.html` 使用纯浏览器 Model 与模拟数据，可通过任意静态 HTTP 服务直接查看。`examples/agent.js` 联合安装本工作区的 task、prompt-composer、http-client 后可运行，验证真实本地模拟 HTTP、任务调度及 SQLite 重开；不调用真实模型。

HTTP步骤详情由 `@agent-modules/http-client/ui` 提供，task的npm依赖包含http-client；历史任务的列表、任务组及步骤卡片仍由task维护。浏览器直接加载源码时，需用import map或宿主静态模块映射解析该依赖，示例见 `examples/history.html`。
