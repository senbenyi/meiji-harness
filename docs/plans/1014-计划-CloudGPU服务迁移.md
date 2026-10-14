# CloudGPU 服务迁移

- 类型：重构与独立服务入口
- 目标：llm-server 提供 HTTP API，经 SSH 连接 CloudGPU Ollama；Meiji 仅作为 HTTP 客户端。
- 非目标：迁移短剧业务、图片视频网关、修改远端权重或用户数据。

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 状态 | 依据 |
|---|---|---|---|
| AC-1 | 启动本项目 → 11435 提供 /v1/models、/v1/chat/completions | 本地验证通过 | 源仓库只有 HTTP 客户端，没有 SSH/独立 HTTP 入口 |
| AC-2 | Qwen 请求 → 服务端补齐原默认参数；显式参数保留，未设 token 上限时不添加 | 本地验证通过 | meiji/server/gateway/model-gateway.js:completeChat |
| AC-3 | 普通/流式/工具调用 → 保留上游内容，断连取消上游，错误明确返回 | 本地验证通过 | 原宿主使用 OpenAI compatible provider |
| AC-4 | SSH 启动 → 本地独立端口转发 CloudGPU，失败退出并清理子进程 | 本地验证通过 | 历史接入文档说明本机 SSH 转发；未发现实际启动脚本 |
| AC-5 | Meiji 文本调用 → 使用本服务；媒体、业务流程不变 | 本地验证通过 | textBaseUrl 已为 http://127.0.0.1:11435/v1 |

## 调用链与证据
旧链路：Meiji completeChat / Harness provider → 11435 SSH 转发 → CloudGPU Ollama。
新链路：Meiji / 其他客户端 → llm-server HTTP → 11436 SSH 转发 → CloudGPU Ollama 11434。
源仓库有大量既存未提交修改，采用工作树现状上的最小编辑。目标目录原为空且没有 Git。

## 改动
1. src/server.js、src/index.js、package.json：独立 OpenAI compatible HTTP 服务，Qwen 默认参数、流式转发、超时与取消 → AC-1/2/3。
2. scripts/start-cloudgpu.sh、.env.example、README.md：SSH 连接配置、启动与退出管理 → AC-4。
3. 源 meiji/server/gateway/model-gateway.js：删除迁走的 Qwen 默认参数；测试和说明同步，保留模型选择与客户端能力描述 → AC-2/5。
4. tests：真实本地 HTTP mock 集成测试、源插件回归 → AC-1～5。

## 待用户提供
CloudGPU SSH 地址/别名。实现和本地测试不依赖此信息；真实连接验收需要。

## 验证结果
本地实现验收完成：新服务 11/11、插件 344/344、跨项目 HTTP 集成与 shell 语法检查通过。真实 CloudGPU 连接未验收：缺少 SSH 登录信息。详见对应实施记录。

图谱：索引已刷新；completeChat 上游为 runtime.chat 和基础测试，风险 LOW；Qwen 测试文件 UNKNOWN，已从 package.json 确认 npm test 动态加载 tests/*.test.js。插件基线 344 通过、0 失败、0 cancelled。

回归补充：stage12-settings.test.js 的旧参数断言需同步迁移；图谱为 UNKNOWN，package.json 通配测试入口和实际失败日志确认调用。服务 9 项通过；插件初次回归 343 通过、1 失败，原因为该旧断言。
