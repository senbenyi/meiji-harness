# Meiji

DeepSeek Harness 短剧制作插件。按项目 Model 保存剧本、角色与服装、分集剧情及镜头制作资源；会话和右侧面板使用同一任务服务。

HTTP、提示词编排和设置 Model 使用仓库内 `packages` 的公共工作区包，参见[根说明](../../README.md)。公共 HTTP 包包含文本、图片和视频生成、下载及异步恢复；语言与模型选项仍由 meiji 提供，业务规则与节点契约继续由 meiji 维护。在仓库根执行 `npm ci` 安装所有依赖，公共包通过本地源码链接使用，修改包后不需要重新复制安装。

创建项目选择自由创作或剧本模式。自由创作需要用户提供方向；剧本模式需要完整剧本。新增剧集填写时长与本集要求，之后可以编辑。剧本模式导入剧本后先自动审核一次剧本（剧情是否连续、是否适合拍成视频），不适合时给出修改意见，审核通过或人工放行后才能提取剧集和人物。制作从提取剧集开始：一边提取人物资料，再从各人物卡按全部服装生成定妆照（首套作为默认角色图），一边按故事大纲、镜头表、逐镜制作到合片。逐镜顺序是角色与服装识别、每秒分镜、文生视频提示词，再按类型决定是否编排首尾帧或多模态提示词，然后生成视频；尾帧在视频任务里截取，只有首尾帧类型用上一镜尾帧开场。项目摘要和剧集摘要不挡住这条路径。前置不足会记录具体失败原因，不自动补上游。

每个文本任务完成生成、程序审核、AI 审核，并按该节点的重试轮次修订。程序审核未通过同样带意见进入修订；用尽后才进入未通过。时长误差由程序审核按该节点的误差时长判定。人工编辑与人工放行不调用 AI。节点显示未生成、生成中、已生成、未通过、失败、已取消、已过期；状态与原因直接来自持久化 Model。排队中只出现在任务和任务组上，不写入节点。上游变化保留旧资源并标记过期。输出语言、画幅、角色声音和默认服装的修改只影响后续步骤。

同一项目串行执行。任务完成后自动下一项；失败、未通过或取消后停止。排队或生成中的任务可从面板取消。组合任务包括本集每秒分镜与成片，继续操作创建新组和新任务，旧终态历史保持不变。会话关闭不会取消制作；程序通知可被模型读取，但不授权模型自主修复或继续。

面板保留项目概要、角色与服装、设置、任务记录和素材库，以及剧情、镜头表、成片、合成四个剧集标签。人物资料在项目角色区维护；镜头表直接参考项目人物库。内部 ID 由程序生成，资料使用编号；未建卡说话人和独立旁白保留名称。

项目与任务历史保存在 `$DSH_HOME/storages/meiji/meiji.sqlite`（默认 `~/.dsh/storages/meiji/meiji.sqlite`）。使用 Node 内置 `node:sqlite`，运行要求 Node ^22.19.0 或 >=24；无需安装独立数据库服务。任务组 `task_groups` → 任务 `tasks` → 步骤 `task_steps` 通过外键关联；项目、幂等请求和通知同事务提交，启用 WAL、外键与 FULL 同步。媒体和独立素材仍保存为文件。

本次切换按用户要求清空旧项目及任务历史，不迁移。当前 schema v9，旧版本明确拒绝，不提供迁移。数据库首次启动自动建表；检测到尚未清理的 CURRENT 分代项目会拒绝启用，防止混用。数据库启用后只读写 SQLite，`projects/<p_UUID>/` 仅作为工作区目录。

备份运行中的 SQLite 应使用 SQLite 备份接口，或停服并关闭连接后复制数据库；不要只复制运行中的主文件而遗漏 WAL。

图片和视频沿用现有网关协议，尾帧和合片使用 FFmpeg，所有产物在保存前校验。停止视频任务只停止本地等待，网关不提供远端取消接口。不要同时运行多个写入同一 DSH_HOME 的实例。

设置页提供「语言」和「模型」卡片，选择后自动保存，不绑定当前项目。语言和模型只作用于之后的生成，不改写已有内容。会话模型和文本模型都固定为「Qwen3.5 27B」（本地 HTTP `qwen3.5:27b`）或「GPT（Codex 套餐）」（`codex-gpt`）。会话模型默认 GPT，制作文本默认 Qwen。聊天读取会话选择，制作文本读取文本选择。图片可选「krea2 turbo V2.5」（默认，经 `textBaseUrl` 调用 llm-server `POST /v1/images/comfy`）或「GPT（Codex 套餐）」（`gpt-image`，`POST /v1/images/generations`）。两者都不使用媒体密钥。视频固定为「MiniMax H3」（`MiniMax-H3`，经 `textBaseUrl` 调用 llm-server `POST /v1/videos/generations`）。已保存的 `elysium-video` 会按 MiniMax H3 读取。界面不再编辑地址、密钥或自由模型名。

连接配置仍在 `$DSH_HOME/storages/meiji/models.json`：当前所有可选模型使用 `textBaseUrl` 连接独立 [meiji-server](../../../meiji-server/README.md)（默认 `http://127.0.0.1:11435/v1`，由服务端连接模型和供应商）。真实供应商密钥只保存在 meiji-server；meiji 无需填写媒体网关密钥，本地请求的 `ollama` 仅为协议占位值。旧 `baseUrl/apiKey` 字段保留兼容读取，不用于当前模型调用，缺省或空密钥不会阻止设置保存。`session/text/image/video.model` 为设置 Model 的选择来源；旧 `chat/story` 已移除。已有配置执行 `node projects/meiji/scripts/migrate-settings-model.js`（可传 DSH_HOME 路径）后重启：先备份，保留既有连接字段、并发配置及当前文本选择，缺省的会话模型写成 GPT；不更改项目数据。未知模型配置迁移时直接报错，需明确修正，不作运行时兜底。

隧道中断后可运行 `ssh -fN -L 127.0.0.1:11435:127.0.0.1:11434 -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -p 24520 root@js4.blockelite.cn`，在终端输入实例密码；密码不保存在项目内。实例地址改变时需同步 SSH 连接参数。

提示词遵循 [Qwen3.5 官方说明](https://huggingface.co/Qwen/Qwen3.5-27B)：标准 system/user 消息，system 保存角色、规则和输出格式，user 保存任务与资料；只把最终正文用于后续任务，不回填思考过程。文本公共约定限定资料用途和最终输出，节点 PromptModel 定义角色和动作要求，节点路由契约统一定义输入和输出格式。选择 Qwen 时，制作文本采用非思考通用参数 `temperature=0.7`、`top_p=0.8`、`presence_penalty=1.5`，按 [Ollama 协议](https://docs.ollama.com/api/openai-compatibility) 用 `reasoning_effort=none` 关闭思考，不拼接 `/nothink` 或聊天模板特殊标记。未向 OpenAI 兼容接口发送未声明的 top_k/min_p；聊天采样由宿主处理。应用不发送 `max_tokens`，聊天配置不设置 `maxTokens`；当前服务配置 `num_predict=-1`，生成至结束。服务实际上下文已调整为 32768 tokens，并同步聊天配置；上下文容量仍有限，这不是无限长度或模型理论最大容量。后续扩大窗口需先调整服务器 `num_ctx` 并验证显存可用，不能只提高客户端声明。

在仓库根执行 `npm test --workspace @meiji/harness-plugin`，或在本目录执行 `npm test`。测试按功能维护。开发规则、模块边界、存储和接口见 [开发指引](.agents/meiji-dev.md)，重构完成及真实走查证据见 [HTTP与编排提取记录](../../docs/implement/1020-实施-HTTP与提示词编排提取.md)。

聊天取消默认输出上限还依赖本工作区 Harness 的 `packages/llm/llm-pi-ai/src/adapter.ts` 修复：部署到其他环境时需一并同步，避免底层 SDK 自动补入上限。

## AI 节点接口

所有模型共用 `POST /api/meiji/ai/<node>/<action>?session_id=...&project_id=...`。沿用登录、`X-Meiji-Request: 1`、同源和会话项目绑定检查。`action` 为 `generate`、`review`、`regenerate`；没有 AI 审核的节点不提供 `review`。

例如 `project-summary/generate` 正文只传：

```json
{
  "script": "完整剧本",
  "language": "zh-CN",
  "requirements": "补充需求"
}
```

无补充需求时 `requirements` 传空字符串。生成摘要返回 `{ "result": "摘要正文" }`；审核增加 `content` 与 `opinion`，返回 `{ "result": { "是否通过": true, "原因": "" } }`；按意见重新生成也增加 `content` 与 `opinion`。其他节点的完整参数见 [节点路由定义](server/http/nodes)，图片/视频返回 `result.data`（Base64）与 `result.mime`。

路由只返回候选，不提交正式项目或创建任务。现有面板仍通过任务命令执行前置检查、审核、修订和项目事务。任务 Handler 与 HTTP 路由调用同一个节点执行函数，避免服务内部再发 HTTP。

运行时每次读取当前选择的模型一次；`qwen3.5:27b` 与 `codex-gpt` 都使用 `server/http/llm-server/` 的单例与参数组装，`server/http/elysium/` 文本客户端已不在设置选项中。PromptModel 不持有输出格式，提示词和响应校验共同引用路由输出契约。请求历史保留当次业务输入、模型、提示词及脱敏 HTTP 记录。

### HTTP 阶段契约（2026-10-16）

AI节点和审核动作以 `shared/node-definitions.js` 与 `server/http/nodes/` 为准。`script-split` 生成全集规划并执行程序及AI审核；`script-review` 为可选全文改编与审核，在剧本详情按本次意见改编并自动审核，或只审核当前正文。改编补充规则独立保存在 `script.adaptation_rules`，规划补充规则保存在 `script.rules`；基础规则统一由代码维护，base字段只保留快照，不提供界面编辑或同步。已退役 `shot-characters`，人物和服装绑定直接由镜头表的 `on_screen_characters[].character_id/costume_id` 保存，不再使用角色编号或 `character_binding`。不具名群演保存到 `background_characters`；卡内人物 ID 及其服装归属由程序校验。

`storyboard` 的输入为 `language/requirements/storyboard/duration/characters`，审核/修订增加 `content/opinion`。人物只传所需文字资料，包含仅发声人物；不再接收 `assets/previous`。输出仍为固定三个非空段落。`costume-image.references` 最多一张图。

`video/generate` 的最小输入：

```json
{
  "type": "文生",
  "textPrompt": {
    "integrated_multimodal_description": "A woman opens the door.",
    "overall_soundscape": "Wind.",
    "non_diegetic_music": "None."
  },
  "duration": 5,
  "aspectRatio": "16:9"
}
```

`textPrompt` 也可为三段正文字符串，原文保留。`duration` 必须为 4–15 的整数秒。

| type | 额外业务参数 | 发给 MiniMax H3 的字段 |
|---|---|---|
| 文生 | 无 | `mode` 为 `文生`，`ratio` 由项目画幅决定 |
| 首尾帧 | `firstFrame`：上一镜尾帧 data URL | `mode` 为 `首尾帧`，`first_frame`；不传 `ratio` |
| 多模态 | `referenceImages`：1–9 张 PNG/JPEG/WebP data URL | `mode` 为 `多模态`，`images`；`ratio` 由项目画幅决定 |

非当前类型的素材字段必须省略，不能传空数组或空字符串。首尾帧在三段前加固定 0.00 秒对齐行；多模态保留三段原文。`video/regenerate` 额外传非空 `opinion`，只追加本轮意见。视频不再接收 `language/requirements/previous/referenceDescriptions`。

视频编排是纯程序函数 `server/http/video-request.js`，协议白名单在公共包 `packages/http-client/src/llm-server/params.js`（`@agent-modules/http-client/model-parameters`）；不额外调用文本模型。HTTP 返回媒体候选不代表通过视频文件、实测时长和尾帧校验。HTTP 不选择缺图降级策略，不创建程序编排任务；任务层已接入两种程序编排与按类型依赖，并把文件校验、实测、截帧、程序审核合并到视频任务。缺定妆照时等待补图，不自动降级。视频/尾帧成对提交；失败或取消保留旧配对。

节点文件同时定义输入/输出契约及简单参数编排（`compose`），PromptModel 只保存文本/图片节点实际使用的提示内容。通用输入映射和渲染仍在 `prompts/inputs.js`、`prompts/render.js`；视频复杂编排保留在 `http/video-request.js`，不设置无执行用途的 PromptModel。
