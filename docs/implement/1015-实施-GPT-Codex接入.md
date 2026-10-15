# GPT（Codex 套餐）接入实施记录

## 已修改文件

- APP `shared/models/settings_model.js`：增加 GPT（Codex 套餐），值 codex-gpt。
- APP `models/model-config.js`、`server/http/ai-routes.js`、`server/http/llm-server/params.js`：制作请求走本地 textBaseUrl 与 llmServerClient，不发送媒体网关密钥。
- APP `server/prompts/providers.js`、`render.js`：固定约束使用 developer，任务与意见置前、背景 JSON 置后；修订仍使用真实 assistant 基稿，其他模型编排保持原样。
- APP `server/host/harness-chat-model.js`：选择 Codex 制作模型时保留 Harness 工具会话原配置。
- llm-server `src/codex-client.js`：官方 JSON-RPC App Server 子进程，ChatGPT 登录校验、默认可用模型、临时只读工作目录与 ephemeral 会话、真实历史注入、最终文本提取、取消与进程清理。
- llm-server `src/server.js`、`index.js`：codex-gpt 分流并复用并发 1 队列、60分钟超时、断连及 stop 取消。Ollama 不可用不影响 Codex 请求。
- 新增两仓库 Codex 测试，更新 UI 设置选项和设置 API 集成测试，更新 README、环境示例、工作流及开发指引。

## 验收

| AC | 结果 | 证据 |
|---|---|---|
| AC1 设置与路由 | 通过 | DOM 选择、保存及重绘恢复；设置 API → TaskService → HTTP 集成测试通过 |
| AC2 提示词 | 通过 | developer/user 与 developer/user/assistant/user 断言；真实修订保留姓名仅修改动作 |
| AC3 订阅连接 | 通过 | account/read 为 chatgpt；实际默认 gpt-6-astra；简短调用返回 OK；模拟 API Key 登录被拒绝 |
| AC4 取消与超时 | 通过 | 取消 turn/interrupt、SIGTERM 清理；HTTP 断连、超时、停止后下个排队请求成功 |
| AC5 实际节点联调 | 通过 | 临时端口且 Ollama 指向不可用端口，项目摘要 generate 和 regenerate 均 HTTP 200 |

## 实际结果

- 摘要生成：阿明在院子里丢失钥匙，沿来路寻找，最终在门边找回。
- 原结果修订：阿明沿来路寻找丢失的钥匙，最终在门边找回。
- 独立 JSON 修订：姓名“林峥”保持不变，action 从“推门”改为“救人”。
- 本机实际协议方法为 `thread/inject_items`；经真实调用验证，使用该方法而非推测的驼峰名称。

## 回归

- APP 基线 429/428通过/1失败；本轮 431/430通过/1失败，cancelled=0。唯一失败仍为基线“恢复组合failed时旧失败组不再提示继续”，没有新增失败。
- llm-server 基线24全通过；本轮31全通过，cancelled=0。
- 两仓库 git diff --check 通过。
- GitNexus detect_changes 完整返回13个符号、4条受影响流程、medium；索引已更新。

## 部署状态

仅代码与隔离联调完成；未重启生产 llm-server、未重启 Harness、未刷新项目页面、未切换生产设置或修改生产项目数据。正常重启 llm-server（npm start，无需GPU）与 Harness，并重新加载设置页后可选择 GPT（Codex 套餐）。Codex 可执行文件须在服务 PATH 内，或通过 CODEX_BIN 指定；沿用本机 ChatGPT 登录，不提取或转存令牌。
