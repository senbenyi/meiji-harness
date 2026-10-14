# Meiji

DeepSeek Harness 短剧制作插件。按项目 Model 保存剧本、角色与服装、分集剧情及镜头制作资源；会话和右侧面板使用同一任务服务。

创建项目选择自由创作或剧本模式。自由创作需要用户提供方向；剧本模式需要完整剧本。新增剧集填写时长与本集要求，之后可以编辑。制作从提取剧集开始：一边提取人物资料，再从各人物卡按全部服装生成定妆照（首套作为默认角色图），一边按故事大纲、镜头表、逐镜制作到合片。逐镜顺序是角色与服装识别、每秒分镜、文生视频提示词，再按类型决定是否编排首尾帧或多模态提示词，然后生成视频；尾帧在视频任务里截取，只有首尾帧类型用上一镜尾帧开场。项目摘要和剧集摘要不挡住这条路径。前置不足会记录具体失败原因，不自动补上游。

每个文本任务完成生成、程序审核、AI 审核，并按该节点的重试轮次修订。程序审核未通过同样带意见进入修订；用尽后才进入未通过。时长误差由程序审核按该节点的误差时长判定。人工编辑与人工放行不调用 AI。节点显示未生成、生成中、已生成、未通过、失败、已取消、已过期；状态与原因直接来自持久化 Model。排队中只出现在任务和任务组上，不写入节点。上游变化保留旧资源并标记过期。输出语言、画幅、角色声音和默认服装的修改只影响后续步骤。

同一项目串行执行。任务完成后自动下一项；失败、未通过或取消后停止。排队项可从面板开始或移除。组合任务包括本集每秒分镜与成片，继续操作创建新组和新任务，旧终态历史保持不变。会话关闭不会取消制作；程序通知可被模型读取，但不授权模型自主修复或继续。

面板保留项目概要、角色与服装、设置、任务记录和素材库，以及剧情、镜头表、成片、合成四个剧集标签。人物资料在项目角色区维护；镜头表直接参考项目人物库。内部 ID 由程序生成，资料使用编号；未建卡说话人和独立旁白保留名称。

项目与任务历史保存在 `$DSH_HOME/storages/meiji/meiji.sqlite`（默认 `~/.dsh/storages/meiji/meiji.sqlite`）。使用 Node 内置 `node:sqlite`，运行要求 Node ^22.19.0 或 >=24；无需安装独立数据库服务。任务组 `task_groups` → 任务 `tasks` → 步骤 `task_steps` 通过外键关联；项目、幂等请求和通知同事务提交，启用 WAL、外键与 FULL 同步。媒体和独立素材仍保存为文件。

本次切换按用户要求清空旧项目及任务历史，不迁移。当前 schema v9，旧版本明确拒绝，不提供迁移。数据库首次启动自动建表；检测到尚未清理的 CURRENT 分代项目会拒绝启用，防止混用。数据库启用后只读写 SQLite，`projects/<p_UUID>/` 仅作为工作区目录。

备份运行中的 SQLite 应使用 SQLite 备份接口，或停服并关闭连接后复制数据库；不要只复制运行中的主文件而遗漏 WAL。

图片和视频沿用现有网关协议，尾帧和合片使用 FFmpeg，所有产物在保存前校验。停止视频任务只停止本地等待，网关不提供远端取消接口。不要同时运行多个写入同一 DSH_HOME 的实例。

设置页提供「语言」和「模型」卡片，选择后自动保存，不绑定当前项目。语言和模型只作用于之后的生成，不改写已有内容。文本可选 `elysium-chat` 或「Qwen3.5 27B」（本地 HTTP `qwen3.5:27b`），聊天与制作文本共同读取 `SettingsModel` 的文本选择。图片、视频选项名分别为 `elysium-image`、`elysium-video`。界面不再编辑地址、密钥或自由模型名。

连接配置仍在 `$DSH_HOME/storages/meiji/models.json`：`baseUrl/apiKey` 为网关，`textBaseUrl` 为独立 [llm-server](../../llm-server/README.md) 的 HTTP 接口（默认 `http://127.0.0.1:11435/v1`，由该服务管理 SSH 隧道并连接 CloudGPU Ollama）。本地请求仅使用占位密钥 `ollama`。`text/image/video.model` 为设置 Model 的唯一选择来源；旧 `chat/story` 已移除。已有配置执行 `node meiji/scripts/migrate-settings-model.js`（可传 DSH_HOME 路径）后重启：先备份，保留地址、密钥、并发配置及当前文本选择；不更改项目数据。未知模型配置迁移时直接报错，需明确修正，不作运行时兜底。

隧道中断后可运行 `ssh -fN -L 127.0.0.1:11435:127.0.0.1:11434 -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -p 24520 root@js4.blockelite.cn`，在终端输入实例密码；密码不保存在项目内。实例地址改变时需同步 SSH 连接参数。

提示词遵循 [Qwen3.5 官方说明](https://huggingface.co/Qwen/Qwen3.5-27B)：标准 system/user 消息，system 保存角色、规则和输出格式，user 保存任务与资料；只把最终正文用于后续任务，不回填思考过程。文本公共约定限定资料用途和最终输出，节点 PromptModel 定义角色和动作要求，节点路由契约统一定义输入和输出格式。选择 Qwen 时，制作文本采用非思考通用参数 `temperature=0.7`、`top_p=0.8`、`presence_penalty=1.5`，按 [Ollama 协议](https://docs.ollama.com/api/openai-compatibility) 用 `reasoning_effort=none` 关闭思考，不拼接 `/nothink` 或聊天模板特殊标记。未向 OpenAI 兼容接口发送未声明的 top_k/min_p；聊天采样由宿主处理。应用不发送 `max_tokens`，聊天配置不设置 `maxTokens`；当前服务配置 `num_predict=-1`，生成至结束。服务实际上下文已调整为 32768 tokens，并同步聊天配置；上下文容量仍有限，这不是无限长度或模型理论最大容量。后续扩大窗口需先调整服务器 `num_ctx` 并验证显存可用，不能只提高客户端声明。

在本目录执行 `npm test`；阶段测试文件以 stageNN 命名。开发规则、模块边界、存储和接口见 [开发指引](../.agents/meiji-dev.md)，重构完成及真实走查证据见 [实施记录](../docs/implement/1010-实施-分阶段开发总纲.md)。

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

无补充需求时 `requirements` 传空字符串。生成摘要返回 `{ "result": "摘要正文" }`；审核增加 `content` 与 `opinion`，返回 `{ "result": { "是否通过": true, "原因": "" } }`；按意见重新生成也增加 `content` 与 `opinion`。其他节点的完整参数见 [节点路由定义](server/http/nodes/)，图片/视频返回 `result.data`（Base64）与 `result.mime`。

路由只返回候选，不提交正式项目或创建任务。现有面板仍通过任务命令执行前置检查、审核、修订和项目事务。任务 Handler 与 HTTP 路由调用同一个节点执行函数，避免服务内部再发 HTTP。

运行时每次读取当前选择的模型一次；`elysium-chat` 和 `qwen3.5:27b` 分别使用 `server/http/elysium/`、`server/http/llm-server/` 的单例与参数组装。PromptModel 不持有输出格式，提示词和响应校验共同引用路由输出契约。请求历史保留当次业务输入、模型、提示词及脱敏 HTTP 记录。

### HTTP 阶段契约（2026-10-14）

目前注册 11 个 AI 节点、30 个动作。`shot-characters` 支持生成/审核/修订：输入 `language/requirements/shot/characters/previous`，人物目录包含 `number/name/costumes`，服装目录包含 `number/name`；结果为 `{"on_screen_characters":[{"character_number":"C1","costume_number":"C1F1"}]}`。无出镜人物返回空数组；无服装目录时服装编号为空。服务检查编号归属与重复。审核/修订额外传 `content/opinion`。正式任务已接入统一执行链；编号映射为项目 ID，保存到 `character_binding`，以 `has_result` 区分未识别与确认无人。

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

| type | 额外业务参数 | 发送的素材字段 |
|---|---|---|
| 文生 | 无 | 无 |
| 首尾帧 | `firstFrame`：上一镜尾帧 data URL 或裸 Base64 | `input_reference` |
| 多模态 | `referenceImages`：1–9 张 PNG/JPEG/WebP data URL | `reference_images` |

非当前类型的素材字段必须省略，不能传空数组或空字符串。首尾帧在三段前加固定 0.00 秒对齐行；多模态保留三段原文。`video/regenerate` 额外传非空 `opinion`，只追加本轮意见。视频不再接收 `language/requirements/previous/referenceDescriptions`。

视频编排是纯程序函数 `server/http/video-request.js`，协议白名单在 `server/http/elysium/video-params.js`；不额外调用文本模型。HTTP 返回媒体候选不代表通过视频文件、实测时长和尾帧校验。HTTP 不选择缺图降级策略，不创建程序编排任务；任务层已接入两种程序编排与按类型依赖，并把文件校验、实测、截帧、程序审核合并到视频任务。缺定妆照时等待补图，不自动降级。视频/尾帧成对提交；失败或取消保留旧配对。

节点文件同时定义输入/输出契约及简单参数编排（`compose`），PromptModel 只保存文本/图片节点实际使用的提示内容。通用输入映射和渲染仍在 `prompts/inputs.js`、`prompts/render.js`；视频复杂编排保留在 `http/video-request.js`，不设置无执行用途的 PromptModel。
