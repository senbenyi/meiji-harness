# Meiji 本地千问接入实施记录

## 已修改文件
- `meiji/config/models.json`、`meiji/models/model-config.js` — 聊天/剧情使用独立 textBaseUrl 与 qwen3.5:27b，媒体仍使用原网关。
- `meiji/server/runtime/app-runtime.js`、`meiji/server/host/harness-chat-model.js`、`meiji/index.js` — 文本路由及宿主聊天同步，非思考模式，实际上下文 32768，不设置输出 maxTokens。
- `meiji/server/gateway/model-gateway.js` — 标准消息、Qwen 非思考采样参数，不发送 max_tokens，仅消费最终正文。
- `meiji/server/prompts/yaml-prompts.js` — 文本提示词追加资料边界与最终结果约定，媒体渲染保持原样。
- `meiji/client/workbench.js` — 独立语言模型地址、媒体地址与密钥设置。
- `meiji/scripts/migrate-qwen-models.js` — 显式备份和迁移已有模型配置，保留媒体及其他设置。
- `meiji/tests/stage01-foundations.test.js`、`meiji/tests/stage01-qwen.test.js`、`meiji/tests/stage08-cleanup.test.js` — 协议、配置、迁移、宿主同步、文本生成/拒绝/修订/审核，以及迁移脚本不进入运行时的验证。
- `meiji/README.md`、`.agents/meiji-dev.md`、对应计划 — 接入、迁移、官方依据、服务容量与验证记录。
- `../deepseek-harness/packages/llm/llm-pi-ai/src/adapter.ts` — 用户授权例外：OpenAI Chat Completions 未显式指定上限时，通过 SDK onPayload 移除自动产生的输出限制；保留显式限制和其他协议。
- 同包 `tests/adapter.spec.ts`、`tests/loader-composition.spec.ts`、`README.md`、`README.zh.md`、`README.i18n.yaml` — 实际 HTTP/Loader 回归测试与双语说明。

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|---|---|---|
| AC-1 所有 Meiji 文本调用千问 | 通过 | 默认值、运行配置、隔离真实 TaskService、浏览器设置均使用 qwen3.5:27b 与本机 11435 隧道 |
| AC-2 消息与提示词符合部署协议 | 通过 | 23 个文本模板测试，生成/审核/修订走标准 system/user；真实 JSON 审核和工具调用成功，不消费 reasoning |
| AC-3 媒体不变 | 通过 | 运行配置五组字段与迁移备份 deepEqual；六个媒体渲染结果与 HEAD deepEqual；媒体协议及 ffmpeg 测试通过 |
| AC-4 配置和宿主一致、取消输出上限 | 通过 | 设置往返测试、真实聊天 HTTP 不含两种 max token 字段、num_predict=-1、驻留上下文 32768；重启后的 UI 显示正确模型 |
| AC-5 验证无新增失败 | 通过 | Meiji 295/295；Harness 61/61；真实摘要、审核、工具调用及 9046-token 输入成功 |

## 测试
- Meiji：基线 290 通过、0 失败、0 cancelled；最终 `npm test` 295 通过、0 失败、0 cancelled。
- Harness：adapter/sdk-options 基线 55 通过；修复后 adapter/sdk-options/loader-composition 共 61 通过、0 失败，无取消报告。新增两个测试覆盖 max_tokens/max_completion_tokens 缺省省略和显式限制保留。
- `pnpm exec tsc -b packages/llm/llm-pi-ai/tsconfig.json --pretty false`、相关三个 TypeScript 文件 oxlint、中英文配对检查通过。
- 真实长输入返回 `prompt_tokens=9046`、`completion_tokens=5`、`finish_reason=stop`；服务 `/api/ps` 显示 `context_length=32768`、显存约 18.64 GB。上下文仍是有限容量。
- 真实宿主请求返回 connection_test 工具调用，参数为 status=ok；抓取到的请求不含 max_tokens/max_completion_tokens，reasoning_effort=none。
- 两个仓库 `git diff --check` 通过。GitNexus 差异分析完整，公共提示词 CRITICAL 影响已由媒体渲染不变对比和全量 Meiji 测试覆盖；索引已更新。
- 未运行 Harness 全仓库测试；未触发真实付费图片/视频生成；不更改用户已有失败任务的历史状态。

## 运行环境改动
- 已备份并迁移 `~/.dsh/storages/meiji/models.json`，媒体配置完全保留。
- Ollama 同一模型的权重和模板保留，更新 `num_ctx=32768`、`num_predict=-1`；调整前模型元数据备份在 `/tmp/meiji-qwen-before-context.json`。
- 本机 SSH 转发连接现有 V100 服务；当前 Harness 已重启加载修复。凭据未写入仓库。

## 人工待办
无。以后将项目迁移到另一环境时，需要同时同步本次 Harness 修复并建立 README 中的 SSH 转发。
