# 小说 → 短剧成片全链路静态审查：问题总清单

> 状态：已定稿（静态审查，未改代码、未发起任何生成）
> 基线：2026-10-06 22:02 CST，分支 `studio`，HEAD `0d496018` + 未提交工作区改动（下表哈希）；已安装宿主 `~/.dsh/profiles` 全局 pnpm 包。
> 范围：从对话里说“把 `dream/novel/10-都市寂寞少妇的生日夜·龙哥与阿秀的禁忌缠绵.md` 做成短剧”开始，经 `studio_novel_create` → 文本多 Agent → Proposal 持久化 → `studio_batch_generate` → ProductionWorker（参考图 → 分镜图 → 镜头视频 → 分集拼接 → 整剧交付）→ 画布展示。不覆盖超分、抽帧、手动单镜创作路径。
> 证据：E1 = 本机存储/本机测试实测；E2 = 当前代码执行路径；E5 = 推断。

## 审查期间代码仍在被修改（必须先读）

审查过程中检测到多个 Codex 进程正在同时改这个工作区：`read-models.js`（21:53）、`policies.js`（21:52）、`production.js`（21:54）、`drama.js`（21:57）、`SKILL.md`（21:57）、`index.js`（21:58）都在审查期间被改写，并新增了 3 个测试文件。下面所有结论对应这个快照：

| 文件 | mtime | sha256 前 12 位 |
| --- | --- | --- |
| lib/index.js | 21:58:32 | 9e343fe80f99 |
| lib/domain/policies.js | 21:52:43 | 50ecffd3d13e |
| lib/domain/commands/index.js | 21:49:04 | 7abcb03bcff5 |
| lib/domain/production.js | 21:54:31 | b4342397bad8 |
| lib/domain/read-models.js | 21:53:58 | d8067e2ff19f |
| lib/production/drama.js | 21:57:22 | 189c81e2da72 |
| lib/production/worker.js | 19:58:02 | a157ed76033b |
| lib/script/novel-production.js | 21:48:07 | 4ba593b88486 |
| lib/script/contracts.js | 19:57:57 | 00f24ac42989 |
| lib/script/tools.js | 19:58:02 | 9f67a092fc96 |
| lib/prompts/compiler.js | 21:38:42 | 1a281741e66d |
| lib/compat/legacy-canvas-adapter.js | 21:38:42 | 7ca2a682813f |
| studio/stages.js | 21:39:27 | d5f12f859eea |
| skills/elysium-generate-drama/SKILL.md | 21:57:42 | fc9cafa1a5e4 |
| lib/guidance.js | 21:33:23 | 381c860ec063 |

**两个 Agent 同时修改同一棵代码树，本身就是“补丁死循环”的直接原因之一**：一个补丁修好的地方会被另一个补丁的假设推翻，测试只覆盖各自的局部。修复前应停掉其它会话，只保留一个写者。

## 0. 结论

1. **按当前代码和本机数据，下一次对 10 号小说发起“做成短剧”会在第一步直接失败**（A1，E1）。存储里已有该小说的旧项目 `20261006213635859`：媒体 Run 是 `completed`，但项目仍是 `draft`。`studio_novel_create` 遇到这种情况会直接抛错，而且没有任何“重新开始/新版本”的入口。
2. **流程没有可收敛的重试路径**。已完成的文本任务不可变、commandId 写死为 `v1`、自动恢复的 commandId 是常量、批量生成不能对部分完成的项目重跑。只要某一步确定性地失败一次，后续每次重试都会得到同样的结果（A2–A7）。这是“反复打补丁仍走不完”的结构性根因，与具体哪一行写错无关。
3. **三层校验互不一致**：文本阶段的校验器（novel-production）、领域命令（commands）、阶段门禁（policies）各自定义规则。文本阶段放行的结果，会在 Proposal 落库或媒体建图时才被拒。由于第 2 条，这种拒绝会变成永久失败（A5）。
4. **分集规划的校验在设计上很难满足**：它要求各集原文区间无缝、精确覆盖 `[0, 原文字符数]`，但规划子 Agent 既拿不到原文，也拿不到总字符数（B1）。
5. 旧根因报告（`docs/research/2026-10-06-current-drama-root-cause.md`）列出的问题中，“吞掉失败子任务”“模板镜头补缺”“时长不传”“对白不进 prompt”“无参考图/分镜图”“无交付实体”在当前代码中都已有对应实现（见 §4），不要重复修。
6. 本机 107 个单元测试全部通过（E1），但没有一个测试走完 `studio_novel_create → Worker → deliver` 的真实执行路径。“测试全绿但流程走不完”的原因就在这里（I1）。

严重度：**P0** 必然阻断；**P1** 失败后无法收敛（死循环）；**P2** 结果错误或高概率失败；**P3** 质量、体验或维护问题。

## 1. 全链路与问题落点

```text
用户一句话
  └─ 主 Agent：GUIDANCE + 插件 systemPrompt + SKILL（F1 指令互相矛盾）
      └─ studio_novel_create(sourcePath,title)
          ├─ bindingKey=novel-sha(root\0hash) → 旧项目？（A1 P0 / A8）
          ├─ 旧媒体 Run failed → auto-resume（A2 commandId 常量）
          ├─ studio_project_create → 画布绑定会话（A9）
          ├─ studio_source_import（A10）
          └─ studio_novel_orchestrate
              ├─ novelTextProduction：source-summary → story-reconcile → episode-plan → episode-script×N
              │    （A3 已完成任务不可重做 / A6 重试无错误反馈 / B1 规划覆盖不可满足 / B2–B5）
              ├─ assertNovelCoverage
              ├─ submit analysis/plan/script（autoApprove, commandId=v1）（A4 / A5）
              └─ studio_batch_generate → dramaProductionTasks（A5c / A7）
                   └─ ProductionWorker（H1/H2）
                       ├─ render-reference（t2i）（C2/C3/C4）
                       ├─ render-storyboard（i2i）（C1/C2）
                       ├─ render-shot（r2v, durationSeconds）（D1–D8）
                       ├─ concat-video ×集
                       └─ deliver-drama → Timeline/Deliverable/completed
  └─ 画布：canvasReadModel + stages.js（G1/A9）
```

## 2. 问题清单

### A. 入口、状态与恢复（死循环主因）

**A1 · P0 · 已确认（E1+E2）· 10 号小说入口已被旧项目永久锁死**
- 证据：`~/.dsh/storages/short_video_studio/bindings/novel-25d90eab….json` → 项目 `20261006213635859`。该项目 `status=draft`，Run `61c59134…`（mode fast）`status=completed`，16 个任务全部 completed；12 个视频资产全是 `candidate`；没有参考图、分镜图、Timeline 和 Deliverable；9 个角色的 `description` 长度都是 0。它是旧代码产出的数据。
- 代码：`lib/index.js` 中 `studio_novel_create.execute` 的 `previousRun` 分支：`previousRun.status === 'completed' && project.status !== 'completed'` 时直接 `throw 'existing media run completed without validated drama delivery…'`。
- 后果：同一工作区里再次发起 10 号小说，必然在第一步报错；没有工具能作废旧项目、开新版本或迁移旧数据。只能手工删除存储。
- 修复方向：提供显式的“新建版本/作废旧项目”路径（bindingKey 带版本，或允许 `restart=true` 时 `bind(..., {replace:true})`）；不要把“旧版本数据不合规”变成永久异常。

**A2 · P1 · 已确认（E2）· 自动恢复只生效一次**
- 代码：`studio_novel_create` 对 failed Run 使用 `commandId: \`${previousRun.id}:auto-resume:v1\``。`ProjectService.execute` 遇到已存在的 commandId 时，如果 payload 哈希相同，就直接返回旧结果，不改状态。
- 后果：第一次恢复后 Run 又失败；之后每次调用都只回放旧结果，Run 一直是 failed，工具却返回 `ok:true, reused:true`。

**A3 · P1 · 已确认（E2）· 已完成的文本任务永远不能重做，且会被新校验器反复判死**
- 代码：`lib/script/novel-production.js` 的 `runBatch`：`task.status === 'completed'` 时执行 `request.validate?.(task.outputRef)`，抛错就直接向上冒。`productionTask` 状态机中 `completed: []`；`resumeProductionRun` 只处理 failed/blocked/leased/running。
- 后果：只要校验规则被改（Codex 每次打补丁都在改），或者旧输出不满足新规则，这个项目就每次都在同一处抛错，没有重做入口。

**A4 · P1 · 已确认（E2）· Proposal 的 commandId 写死为 v1**
- 代码：`studio_novel_orchestrate` 中 `${projectId}:analysis:v1`、`:episode-plan:v1`、`:episode:<id>:script:v1`。
- 后果：只要载荷有任何变化，就会得到 `commandId reused with different payload`，永久失败。载荷不变而领域层拒绝时（见 A5），每次重试也是同样的拒绝。

**A5 · P1 · 已确认（E2）· 三层校验不一致：文本阶段放行、后续阶段才拒**
- a) `story-reconcile` 的 validate 不检查 `analysis.citations` 的 sourceId 和上界，而领域层 `developmentProposalInput` 会检查（`citation source is not declared` / `citation exceeds source length`）。
- b) 分集剧本的 `sourceSpans` 在文本阶段不检查上界和 sourceId，领域层会检查。
- c) 实体描述：schema 允许 `description: ""`，`assertEpisodeCoverage` 也不检查；但 `policies.js` 的 `productionStageIssues`（21:52 新加）要求描述非空。结果是全部文本都已批准，`studio_batch_generate` → `dramaProductionTasks` 才抛 `production stages blocked`。
- d) 镜头时长上限：提示词写了“每镜最多 8 秒”，但任何校验器都不检查。manifest 的 `constraints.maxDurationFrames: 310`（约 12.9 s）也没有任何代码强制执行（全仓库只校验它的格式）。
- 后果：与 A3/A4 叠加后，任意一项都会变成确定性的永久失败。
- 修复方向：只保留一个“文本产物合规”函数，供文本阶段、领域命令和门禁共用；不合规的结果在文本任务内就判为失败，并带着错误重做。

**A6 · P1 · 已确认（E2）· 重试时不给子 Agent 任何错误反馈**
- 代码：`runBatch` 失败后只写入 `failProductionTask.error`，下次重跑时 prompt 完全一样（`prompt` 是确定性拼接的，不包含上次的 error）。子 Agent 在 `structured_output` 层面是“成功”的，失败发生在插件的后置 validate 里，子 Agent 根本看不到。
- 后果：同样的输入大概率得到同样的不合规输出。

**A7 · P1 · 已确认（E2）· `studio_batch_generate` 无法用于恢复**
- 代码：`generatable = {draft, planned, ready, rejected, invalidated}`，会排除 review/approved/generating 状态的镜头；随后 `dramaProductionTasks` 发现某集镜头不全，就 `throw partial episode assembly blocked`。
- 默认的“整个项目”请求会包含 `legacy-main` 里的镜头。准备图失败后，对应的伪镜头（见 C4）状态是 `ready`，会被当成视频镜头进入批量，`assertProductionStages` 必定抛错。
- 后果：只要有部分镜头已完成或某张准备图失败过，整项目批量生成就永远报错，只能对原 Run 调 `studio_production_resume`（又受 A2 和确定性失败影响）。

**A8 · P2 · 已确认（E2）· 绑定指向已删除的项目时永久失败**
- 代码：`binding ? await projectService.getProject(binding.projectId) : null`，项目不存在时 `getProject` 直接抛 `DomainNotFoundError`，而不是回退为新建。手工清理存储时只删项目不删 binding 就会触发。

**A9 · P2 · 已确认（E2）· 画布与会话绑定导致“画布空白”和“旧任务失败”**
- 复用旧项目的路径不会把新会话绑定到项目。新会话打开画布时，`LegacyCanvasCommandAdapter.projectFor` 会自动新建一个空的“未命名短剧项目”并绑定，画布因此是空的，存储里也会不断多出垃圾项目。
- 在同一会话里开第二部小说时，`onProjectCreated` 会用 replace 方式重绑。上一部小说还没跑完的任务在 `runRender` 中触发 `generation project binding changed; refusing…` 而失败，画布也看不到上一部了。
- 补充：Worker 的任务输入固化了 `sessionId`，画布投影完全依赖“会话 → 项目”这一个映射。

**A10 · P3 · 推断（E2）· 原文哈希口径不一致**
- `studio_novel_create` 用原始字节算 hash，`SourceTextService.importText` 用规范化文本（去 BOM、CRLF→LF）算 hash。文件带 BOM 或 CRLF 时，重跑会找不到已有的 source，用同一个 commandId 生成新的 sourceId，导致冲突。10 号小说无 BOM、无 CR（E1，两种哈希相同），当前不触发。

### B. 文本多 Agent 阶段

**B1 · P1 · 已确认（E2）· 分集规划的覆盖校验子 Agent 无法满足**
- 代码：`assertNovelPlan` 要求所有分集的 `sourceSpans` 排序后无缝覆盖 `[0, source.characters]`。但 `episode-plan` 的 prompt 只有分析 JSON，没有原文、没有总字符数，也没有“必须覆盖到 4392”的说明。规划 Agent 只能从分析的 citations 去拼区间，标题行、事件之间的过渡段都会形成缺口。
- 后果：规划任务高概率失败，并且通过 A6 无限重复。

**B2 · P2 · 已确认（E2）· 归并要求原样保留所有分段事件 id**
- `story-reconcile` 要求每个分段摘要的 beat id 都出现在分析里。不同分段各自产生的 id（如都叫 `b1`）会冲突并被静默合并，长篇小说还会让输出量暴涨，超过子 Agent 的 3 次输出、6 步预算。

**B3 · P2 · 已确认（E2）· 强制每个镜头都绑定角色和场景**
- `assertEpisodeCoverage` 与 `productionStageIssues` 都要求：只要项目里有角色，每个镜头就必须至少绑定 1 个角色和 1 个场景。空镜、窗外夜色、道具特写也得强行塞一个角色参考，生成的视频里会出现不该出现的人。另外，分析阶段会把“未出场”的人物（亡夫、老乡、婴儿）也列为角色，这些人物同样可能被绑定进镜头（E1：当前项目有 9 个角色，其中 3 个未出场）。

**B4 · P2 · 已确认（E1 历史 + E2 当前）· 子 Agent 仍然收到完整的宿主系统提示**
- `installNovelChildPolicy` 只限制工具和步数，没有剥离插件 GUIDANCE、工作区 AGENTS.md、Skill 目录。历史上已有子 Agent 只回复 “I'll acknowledge the workspace instructions…” 而没有产出（根因报告 §2），当前代码对此没有改动。

**B5 · P2 · 已确认（E2）· 子 Agent 输出预算太紧**
- `structured_output` 最多 3 次，不合 schema 的调用也计数（宿主的 `ToolArgsError` 也会经过 guard）；`maxSteps=6`。分集剧本 schema 每个镜头有 10 个必填字段、`additionalProperties:false`，镜头一多，首次提交就很容易违反 schema。

**B6 · P3 · 已确认（E1+E2）· 没有可执行的视觉风格字段**
- 分析 schema 中 `storyBible` 是无属性的自由对象。下游的 `renderPreparation` 读 `storyBible.visualStyle`，`compiler` 的 `promptText(storyBible)` 读 `prompt/visualStyle/...`。当前项目的 storyBible 键是 `narration/logline/timeline/themes/…`（E1），风格为空，各角色卡、场景卡的画风互不一致。

**B7 · P3 · 已确认（E2）· 要求写“H3 六项 prompt”却不给规范**
- 剧本子 Agent 只拿到一句“短版 H3 六项 prompt”。编译器只认英文段名（如 `subject_definitions:`）。子 Agent 写成中文段名或 markdown 标题时，整段会被当作普通描述，再套一层六段结构，造成重复嵌套（见 D2）。

**B8 · P3 · 已确认（E2）· 分集并行写作没有前集状态**
- 每批 3 集并行，Writer 拿不到前集结束时的人物和道具状态；SKILL 自己也承认这“不构成连续性验证”。

**B9 · P3 · 已确认（E2）· 文本阶段同步阻塞主 Agent 且没有可视进度**
- 整个文本阶段在一次工具调用内前台执行完才返回，期间画布没有任何产物，用户只能看到“卡住”。

### C. 参考图与分镜图准备

**C1 · P2 · 已确认（E2）· 视频参考同时传角色卡和含人物的分镜图**
- `render-shot` 的 `refs = [角色卡…, 场景卡, storyboardAssetId]`。分镜图本身就画着这些角色。按 GUIDANCE 的实测硬规则（“参考图里有几个身体，成片就倾向出现几个角色”），这样会产生重复角色。编译出的 `subject_definitions` 也没有描述最后一张分镜图（Picture 序号缺失）。

**C2 · P2 · 已确认（E2）· 卡片和分镜的尺寸不适合作参考**
- 角色卡继承画布 16:9，fast 档是 1024×576 的横版全身像，人物在画面中占比很小（`docs/open-issues.md` ISSUE-001 未解决）。分镜用 i2i 生成，输出尺寸跟随第一张参考图（角色卡），fast 档 `reference_pixels=768`，分镜分辨率很低。

**C3 · P3 · 已确认（E2）· 卡片 prompt 不满足自家硬规则**
- 角色卡 prompt 是 `name + description + visualStyle + “不要文字”`，没有“单视图、正面全身、纯净背景、单人”等约束。description 来自叙事分析，多是性格和背景，而不是外观。

**C4 · P2 · 已确认（E2）· 每张准备图都会伪造一个 legacy-main 镜头**
- `runRender` 对所有能力都调用 `ensureLegacyShot`，会建一个“兼容画布”Episode（status `rendering`），每张图对应一个 `ready` 镜头。这些镜头会进入整项目批量（A7），污染镜头统计和领域数据。

**C5 · P3 · 已确认（E2）· 准备图和视频自动批准，没有任何视觉检查**
- `approveGeneratedAsset` 只记录一条 `media-metadata pass`。这是快速模式的设计取舍，但 `deliver-drama` 的质量报告里写的是 `checkedStages: true`，容易被误读成已经审核过。

### D. 镜头视频生成

**D1 · P2 · 已确认（E2）· 对白说话人编号与参考图编号错位**
- `compileH3Prompt` 中对白用的 `(S{n})` 取自整个项目的 speakers 列表下标（全部角色名加全部对白说话人），而 `<Subject n>/<Picture n>` 是本镜参考图的顺序。说话人编号对不上，口型同步会绑错人。对白里的名字（如“龙哥”）和角色名（“龙哥（叙事者「我」）”）也对不上，下标会退回到行号。

**D2 · P2 · 已确认（E2）· 结构化 prompt 被追加到错误的段落**
- `compilePromptSnapshot` 先拼 `combinedPrompt = shot.prompt + 角色/场景描述`。如果 `shot.prompt` 已经是六段结构，编译器走“已有结构”分支，角色描述会落在最后一段 `non_diegetic_music:` 下面。LLM 自己写的 `subject_definitions` 里 Picture 的顺序也和实际传入的 refs 顺序无关。

**D3 · P2 · 已确认（E2）· 没有执行模型的时长上限，事后时长校验浪费 GPU**
- `durationSeconds × 24` 直接作为帧数，没有对照 `maxDurationFrames=310` 截断或拒绝。`render-shot` 在出片后才校验实际时长与计划差值是否在 1 s 内，超出就把已经出的片判失败，镜头停在 review。

**D4 · P3 · 推断（E5）· 不检查对白长度是否装得进镜头时长**
- 长对白配短镜头时，模型要么说不完，要么语速异常。没有任何字数/时长检查。

**D5 · P2 · 已确认（E2）· 乐观锁冲突无重试，长任务随机失败**
- 所有内部命令都是“先读 revision 再执行”，`ProjectService.execute` 发现 revision 不一致就抛 `DomainConflictError`，`submitProjectCommand` 和 `ProductionWorker.execute` 都不重试。同时 Worker 每 40 s 续租写一次，画布 UI 保存时也会写（replaceLegacyCanvas）。交错发生时，GPU 已出片，`markAttemptSubmitted`/`completeGenerationAttempt` 却失败，或者 `createGenerationAttempt` 报 `prompt snapshot projectRevision is stale`。概率不高，但在多镜头、多小时的运行里迟早会撞上（E5）。

**D6 · P3 · 已确认（E2）· 画布丢失更新**
- `runRender` 结束时把开头读到的画布快照（已经是几分钟前的）通过 `replaceLegacyCanvas` 整体写回，渲染期间别处写入画布的节点会被覆盖。

**D7 · P3 · 已确认（E2）· 孤儿 Attempt**
- 提交阶段网络不确定会标记 `submission_unknown`。任务失败后 `resumeProductionRun` 清空 checkpoint，新建一个 Attempt；旧 Attempt 永远停在活动态，镜头可能一直是 `generating`。

**D8 · P3 · 已确认（E2）· 恢复时 ComfyUI 历史已过期**
- 按 checkpoint 恢复已完成的 Attempt 时会重新 `comfyWait(promptId)`；如果远端 history 已被清理，会一直等到 15 分钟超时才失败。

### E. 拼接与交付

**E1 · 已在 21:57 修复 · 单集批量误建整剧交付**
- 21:57 前 `dramaProductionTasks` 对单集批量也会建 `deliver-drama`，必然失败。当前快照加了 `wholeDrama` 条件，已修复。此条仅作记录，不要重复修。

**E2 · P3 · 已确认（E2）· Episode 状态机未使用**
- 整个流程中 Episode 一直是 `draft`，`completeDramaProduction` 直接写成 `delivered`，绕过了状态机。画布和摘要在制作期间无法显示分集进度。

### F. Agent 指令（父 Agent 行为错乱的来源）

**F1 · P1 · 已确认（E2）· 三份指令互相矛盾**
- `lib/guidance.js`：“优先用 studio_source_import 的 sourcePath”，以及“文本阶段完成后在同一轮自动加载媒体 Skill”。
- `lib/index.js` 追加的 systemPrompt：主 Agent 不得直接调用 studio_source_import / studio_novel_orchestrate / studio_batch_generate，不得加载其他媒体 Skill。
- `SKILL.md`：第 1–2 步说调用 `studio_novel_create` 后禁止再调任何 `studio_*`；第 3–7 步却仍让主 Agent 提交内容分析、分集规划、剧本，再调 `studio_batch_generate`；多 Agent 协议一节又在描述主 Agent 根本不该做的任务图细节。
- 后果：历史日志中父 Agent 猜测不存在的 Skill、重复导入、额外创建失败的 Run（根因报告 §6），都由这里的矛盾诱发。

**F2 · P3 · 已确认（E2）· 文案错误**
- systemPrompt 后缀写成 `'\\n整书…'`，模型看到的是字面量 `\n`。
- `comfy_generate_image` 的描述写“默认档 quality”，实际默认是 fast。
- GUIDANCE 说“由网关拒绝无效配置”，但 `lib/gateway.js` 的 `GatewayClient` 没有被任何代码引用。

### G. 画布展示

**G1 · P2 · 已确认（E2）· 阶段计数仍不能当证据**
- `canvasReadModel` 为每个缺前置的镜头生成一张 `domain:blocked:*` 文本卡，`stage='storyboard'`。在没有任何分镜图的情况下，“分镜图”页签计数也是 N，用户看到的仍是“节点数代替产物”，与根因报告批评的现象相同。

### H. 运行与平台

**H1 · P2 · 已确认（E2）· Worker 全量轮询，项目记录无上限增长**
- `ProductionWorker.drain` 每 1.5 s 对全部项目 `listProjects()` 并深拷贝。`commandResults` 永不清理，`legacyCanvas` 每次都整体写入。单个项目上限 10 MB（`PROJECT_RECORD_LIMIT`），超过后该项目所有命令都失败。当前项目 177 条命令、223 KB（E1），多轮重试后会持续膨胀。

**H2 · P3 · 已确认（E2）· Worker 会执行存储里所有项目的 ready 任务**
- 包括旧版本代码留下的任务，它们会占用唯一的并发槽，或者以旧假设失败。

**H3 · P3 · 已确认（E2）· 设置页保存会丢掉 `pins`**
- `POST /api/config` 写回的 `safe` 对象没有 `pins` 字段。

**H4 · P3 · 已确认（E2）· 成人内容权利门没有接入流程**
- 只要 `productionSpec.contentRating` 被设成 `adult`，`assertRightsGate` 就会阻断所有生成，而整书流程中没有任何一步记录 age_confirmation/consent。当前入口不设这个字段，所以不触发，但一旦设置就必然卡住。

### I. 测试与流程

**I1 · P1 · 已确认（E1）· 测试全绿但不覆盖真实执行路径**
- 本机 `node --test` 107/107 通过。没有一个测试用假 ComfyUI 和假子 Agent 驱动 `studio_novel_create` → `novelTextProduction` → submit → `studio_batch_generate` → `ProductionWorker` 的 6 类 handler → `completeDramaProduction`，再从 `canvasReadModel` 验证画布。A1–A7、B1、C1、D1/D2 这类跨层问题，单元测试按设计就发现不了。

**I2 · P1 · 已确认（E1）· 多个写者同时改代码**
- 见文首。没有单一写者、没有端到端验收的情况下，每个补丁只能针对上一次的报错修。

## 3. 为什么会陷入“补丁死循环”

1. 一个确定性错误出现一次，状态就被持久化成不可重做（A3/A4），或恢复入口只生效一次（A2）、根本不可用（A7）。补丁修好代码之后，旧项目仍然卡死，于是看起来“还是走不完”，接着又打下一个补丁。
2. 每个补丁都往某一层加一条校验（这次的 policies 描述非空、drama 的 wholeDrama 等），但其它两层没有同步（A5），新规则又在下游制造新的确定性失败。
3. 子 Agent 看不到失败原因（A6），规划校验在设计上又难以满足（B1），所以文本阶段本身就不收敛。
4. 指令互相矛盾（F1），父 Agent 会自行“补救”，额外制造 Run 和错误。
5. 没有端到端测试（I1），又有多个写者同时修改（I2）。

修复顺序建议：先做 A1/A2/A3/A4/A7（可重置、可重做、可恢复）和 A5（统一校验），再做 B1/A6（文本阶段可收敛），然后是 F1（指令统一）和 I1（一条假 ComfyUI 的端到端测试），最后才轮到 C/D/G/H 的质量项。

## 4. 旧根因报告中已在当前代码修复的项（不要重复修）

| 旧问题（根因报告） | 当前实现位置 |
| --- | --- |
| `parallel` 返回 null 被 `filter(Boolean)` 吞掉 | `runBatch` 对缺失结果 `failProductionTask` 并抛错 |
| 缺失剧本用大纲和通用镜头补齐 | 已删除；`assertEpisodeCoverage` 与领域命令都拒绝 `script === outline` |
| 时长没有传到生成 | `render-shot` 传 `durationSeconds: shot.duration`，`runRender` 按 fps 和长度网格取整 |
| 独立对白字段不进 prompt | `compileH3Prompt` 消费 `audioDialogue/audioNotes`（但存在 D1/D2） |
| 没有参考图和分镜图 | `dramaProductionTasks` 生成 render-reference → render-storyboard 依赖（但存在 C1–C4） |
| 没有 Timeline、Deliverable，项目不完成 | `deliver-drama` → assembleTimeline/recordDeliverable/completeDramaProduction |
| 文本阶段没有 checkpoint | `novel-text` ProductionTasks（但存在 A3） |
| 空上游也能生成视频 | `createGenerationAttempt`、`startProductionTask`、`runRender` 三处都调用 `assertProductionStages` |

## 5. 诚实边界

- 只做了静态审查和本机只读数据检查；没有发起任何文本 Agent 或 ComfyUI 生成，所以 D4、D5 的触发概率、C1 的重复角色现象、B4 子 Agent 是否仍然空回，都没有在当前代码上实测。
- 宿主 API（`exec.concludeTurn`、`tools.restrict`、`structured_output`、workflow foreground 结果、`agent/created` 的 parentSession）已在本机安装的宿主源码中核对确实存在；未核对宿主各版本之间的差异。
- 审查结束后代码可能还在被其它会话修改，以文首哈希表为准。哈希不一致的文件需要重新核对对应条目。
- 未审查：超分、抽帧、资产库、飞书送达、`comfy_workflow_*` 检查工具，以及 `studio/app.js` 的大部分交互细节（只审了阶段投影与数据来源）。
