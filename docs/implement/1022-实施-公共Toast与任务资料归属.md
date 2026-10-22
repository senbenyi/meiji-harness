# 公共Toast与任务资料归属实施记录

## 已修改文件
- packages/ui/package.json、index.js、tests/toast.test.js：新增@agent-modules/ui；showToast安全文本展示、默认2.5秒消失、同文档连续替换、不同document隔离、返回关闭函数；无业务依赖。
- packages/task/ui/index.js：复制通过onNotify通知调用方，停止写顶部固定notice；输入依赖移动到对应run-task-card内；任务卡顺序为身份、输入、步骤、输出。输入/输出仍支持原生折叠箭头及完整JSON复制。
- packages/task/tests/ui-parity.test.js：验证任务资料归属、多任务隔离、成功/失败复制通知、固定notice为空。
- projects/drama/src/client/project-overview.js、workbench.js：两个历史入口均调用公共showToast。
- projects/drama/package.json、package-lock.json：新公共包本地工作区依赖。
- projects/drama/src/harness_server/project_routes.js、record_routes.js及create-project-http.test.js：认证harness-http静态白名单增加公共UI资源；业务客户端包引用正确转换。
- scripts/verify-install.js、verify-copy.js：独立npm包安装与复制工作区检查覆盖第五个公共包。
- .agents/agent-harness-dev.md、projects/drama/docs/开发方向.md：公共包入口及任务卡片资料归属。

## 验收标准核对
| AC | 状态 | 证据 |
|---|---|---|
| AC-1 | 通过 | 浏览器点击输入复制出现公共toast，2.5秒后toast数量0、固定notice为空；单测覆盖成功失败回调 |
| AC-2 | 通过 | 真实任务卡片children顺序为任务头/身份/来源/输入依赖/步骤/任务输出；组直属输入数量0 |
| AC-3 | 通过 | 单测各任务只收到自身步骤，输入和输出各在对应任务卡内；原有复制、箭头与输出状态测试通过 |
| AC-4 | 通过 | ui2项独立测试通过；verify:install打包离线安装五个包、导入showToast通过；verify:copy -- drama通过 |

## 测试
- 最近基线：全量916通过，0失败/0取消。
- 本次：ui2项、task39项、drama111项均通过；根npm test共919通过，0失败/0取消，日志/tmp/toast-full-tests.log。
- npm run verify:install通过（/tmp/toast-verify-install-final.log）。
- npm run verify:copy -- drama通过（/tmp/toast-verify-copy-drama.log）；首次未指定项目因仓库有两个项目而退出，按项目指引加drama参数后通过，无业务缺陷。
- 浏览器截图/tmp/drama-task-toast-1022.png。未发起模型请求或修改已有业务记录。
- git diff --check通过。detect_changes含之前未提交修改共45符号/21文件/497流程，critical，无partial/truncated；新公共包/回调动态关系已由源码、独立安装及浏览器验证补查。
- 新静态路由需要服务重载，确认活动任务0后重启Harness drama，页面已生效。
- 最终索引更新成功：11,902节点、330,652边、320集群、487流程；分析器仍有流程预算/深度截断警告，未将未覆盖路径当成无影响，见/tmp/toast-index.log。

## 人工待办
无。用户第3项为空，本次仅实施前两项。
