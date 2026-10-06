# MiniMax H3 分镜对白与视频原生音频修复计划

状态：待确认；尚未修改业务代码。

## 目标与验收契约

生产链路为：流程 Skill 生成含对白的分镜 → Proposal 批准并保存 Shot → 编译 H3 提示词 → H3 同时生成画面和声音 → 保存带原生音轨的视频 → 拼接保留原生音轨 → 画布展示视频。

画布阶段名称为“视频”。分镜包含具体对白、说话人及声音备注，视频生成直接使用这些内容，不另设旁白生成步骤。没有对白的镜头可以有环境声；不得凭空补对白。空画布及空步骤继续保持空白。

## 已确认的证据

- 当前本机配置的两个活动视频能力分别指向 `elysium-minimax-h3-ref2v` 和 `elysium-minimax-h3-i2v`。
- 两个工作流均声明 `output.hasAudio: true`，图中 `VAEDecodeAudio` 的输出进入 `CreateVideo.audio`，再经 `SaveVideo` 保存视频。
- `lib/script/contracts.js` 已归一化 `audioDialogue`、`audioNotes`；`lib/domain/commands/index.js` 批准正式剧本时保存这些字段，存储无需另造一套对白数据。
- `lib/index.js` 整书写作 schema 的上述字段可选，写作指令只要求描述与 prompt，缺少明确的逐镜对白契约。
- `lib/prompts/compiler.js` 编译时只读取 prompt，遗漏 `audioDialogue`、`audioNotes`；r2v、i2v 均已只读复现对白和声音备注丢失。
- `lib/index.js` 的实际 `runRender` 会调用这个编译器，批量任务的 `nodeId` 也对应正式 Shot；不是仅预览工具的问题。
- `lib/domain/read-models.js` 分镜投影只展示 `shot.prompt`，未展示保存的对白和声音备注。
- `studio/stages.js` 名称为“视频与旁白”，把独立 audio 和旁白文本也归入 media。
- 正式 Project 音频策略默认 native，但兼容画布默认 silent，设置工具也缺少 native 值；展示默认值仍是 silent。
- `lib/concat.js` 已保留并拼接音轨，重定时同步处理音频；现有相关测试可用。
- 上一轮已确认 web profile 使用安装副本，实施后必须同步实际安装文件并验证，不能只验证仓库源码。

## 计划修改

| 文件与职责 | 具体修改 |
| --- | --- |
| `lib/index.js`：生产编排、渲染和画布设置入口 | 写作 schema 要求逐镜 `audioDialogue`、`audioNotes`（无对白时显式为空），写作指令要求原文对白及说话人并说明由 H3 原生生成声音；兼容画布默认及设置接口支持 native。核对批量任务传入的 Shot 对白能进入实际生成图。 |
| `lib/prompts/compiler.js`：最终提示词编译 | 接入已保存的 `audioDialogue`、`audioNotes`，在 r2v 与 i2v 的正确描述、声景段落里表达原文对白、说话人和声音要求；对白按 H3 `<d>` 规则表达。已结构化 prompt 同样核对对白，不因提前返回遗漏，不重复注入已有对白。 |
| `lib/domain/read-models.js`：画布领域投影 | 分镜展示保存的画面描述、对白和声音备注，携带明确的阶段信息，避免“对白”等关键词把分镜误归入视频。 |
| `studio/stages.js`：画布阶段分类 | 将“视频与旁白”改为“视频”，优先使用明确阶段信息；视频产物归入视频，独立音频不再计入视频产物。保留已有材料，不删除节点。 |
| `studio/app.js`：画布展示 | 音频策略展示与 native 默认一致，分镜对白在对应阶段可见，空步骤继续不生成占位内容。 |
| `skills/elysium-generate-drama/SKILL.md`：短剧流程 | 明确逐镜对白与说话人写入现有字段，声音由视频原生生成，不增加独立旁白步骤。 |
| `skills/elysium-generate-video-3d/SKILL.md`、`skills/elysium-generate-video-brand/SKILL.md`：动画与品牌片流程 | 将相同原生音频契约落实到分镜、视频生成与交付；用户明确要求静音时保留其创作意图。 |
| `skills/elysium-generate-minimax-h3/references/studio-mapping.md`：H3 映射规则 | 明确现有对白与声音备注字段在 r2v、i2v 提示词中的位置及说话人绑定。 |
| `studio/index.html`：画布资源加载 | 更新资源版本号，确保同步后的浏览器重新加载修改过的脚本和阶段模块。 |
| `tests/domain/prompt-compiler.test.js`、`tests/domain/script-development.test.js`、`tests/studio/canvas-stages.test.js` 与必要的实际渲染路径测试 | 增加回归验证：批准后对白留存、r2v/i2v 最终 prompt 不丢对白、结构化 prompt 不重复或遗漏、分镜分类正确、视频阶段只计视频。 |

实现时只修改上述断点及直接调用方；工作流原生音频图和拼接逻辑若验证通过，不为此重写。具体编译行为先用回归测试固定，再做最小修改。

## 验证方式

1. 复用本次复现样例：分镜画面为小狐狸仰望星空，对白为“小狐狸：我要当宇航员！”，声音备注为“童声，兴奋；风声很轻”；批准、保存、读取、预览、实际渲染图都必须保留对白和声音要求。
2. 覆盖 r2v、i2v、已结构化 prompt、有对白、无对白和明确静音意图；仅编译提示词不能被报告为真实生成成功。
3. 验证两个活动 H3 工作流各档位均保留音频生成到视频保存的连接。
4. 用本地带音轨 MP4 执行真实拼接及媒体探测，确认输入和输出都存在音轨；复用现有 concat 测试。
5. 用 Chrome 检查仓库源码和安装副本：视频阶段名称、视频分类、分镜对白展示、已有产物、全部空步骤。
6. 执行相关领域、渲染、画布和拼接回归，再运行项目测试与完整 smoke；进行语法及 `git diff --check` 检查。
7. 同步 web profile 插件的本次改动文件及安装 Skill，核对文件内容和 Skill 清单/hash；保留现有未提交改动和项目产物，不清理或重跑历史项目。
8. 远端 H3 实际生成结果单独记录。若没有执行真实生成，最终报告明确未验证语音内容与口型，不把 mock、图连接检查或本地拼接称为远端生成验证。

## 实施边界

用户提供的 AGENTS.md 第 1 节要求跨模块或架构修改先输出文件、改动和验证计划并等待确认。本次同时涉及生产指令、提示词编译、领域投影、画布和安装副本，故当前停在计划确认；没有修改上述业务文件，也没有提交远端生成任务。
