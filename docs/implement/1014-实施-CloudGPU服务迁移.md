# CloudGPU 服务迁移实施记录

## 已修改文件

本项目：
- `src/server.js`：独立 HTTP，迁入 Qwen 默认参数，支持模型列表、普通/SSE/工具响应透传、超时、断连取消、请求校验。
- `src/index.js`：环境配置、监听和退出处理。
- `scripts/start-cloudgpu.sh`：创建 SSH 隧道、等待 Ollama 就绪、启动 HTTP、失败与退出时清理本脚本子进程。
- `package.json`、`.env.example`、`.gitignore`、`README.md`：无第三方依赖的启动入口、配置样例及接入说明。
- `tests/server.test.js`、`tests/start-cloudgpu.test.js`：HTTP 协议与 SSH 生命周期测试。

源项目 `../llm-dsh-plugins`：
- `meiji/server/gateway/model-gateway.js`：删除已迁走的 Qwen 参数分支，保留通用请求、业务重试与结果校验。
- `meiji/tests/stage01-qwen.test.js`、`meiji/tests/stage12-settings.test.js`：改为验证客户端不再填部署参数。
- `meiji/README.md`、`.agents/meiji-dev.md`：说明服务归属和调用方式。
- 同名计划/实施文档：记录迁移范围及验证结果。

所有编辑基于原工作树，不覆盖或 stash 既存修改。未修改远端部署和用户持久化数据。

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|---|---|---|
| AC-1 HTTP 接口 | 通过 | 真实本地 socket 测试 healthz、readyz、models、chat |
| AC-2 参数迁移 | 通过 | Qwen 默认值、显式覆盖、其他模型隔离、缺省不设 token 上限 |
| AC-3 响应与取消 | 通过 | SSE 首块在上游结束前到达、工具字段与 usage 保留、客户端关闭触发上游关闭、502/504/429 |
| AC-4 SSH 生命周期 | 本地验证通过；真实连接未验收 | 模拟 SSH 进程、真实 HTTP/端口、退出清理及 SSH 失败；真实地址未提供 |
| AC-5 Meiji 接入 | 通过 | 344 项插件回归及真实 completeChat → llm-server → 模拟 Ollama 跨项目集成 |

## 测试
- 源插件基线：344 通过、0 失败、0 cancelled。
- 初次插件回归：343 通过、1 失败、0 cancelled；失败来自设置测试仍断言旧客户端部署参数，已同步。
- 最终源插件：344 通过、0 失败、0 cancelled。
- 新服务：11 通过、0 失败、0 cancelled。
- 跨项目集成：`node /tmp/llm-server-integration.mjs` 通过，调用真实源插件 completeChat，断言上游 Qwen 参数和最终正文。
- `bash -n scripts/start-cloudgpu.sh`、源仓库 `git diff --check` 通过。
- 图谱：编辑前刷新索引；completeChat impact LOW（runtime.chat、基础测试）。测试文件 impact UNKNOWN，由 npm 通配入口及实际执行补证。
- detect-changes(scope=all)：78 个符号、57 条流程、33 个已跟踪文件，整体 critical；包含任务开始前及并行产生的工作树改动，不全属于本次迁移。完整返回 78 个 changed_symbols；没有 partial/truncated 标记。本次生产代码改动仅 completeChat 参数分支。

## 人工待办
在 `.env` 填入 CloudGPU 控制台 SSH 地址和端口，并确保系统 SSH 密钥可登录；执行 `npm run start:cloudgpu`，检查 `/readyz` 和真实聊天。当前无 CloudGPU 登录地址，未执行真实远端推理，也未宣称远端连接成功。

最终检查：新项目 11 个文件空白检查通过；源仓库 diff --check 通过。图谱刷新成功（3845 节点、11969 关系、251 流程）；索引器报告流程提取预算截断，未将缺失流程视为无影响，实际调用以源码与跨项目集成测试补证。
