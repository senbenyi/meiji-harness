# drama 创建项目工具

- 类型：新功能（完整流程）
- 目标：会话或 UI 创建项目，经 drama Model 保存本地 JSON，为项目建立独立宿主工作区及会话，并实时刷新 UI。
- 非目标：不实现制作节点执行、设置后端或迁移旧 meiji 数据，不修改公共包业务边界。

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 状态 | 依据 |
|---|---|---|---|
| AC-1 | 提供项目名 → 项目 Model 保存真实默认值与空节点至 JSON | 已确认 | drama ProjectManager/ProjectModel、createNode、nodeDefinitions；沿用现有 basic_info 字段 |
| AC-2 | 创建两个项目 → 不同目录、不同工作区；项目会话 cwd 对应目录 | 已确认 | meiji app-runtime projectCommand、宿主 workspaceController.create/rename、sessionController.create({workspaceId}) |
| AC-3 | 创建成功 → 当前 UI 收到事件并显示新项目；重连/重启可读 | 未验收 | 增加受登录保护的快照与 SSE，按会话隔离 |
| AC-4 | drama 预设会话请求创建 → 注册工具可执行并返回项目/工作区/会话标识 | 未验收 | meiji session.js、tools/task-tools.js 工具注册协议 |
| AC-5 | 重复/并发同一请求、写入失败 → 不重复成功创建、不发布虚假成功 | 未验收 | 请求持久化、串行受理与失败测试 |

## 调用链与证据
宿主预设 → session.apply 注册 CreateProjectTool → 创建项目数据（复用 createNode；内部公共 RulesModel/NodeStateModel）→ ProjectManager/ProjectModel.update 原子 JSON → workspaceController → sessionController → 持久化绑定 → SSE → drama/client。
当前正在执行的会话不能通过公开控制器修改 cwd，因此创建项目专用新会话，并由 UI 切换；不把仅写绑定等同于改变工作目录。
GitNexus：ProjectModel 上游 LOW（ProjectManager.open、导出）；createNode 为 UNKNOWN，已源码核对现有节点与测试，不更改该函数。既有 UI 迁移改动与用户移动目录保留；必要时更新 meiji 的旧相对导入与路由物理目录，使本次 client 位置可加载。

## 待用户决定
无。只有名字时创建待补充资料的草稿，不编造创作要求或原稿；采用已有字段与默认画幅 9:16、参考时长180秒。

## 改动
1. `projects/drama/src/tools/creat_project_tool.js`：创建工具类、宿主协议、持久化绑定/请求恢复、创建通知。
2. `projects/drama/src/project/create_project.js`：既有字段初始化与输入校验，复用 createNode；不读取 docs 实例模板。
3. `projects/drama/{package.json,index.js,session.js,cordis.patch.yml}`：可选业务插件和预设注册；复用 npm workspace 公共包。
4. `projects/drama/src/{http,client}`：登录保护的创建/快照/事件与静态资源、UI 订阅及新会话切换，使用已迁移组件。
5. drama 测试：工具注册、JSON、工作区隔离、恢复/失败、HTTP/SSE及UI。
6. meiji 调用方与静态路由：只修正用户移动 src/client 后失效的地址，不覆盖原改动。

## 验证
基线 drama 测试；工具/HTTP/UI 新测试；npm test、verify:copy（显式项目）、verify:install；diff --check；GitNexus detect-changes 并更新索引。

## 验证结果
- drama 基线：19 通过、0 失败、0 cancelled。
- 新增工具/HTTP/UI后 drama：25 通过；完整 npm test：798 通过、0 失败、0 cancelled。
- verify:copy -- drama、verify:install、git diff --check 通过。
- 真实浏览器检查：drama 面板加载，无脚本错误；登录后 UI 模块/CSS及项目快照均 HTTP 200。
- 用户追加清空旧工作区/项目并启动：停服状态下将旧运行数据移出，备份到 ~/.dsh/backups/before-drama-reset-20261020-222637；旧27个工作区移除，启动后宿主自动建立1个新默认工作区。
- Web profile 从失效 meiji 链接切换到当前 drama 插件，保留模型连接与凭据。
- 真实模型自然语言调用未回放；工具通过宿主注册协议及执行测试验证。
