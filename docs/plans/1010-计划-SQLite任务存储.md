# SQLite 任务存储

- 类型：存储重构（完整流程）
- 目标：以本机 SQLite 为唯一持久化来源，保存任务组 → 任务 → 步骤，接入现有 Web/会话执行链。
- 非目标：修改生产模型调用、任务业务状态、媒体文件布局或上游 Harness。

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 状态 | 依据或缺口 |
|---|---|---|---|
| AC-1 | 初始化 → SQLite 三层表、外键、顺序唯一和队列索引可用 | 已确认 | Node 25.1.0 已带 SQLite 3.51.0，内存读写探针通过 |
| AC-2 | 业务提交 → 项目、任务、步骤、幂等与通知原子提交；重载一致 | 已确认 | model-repository.js:484 为唯一提交闭包 |
| AC-3 | 旧数据 → 按用户最新要求删除；新库初始化，启用后无 JSON 双写 | 已确认 | 用户随后明确要求旧数据删除；实际清空 projects/media 及旧绑定后初始化空库 |
| AC-4 | 重复受理、并发、失败、重启 → 保持现有业务契约 | 已确认 | task-service.js:588 恢复；stage02/04/08 测试 |
| AC-5 | 本机服务启动 → 实际读写 SQLite，页面/HTTP 可访问 | 已确认 | 当前运行于 3080，切换前正常停服 |

## 调用链与证据
Web/会话 → createAppRuntime → TaskService → ProjectModel.update → ModelRepository.#commit。
`model-repository.js:28`：project/tasks/steps/groups/runtime 一致快照；`app-runtime.js:33`：仓库根；`:369`：卸载；`task-store.js`：只读快照视图。
GitNexus 绑定 llm-dsh-plugins，真实根 /Users/tom/Documents/jileshijie/llm-dsh-plugins，索引最新。ModelRepository upstream HIGH：20 直接、27 总影响，涉及 createAppRuntime/apply 及阶段测试；createAppRuntime MEDIUM：8 直接。已向用户说明风险。

## 问题
| AC | 预期 | 实际 | 根因 |
|---|---|---|---|
| AC-1/2 | 关系表及事务 | 每次重写五份 JSON | 分代文件存储 |
| AC-3 | 清空后启用 | 存在旧项目与绑定 | 用户明确要求删除旧数据、不迁移 |

## 待用户决定
无。

## 改动
1. `meiji/server/data/schema.sql`、`sqlite-store.js`：建立关系表、SQLite 事务和版本校验，项目 JSON 与任务历史同事务；只更新变化记录 → AC-1/2。
2. `meiji/server/data/model-repository.js`：替换分代存储，保留唯一事务闭包、业务校验和事件；`app-runtime.js` 接入数据库位置与关闭 → AC-2/4。
3. 停服后清空本机旧项目和对应绑定，初始化空 SQLite；删除本次尚未启用的迁移实现 → AC-3。
4. `meiji/tests/stage02-*.test.js`、相关 fixture/契约测试：替换旧文件提交测试，补充外键、回滚、跨连接版本冲突、空库初始化与进程中断；同步 README、开发指引及 package scripts → AC-1～4。
5. `shared/task-labels.js`、`client/history-ui.js`：删除虚拟父组兜底及相关页面测试 fixture；新任务在受理时创建父组。图谱 historyGroups/renderHistory CRITICAL，已报告，验证 history/panel DOM 测试 → AC-1/3。
6. 本机清理旧数据并重启 Harness，验证数据库计数、完整性和真实 HTTP → AC-5。

验证：改前全量 206 pass / 0 fail / 0 cancelled；改后阶段测试和全量；git diff --check；detect_changes；最终更新图谱。

## 验证结果
- 用户最新要求：删除旧数据，不迁移；已移除本次临时迁移实现，没有运行数据迁移。
- 基线：206 pass / 0 fail / 0 cancelled。
- 最终全量：210 pass / 0 fail / 0 cancelled；日志 /tmp/meiji-sqlite-final.log。覆盖外键/顺序唯一/项目单运行任务、跨连接版本冲突、真实子进程在事务中途和提交后退出、幂等重载、业务链和 DOM 历史。
- SQLite 原生模块可用，版本 3.51.0；七表已建。真实库 /Users/tom/.dsh/storages/meiji/meiji.sqlite，WAL，integrity_check=ok，foreign_key_check=0；业务表均 0 条，schema_migrations 1 条。
- 已清理 Meiji 数据根下 projects、media、session-projects、bindings-v1.json、workspace-links.json；保留 assets 与 models.json。没有触碰 Harness 全局会话历史。
- Harness PID 17438 确认持有实际数据库；登录后 GET /api/meiji/projects 返回 HTTP 200 / projects=[]；浏览器刷新后显示空片库与创建项目入口。
- detect_changes：36 changed symbols / 21 affected / 14 tracked files，critical，与已报告存储/历史入口一致；partial=false、truncated=false。新建 schema/store/SQLite 测试另行核对并纳入最终索引。
- git diff --check 通过。最终图谱更新见实施记录。
