# Meiji 本地千问接入

- 类型：重构
- 目标：Meiji 聊天与全部制作文本请求调用现有本机 SSH 转发的 Qwen3.5 27B，按官方消息协议与输出约定组织提示词。
- 非目标：重新部署模型、更换图片/视频服务、修改节点业务结构、删除用户项目。用户随后明确授权本次修复 Harness 默认输出上限。

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 已确认/未确认/未验收 | 依据或缺口 |
|---|---|---|---|
| AC-1 | 默认及当前运行配置 → chat/story 均使用 http://127.0.0.1:11435/v1 和 qwen3.5:27b | 已验收 | config/models.json、models/model-config.js；实施前运行 models.json 为 elysium-chat；已迁移 |
| AC-2 | 文本生成/审核/修订 → 标准 system/user 消息、明确输出约束、仅消费最终正文 | 已验收 | text-handler.js:87、model-gateway.js:217、yaml-prompts.js:55；所有制作文本经过 completeChat |
| AC-3 | 图片/视频请求与提示词 → 地址、密钥、模型、请求协议、渲染正文保持原样 | 已验收 | app-runtime.js:39 的共享路由目前共用媒体网关，必须拆出文本地址 |
| AC-4 | 设置读写与聊天同步 → 独立文本地址持久化，聊天不依赖媒体密钥且容量与调整后的实际 32768 一致 | 已验收 | workbench.js:217、task-routes.js:175、harness-chat-model.js:2、index.js:30 |
| AC-5 | 当前服务真实请求 → 文本生成、JSON 审核及工具调用可用，相关全量测试无新增失败 | 已验收 | 基线 290 通过、0 失败、0 cancelled；真实服务 reasoning_effort=none 已返回有效 JSON |

## 调用链与证据
面板/会话 → TaskService → createTextHandler → YAML 渲染 → runtime gateway.chat → completeChat → Ollama /v1/chat/completions。
聊天入口为 index.apply → syncChatModel → Harness 公开 settings/credentials → OpenAI-compatible provider。
媒体入口为 createMediaHandler → 同一 runtime 的 image/submitVideo/retrieveVideo，保持原网关。

| 来源（文件:行） | 支持的结论 |
|---|---|
| meiji/models/model-config.js:31 | normalizeModels 把四类模型统一指向媒体网关 |
| meiji/server/runtime/app-runtime.js:39 | 制作请求按用途合并配置 |
| meiji/server/prompts/yaml-prompts.js:55 | 公共渲染器同时覆盖文本、图片、视频 |
| meiji/server/handlers/text-handler.js:87 | 生成/审核/修订共用文本消息入口 |
| Qwen 官方 https://huggingface.co/Qwen/Qwen3.5-27B | 标准 messages；不支持 /think、/nothink；非思考通用任务 temperature=0.7、top_p=0.8、presence_penalty=1.5；用提示词约束输出；历史只放最终正文 |
| Ollama 官方 https://docs.ollama.com/api/openai-compatibility | 本地 key 为占位值 ollama；reasoning_effort=none 关闭思考；上下文由模型配置决定 |
| 实施前 /api/show 与 /api/ps | 模型 qwen3.5:27b，num_ctx=8192；不冒用官方理论上下文长度 |

图谱：已执行 status 并更新索引，CLI status 为 up-to-date；MCP 缓存仍报旧提交，涉及公共提示词的影响另用 CLI 复核。normalizeModels/compactModels → HTTP 保存及插件入口（LOW）；completeChat → runtime.chat/基础测试（LOW）；syncChatModel → apply（LOW）；createAppRuntime → 插件与集成测试（MEDIUM）；renderModels 已按 UID 消歧（LOW）。renderTemplate → 文本、媒体、各节点测试，共 22 个上游（CRITICAL，已向用户说明）。apply 为 UNKNOWN，源码 cordis.patch.yml 注册插件、生命周期测试补查，不能按无调用处理。图谱流程提取存在截断，动态注入以源码补足。

## 问题
| AC | 预期 | 实际 | 根因 |
|---|---|---|---|
| AC-1/3 | 文本独立连接本机，媒体保留 | 四类共用地址与密钥 | 配置和聊天同步只支持单网关 |
| AC-4 | 容量和实际部署一致 | 聊天硬编码 65536 | 未区分具体服务容量 |

## 待用户决定
无。沿用本轮已连接的本机隧道；制作文本采用非思考模式，按用户最新要求删除 max_tokens/maxTokens 输出限制；现有剧本请求 9368 tokens 超出服务 8192，计划把服务 num_ctx 调到 32768，并设置 num_predict=-1（生成至结束）。上下文仍受模型和显存容量约束。Ollama OpenAI 接口未声明的 top_k/min_p 不盲目发送；不宣称已应用这些参数。

## 改动
### 阶段 1：文本路由和调用
1. meiji/config/models.json、models/model-config.js — 新增 textBaseUrl；chat/story 改为 qwen3.5:27b；媒体配置保留 → AC-1/3。
2. meiji/server/runtime/app-runtime.js、server/host/harness-chat-model.js、index.js — 统一解析文本独立路由，聊天使用占位密钥、实际容量和非思考配置 → AC-1/4。
3. meiji/client/workbench.js — 独立文本地址与媒体网关字段，保存新配置 → AC-4。
4. meiji/server/gateway/model-gateway.js — 文本请求使用经实测的 Ollama 非思考采样参数；继续只返回 message.content → AC-2。
5. meiji/server/prompts/yaml-prompts.js — 仅文本输出追加输入资料边界与最终输出约定，保持角色/规则/格式在 system，任务/资料在 user；媒体渲染不变 → AC-2/3。

验证：配置/HTTP/聊天同步、真实 TaskService 文本路由、生成审核修订提示词和媒体不变断言；npm test。

### 阶段 2：显式迁移和真实接入
1. meiji/scripts/migrate-qwen-models.js — 手动执行的一次性 models.json 迁移（先备份，保留媒体及其他字段，不增加运行时旧配置兜底） → AC-1/3/4。
2. meiji/tests/stage01-foundations.test.js、新增本地模型回归测试 — 覆盖消息参数、路由隔离、配置迁移、聊天同步及提示词边界 → AC-1～5。全量测试发现 stage08-cleanup 用文件名前缀禁止所有迁移脚本；改为只允许本次模型配置迁移并确认其不进入运行时依赖，继续禁止旧项目迁移。该测试 File impact 为 UNKNOWN，源码已确认由 npm test 的 tests/*.test.js 执行 → AC-1/5。
3. meiji/README.md、.agents/meiji-dev.md — 记录接入、迁移、隧道和官方依据 → AC-1/2/4。
4. 显式迁移当前 ~/.dsh/storages/meiji/models.json，确认无活动制作任务后重启现有 Harness；通过当前接口验证模型与请求 → AC-5。

验证：隔离 home 下真实摘要生成/JSON 审核及工具调用；媒体配置前后逐字段对比；git diff --check；detect-changes 对照本计划，最后集中更新索引。

### 阶段 3：取消输出 token 上限
1. model-gateway.js、harness-chat-model.js 与对应测试 — 不发送 max_tokens、不配置 maxTokens；宿主声明与实际 32768 上下文一致 → AC-2/4/5。
2. 备份远端模型元数据后，通过 Ollama /api/create 更新同一模型参数 num_ctx=32768、num_predict=-1，保留权重与模板；用超过 8192 tokens 的真实请求验证 → AC-5。

### 阶段 4：Harness 默认上限修复（用户明确授权的例外）
实际 HTTP 请求证实 pi-ai buildBaseOptions 把未提供的 maxTokens 替换为模型容量，再减去上下文预留，聊天仍发送 28670。Harness 仓库未启用 GitNexus；源码调用链为 PiAiAdapter.streamWithSnapshot → Models.streamSimple → OpenAI completions buildBaseOptions/onPayload。
1. ../deepseek-harness/packages/llm/llm-pi-ai/src/adapter.ts：使用 SDK 的 onPayload，在 OpenAI Chat Completions 无显式请求/配置上限时移除 SDK 生成的 max_tokens/max_completion_tokens，保留显式限制及其他协议 → AC-4/5。
2. 同包 tests/adapter.spec.ts、tests/loader-composition.spec.ts：真实 HTTP 验证两种 token 字段缺省省略、显式上限保留，并验证 Loader 组合 → AC-5。
3. 同包 README.md：说明未配置上限时由服务器决定生成终点 → AC-4。基线 adapter/sdk-options 共 55 通过。

## 验证结果
全部 AC 已通过，详细证据见 [实施记录](../implement/1013-实施-Meiji本地千问接入.md)。

- Meiji 基线 290 通过；最终 295 通过、0 失败、0 cancelled。
- Harness 原 adapter/sdk-options 基线 55 通过；修复后加上 Loader 组合共 61 通过、0 失败；包级 tsc、相关文件 oxlint、中英文配对检查通过。
- 当前配置已显式迁移并备份；媒体地址、密钥、模型和并发配置逐字段完全一致。六份媒体模板与 HEAD 渲染逐字段相等。
- 真实隔离 TaskService 摘要生成和 JSON 审核成功；真实 Harness 工具调用成功，HTTP 请求确认不含 max_tokens/max_completion_tokens。
- 服务 num_ctx=32768、num_predict=-1；长输入实测 prompt_tokens=9046、completion_tokens=5，finish_reason=stop，驻留模型 context_length=32768。
- 确认无排队/运行制作任务后重启，浏览器显示聊天/剧情均为 qwen3.5:27b、语言地址为本机隧道、媒体模型保持原样。
- detect-changes：35 个符号、27 条流程、12 个受跟踪文件，CRITICAL 来自公共渲染器；partial=false、truncated=false。新增迁移脚本和测试另行审查。最终索引 3433 节点、10860 关系，status up-to-date。两个仓库 git diff --check 通过。
