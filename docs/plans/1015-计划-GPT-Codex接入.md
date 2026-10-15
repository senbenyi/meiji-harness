# GPT（Codex 套餐）接入

- 类型：新功能，完整流程。
- 目标：设置增加 codex-gpt 文本模型，通过本地 llm-server 调用官方 Codex App Server，使用 ChatGPT 订阅登录；GPT 按 developer/user/assistant 编排。
- 非目标：不更改项目业务数据、时长规则、原模型提示词、不重启 Harness、不刷新生产页面。左侧 Harness 工具会话保持原模型（制作端桥接只处理文本）。

## 验收
- AC1：设置可保存 GPT（Codex 套餐），制作请求路由本地 llm-server，不携带媒体网关密钥。
- AC2：固定规则使用 developer，背景资料置于末尾并明确边界；重新生成不带基稿，修订真实注入 user/assistant 历史，最新 user 携带意见和审核原因。共用业务契约不另复制节点模板。
- AC3：llm-server 对 codex-gpt 分流，不依赖 GPU；验证 ChatGPT 登录，选择 Codex 默认可用模型，禁用工具与项目指令，临时工作目录和临时会话，失败不返回假成功。
- AC4：60 分钟超时，连接断开/取消时终止 Codex 子进程，串行槽位释放；JSON 输出仍经 APP 节点校验。
- AC5：隔离端口真实请求验证文本生成和多轮修订，不接触生产项目任务。

## 路径
设置 SettingsModel → modelRoute → textProvider/renderPrompt → llmServerClient → /v1/chat/completions → Codex JSON-RPC initialize/account/read/model/list/thread/start/thread/inject_items/turn/start → 最终文本。

## 改动
- APP：settings_model、model-config、providers、render、ai-routes、llm-server/params、harness-chat-model；增加 GPT 编排测试与设置路由测试。
- llm-server：新增 codex-client，server 中按模型分流并复用队列与断连控制；index 注册；增加模拟进程/HTTP 集成测试及环境说明。
- 官方依据：https://learn.chatgpt.com/docs/app-server；https://developers.openai.com/api/docs/guides/prompt-engineering。本机 generate-json-schema 确认 thread/inject_items 接收 Responses 消息。

## 影响与验证
GitNexus：modelRoute/textProvider/renderPrompt HIGH，SettingsModel CRITICAL，responseInstruction/syncChatModel LOW，动态 clients 注册通过源码核对。已更新索引。
基线：APP 429 项，428 通过，1 项既有任务组提示失败；llm-server 24 项全通过。修改后全量回归、git diff --check、GitNexus 更新与影响检查，临时端口真实联调。

## 验证结果
AC1–AC5 全部通过，实际摘要生成与多轮修订 HTTP 200。APP 431 项/430 通过/1 项基线失败；服务端 31 项全通过。未启动生产新版本，详见对应实施记录。
