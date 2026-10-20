# drama 创建项目工具实施记录

## 已修改文件
- `projects/drama/src/tools/creat_project_tool.js`：CreateProjectTool 类，宿主工具定义、项目 Model/JSON保存、独立工作区与会话、请求去重/恢复、绑定和创建事件。
- `projects/drama/src/project/create_project.js`：既有 basic_info 字段校验和空项目；复用 createNode、公共 RulesModel 与 NodeStateModel，不读取开发 JSON。
- `projects/drama/src/http/project_routes.js`：鉴权、快照、面板创建、会话隔离 SSE、静态模块及断开清理。
- `projects/drama/src/client/{panel.js,workbench.js,project-ui.css}`：宿主面板挂载、创建回调、实时读取快照和新会话切换。
- `projects/drama/{index.js,session.js,package.json,cordis.patch.yml,AGENTS.md}`：插件、预设、工具注册及开发入口；根 package-lock.json 同步工作区。
- `projects/drama/tests/create-project-{tool,http}.test.js`：工具注册/落盘/隔离/重试/恢复、真实HTTP/SSE与UI刷新测试。
- meiji/client、meiji/tests、meiji/server/http/task-routes.js：只同步用户移动 UI 至 src/client 后的模块和静态地址；runtime.test 显式选择 meiji 适配多项目。

## 验收标准核对
| AC | 状态 | 证据 |
|---|---|---|
| AC-1 | 通过 | 保存JSON并由 ProjectManager 重开，默认值、空节点与规则校验 |
| AC-2 | 通过 | 不同项目不同目录/工作区，sessionController.create 显式接收对应 workspaceId |
| AC-3 | 通过 | SSE真实HTTP事件和JSDOM刷新/会话选择；重启后读取绑定/JSON |
| AC-4 | 通过 | session.apply 注册工具，执行真实协议的 execute(args, exec)；预设注入调用说明 |
| AC-5 | 通过 | 并发和重启重试去重、资料冲突拒绝、工作区失败后原项目恢复 |

## 测试
- drama 基线19通过；新增后25通过；完整 npm test 798通过、0失败、0 cancelled。
- verify:copy -- drama、verify:install 通过；git diff --check 通过。
- Chrome headless：面板成功加载，无脚本错误；真实服务登录后资源、CSS与快照200。
- GitNexus detect-changes 仍将既有面板公共调用链判为 critical，涉及路径均在计划范围内。

## 用户追加清理与启动
旧运行数据已移至 `/Users/tom/.dsh/backups/before-drama-reset-20261020-222637`，包括旧工作区注册、旧会话、meiji/drama项目数据与旧业务项目目录。保留源码、模型连接与凭据。旧27个工作区移除；启动时 Harness 自动建立新默认工作区。Web profile 已改为当前 drama 插件，监听127.0.0.1:3080。

## 人工待办
尚未用真实模型回放自然语言创建请求。外部宿主创建会话与绑定文件写入不构成跨服务事务，进程恰在二者之间崩溃时仍可能遗留孤立宿主会话。
