# Harness模型请求记录实施记录

## 已修改文件
- packages/http-client/src/model-records.js、package.json：公共模型流记录器与公开导出；请求在next前入库，保留完整上下文、原始增量、合并结果、用量、结束原因及会话/用途。
- packages/http-client/ui/index.js、tests/ui.test.js：MODEL友好标记、无HTTP状态码时正确显示已完成，历史日志单独标为历史还原。
- projects/drama/index.js、src/records/service.js：通过公开llm/stream接入全局模型调用，关闭时先落盘部分返回再关DB；不改宿主源码。
- 公共model-records测试、drama插件集成测试、verify-install与双方说明同步。

## 验收标准核对
| AC | 状态 | 证据 |
|---|---|---|
| AC-1 | 通过 | 冻结参数、完整大提示词、messages/tools/参数、发出前持久化测试 |
| AC-2 | 通过 | 文本/工具/用量、错误终态、取消、异常、消费者退出测试 |
| AC-3 | 通过 | 并发和同请求再次调用独立行；关闭后晚到不写关闭数据库；插件关闭重开读取 |
| AC-4 | 通过 | 单测、隔离Harness真实界面及正式页面验证MODEL和历史还原标签 |
| AC-5 | 通过 | 原“三英战吕布”两轮主调用及一次标题回填3条，使用session+step确定ID并先查重；原提示词和27个工具声明可读 |

## 测试
- 基线HTTP35、drama43项通过；改后根npm test831项通过，0失败、0取消（HTTP42、task33、drama44及其他原测试）。
- npm run verify:install、npm run verify:copy -- drama通过。
- 隔离Harness通过支持的CLI启动；浏览器发送创建项目要求，模拟OpenAI端点接收3次请求，公共记录保存两轮主调用及标题请求，原工具和新工作区/新会话流程成功。仅模拟模型，无真实供应商请求。初次自动化在会话准备时发送未成功，稳定会话并使用发送按钮后闭环通过，未改产品代码规避。
- 正式Harness重启完成；用现有项目会话只读检查3条回填记录、完整请求/返回及历史标签，不创建测试项目。
- git diff --check通过；完整detect_changes无partial/truncated。Git图谱对HttpRecords提示CRITICAL，保留其schema和实现；新增模块及动态事件以源码、集成测试补查。

## 人工待办
无。适配器层无原始HTTP请求头/成功状态码，不伪造；SDK内部未再次进入公开拦截点的网络重试无法单独观察。历史条目capture_layer为session-log-reconstruction，原始时间位于source_started_at/source_finished_at，数据库时间为回填时间。代码未提交或推送。
