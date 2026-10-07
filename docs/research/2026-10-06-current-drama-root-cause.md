# 当前短剧不完整：Agent 执行与制作链路根因调查

> 状态：已完成本地执行链调查及最小复现。
> 基线：2026-10-06，仓库提交 `09cb1ad0`，已安装插件 `dsh-short-video-studio@1.8.2`。
> 范围：同一小说的两个当前项目、父子 Agent 会话、结构化结果、领域记录、生成参数及已生成 MP4。未修改代码、配置或项目数据，未启动新媒体生成。

## 0. 结论

> **补充确认（2026-10-06）**：用户指出前四个制作阶段为空仍能生成视频。使用真实领域命令做纯内存复现：内容分析、角色资产及集剧本均为空，planned 镜头仍能创建 Attempt 并转为 generating。另对当前新项目调用真实画布读模型和阶段统计，内容分析、资产设定、剧本、分镜图节点均为 0，视频为 10。领域文本未投影与真实图片产物缺失同时存在；当前验收按[端到端人工验证计划](../plans/2026-10-07-novel-to-drama-e2e-validation.md)执行。

**存在真实的父 Agent 和子 Agent 执行错误，但把这些错误变成“不完整成片”的直接根因，是编排与验收代码允许缺失内容继续通过。**

已证实的因果链：

```text
分集子 Agent 没有交回合法结构化剧本
  → workflow 的 parallel 将该任务异常转为 null
  → 插件 filter(Boolean) 丢弃失败项，不核对任务数量
  → 协调代码用分集大纲及两个通用镜头替代缺失剧本
  → 自动批准并持久化
  → 媒体生成、拼接成功
  → ProductionRun 标为 completed，但作品缺失具体剧情
```

此外，两个独立的参数断点继续破坏作品：

- 生成任务没有把每镜 `shot.duration` 转成生成帧数；所有实际 Attempt 都请求 124 帧。两次制作都是 10 镜，成片均为 **51.766 秒**，而镜头计划分别为 **110 秒、84 秒**。
- Prompt 编译器没有读取独立字段 `audioDialogue`、`audioNotes`。只有碰巧重复写进 `shot.prompt` 的声音描述才会进入模型；不能保证正式对白被执行。

角色参考及交付契约也没有闭环：两个项目全部镜头参考绑定为空，没有角色参考图；文件已拼接，但项目仍是 draft，Timeline 和 Deliverable 均为 0。

因此，增加子 Agent 数量、等待后台完成、只改提示词或重新生成，都不能单独解决问题。

## 1. 当前项目与成片事实

未收到指定项目的答复，因此检查了同一素材的两个项目。

| 检查项 | 20:51 创建的项目 | 21:08 创建的项目 |
| --- | --- | --- |
| Project ID | `20261006205109724` | `20261006210821751` |
| 原文长度 | 4392 字符 | 4392 字符 |
| 正式规划集数 | 3 | 3 |
| 镜头数 | 2 + 4 + 4 = 10 | 4 + 4 + 2 = 10 |
| 缺失并被补通用镜头的集 | 第 1 集 | 第 3 集 |
| 计划镜头时长合计 | 110 秒 | 84 秒 |
| ffprobe 实测整片时长 | 51.766 秒 | 51.766 秒 |
| 分集实际时长 | 10.366 / 20.700 / 20.700 秒 | 20.700 / 20.700 / 10.366 秒 |
| 成片尺寸 | 832 × 480 | 832 × 480 |
| 音轨 | 有 | 有 |
| 角色数 / CharacterState 数 | 8 / 0 | 8 / 0 |
| 全部镜头 referenceBindings | 空 | 空 |
| 领域资产 | 10 个视频，0 个图片 | 10 个视频，0 个图片 |
| Timeline / Deliverable | 0 / 0 | 0 / 0 |
| 项目 status | draft | draft |
| 主媒体 Run | completed | completed |

右侧项目在调查期间仍在制作，至 `2026-10-06T13:22:50.086Z` 已完成。上述右侧结论取自完成后的记录，不能归因于“尚未生成完”。左侧另有一个失败的额外 Run；没有把它与已经完成的主 Run 混为一谈。

记录位置：`/Users/mac/.dsh/storages/short_video_studio/projects/<Project ID>.json`。
成片位置：`/Users/mac/.dsh/storages/short_video_studio/artifacts/<Project ID>/step-08-assembly/`。

## 2. 根因一：子任务失败被转成成功路径

### 实际失败，不是猜测

左侧父会话：`session-9f58a737-c6d7-437a-949b-28a024f84992`。

- 第 1 集子会话 `69203736-24b4-4616-b565-793191f522f7` 调用了 6 次 `structured_output`，没有一次成功记录。
- 前两次因为增加 Schema 禁止的字段而被拒；之后触发当时的 2 次调用预算，连修正提交也被拒。
- 保存后的第 1 集 `script === outline`；只有“建立场景”“情节推进”两个镜头，均没有具体对白和参考绑定。

右侧父会话：`session-8b127dd0-f44d-4d10-85cf-9d53eb38b7a2`。

- 第 3 集子会话 `c5436f80-1bf8-42f9-b8be-0e2264633ac2` 只回复 `I'll acknowledge the workspace instructions and proceed with the task.`，没有调用 `structured_output`。
- 父会话 seq 66 明确记录该子任务 `outcome: failed`。
- seq 69 却记录整个文本 workflow `stopReason: completed`。
- 保存后的第 3 集 `script === outline`；同样只剩两个通用镜头。

### 真正失效的代码边界

1. `lib/index.js:3935`：`structuredAgent` 在子任务没有结构化结果时抛异常，单看这里是正确的。
2. 本机安装的 `@deepseek-ai/dsh-workflow-ptc@0.1.7-alpha.2` 实现明确规定：`parallel()` 捕获普通异常并返回 `null`；只有致命 workflow 异常继续抛出。
3. `lib/index.js:3970`：`episodeScripts.push(...values.filter(Boolean))` 删除失败项，没有验证每一个规划集都取得有效剧本。
4. `lib/index.js:4024–4046`：缺失集被替换为 `script: episode.outline` 和两个固定通用镜头。
5. `lib/index.js:4058–4069`：内容分析、分集规划和每集剧本都 `autoApprove: true`。
6. `lib/script/contracts.js:81`：只验证非空剧本、非空镜头、正时长等结构条件；通用镜头满足这些条件。

**框架已经报告了子 Agent 失败；插件没有把失败继续传播到整书制作的完成判定。**

同样的丢失模式也存在于分段摘要：`lib/index.js:3956` 使用 `filter(Boolean)` 丢弃失败摘要。当前记录不足以证明本次丢了原文分段，但代码确实存在相同断点。

### 最小复现结果

执行了仓库真实 workflow 脚本正文，以 Mock 子 Agent 模拟第 3 集失败，并按本机框架的 `parallel()` 语义运行；没有调用模型或生成媒体。

```json
{
  "plannedEpisodes": 3,
  "returnedScripts": 2,
  "swallowedErrors": ["文本子任务未返回合法结构化结果：episode-script:ep-3"],
  "workflowReturnedSuccessfully": true
}
```

另将“分集大纲 + 通用镜头”交给真实 `validateDevelopmentPayload('episode_script', ...)`，验证通过。这证实了失效路径，而非仅凭文档推测。

## 3. 根因二：文本信息逐级压缩，没有剧情覆盖验收

`lib/index.js:3960` 固定要求“覆盖整书……最多 3 集”；`:3967` 固定要求“script 不超过 800 个汉字，最多 4 镜”。

实际写作子 Agent 只收到故事圣经和当前集大纲，未收到该集原文或完整分段事实。原文沿着“原文 → 摘要 → 归并 → 大纲 → 剧本 → 镜头”逐级压缩；缺失的信息无法由后续阶段恢复。

项目 Skill `skills/elysium-generate-drama/SKILL.md:21` 要求快速模式仍覆盖整书和全部分集。实际编排却设置了与原文规模无关的总容量上限，且没有关键事件到镜头的覆盖检查。

`sourceSpans` 是引用范围，不是剧情覆盖证明。`lib/domain/commands/index.js:54–58` 校验来源和边界，没有验证引用范围内的事件是否实际进入镜头。大纲引用了整段原文，仍可以保存两个没有具体事件的通用镜头。

已确认：通用镜头导致对应集具体剧情没有进入生成 prompt。其他普通镜头的艺术质量及全部事件遗漏比例未做逐帧、逐句评审，不作量化结论。

## 4. 根因三：镜头时长在媒体交接处断开

实际链路：

```text
Shot.duration
  → studio_batch_generate 只传 args.length，未使用 shot.duration
  → 编排入口未提供 length
  → runRender 默认 length = 124
  → 每镜约 5.17 秒
  → 分集与整片 preserve 拼接
```

证据：

- `lib/index.js:4238–4257` 创建 render task；`:4252` 写的是 `length: args.length`。
- `lib/index.js:4073–4075` 的整书批量生成调用不传 `length`。
- `lib/index.js:2000`：`intArg(opts, 'length', 124)`。
- 两项目全部已完成 Attempt 的 `inputSnapshot.parameters.frames === 124`，没有按 5、6、7、10、12、14 秒镜头计划变化。
- `lib/index.js:4283、4293` 以 `strategy: 'preserve'` 拼接，没有目标时长。
- ffprobe 实测两个 10 镜作品均为 51.766 秒。

这是生成前参数丢失，不能靠对成片补一个时长字段修复。短时段也不能证明模型能完整说完长对白或完成多事件动作。

## 5. 根因四：对白与角色参考缺少完整执行契约

### 对白

`lib/prompts/compiler.js:95–119` 读取 `shot.prompt`、参考绑定、风格和负面 prompt，没有读取 `shot.audioDialogue` 或 `shot.audioNotes`。

实测：创建带独立对白标记 `DIALOGUE_SENTINEL_20261006` 的 Shot，调用真实 `compilePromptSnapshot()` 后，编译 prompt 不包含该标记。

两个项目保存的独立对白字符串都没有完整、逐字进入实际 Attempt prompt。但是部分 prompt 已自行写入对话或声音描述；所以结论是**独立对白字段没有消费，完整性没有保证**，而非“全部无声”或“所有对白都被删除”。成片确实有音轨，其语言和对白准确率未做转录验证。

### 角色与场景

两个项目虽然保存了角色和场景实体，但没有 CharacterState、图片资产或镜头 referenceBindings；实际 Attempt snapshots 的 references 全为空。逐镜使用不同随机 seed，任务也没有传入连续性参数。

编排只有分析、归并、规划、写作和直接视频生成，没有建立角色参考素材与绑定的阶段。子 Agent 又被限制只能返回结构化文本，不能自行弥补这一缺口。

已确认：没有可执行的身份参考约束。未确认：角色外观实际漂移程度，因为本次未做逐帧视觉比较。

## 6. 父 Agent、子 Agent 各自的问题

| 层级 | 已确认行为 | 责任判断 |
| --- | --- | --- |
| 父 Agent，左侧会话 | 猜测不存在的 Skill；缺 projectId 导入失败；文本交接后继续大量工具调用；额外创建失败媒体 Run；恢复调用曾漏 projectId | 执行遵循与工具参数有问题，加重制作混乱。不是本次通用镜头和固定时长的唯一原因 |
| 父 Agent，右侧会话 | 正确进入 `studio_novel_create`；第一次 episode-plan 失败后重新调用入口；重复 Skill 调用还携带大量无关字段 | 首次失败后重做文本流程；没有持久文本 checkpoint。其后主要制作缺陷发生在工具内部 |
| 子 Agent，左侧第 1 集 | Schema 不合法、多次提交被预算拒绝 | 直接触发缺失剧本；错误提交也消耗调用预算 |
| 子 Agent，右侧第 3 集 | 只确认指令，没有交回结构化结果 | 直接触发缺失剧本；即便未发生该错误，固定时长等断点仍然存在 |
| 子 Agent 环境 | 文本子任务仍收到编码 agent、全局短剧入口、workspace instructions、Skill catalog 等提示；发生过尝试调用 bash/subagent 被拒 | 存在职责不匹配的上下文干扰。它是否是模型不执行的唯一心理原因未确认，不能把相关性写成确定因果 |
| 编排代码 | 丢弃失败、补通用镜头、自动批准、不核对覆盖 | 将真实子任务失败转成可交付结果的核心根因 |
| 媒体交接 / 编译 | 未消费每镜时长、独立对白；没有参考素材闭环 | 即使所有子 Agent 都成功，也会独立破坏成片完整性 |

当前 `lib/script/child-policy.js:7` 在工具调用进入时累计次数，包含不合法提交。当前入口设置 3 次预算；左侧制作日志明确是当时的 2 次预算，不能用当前代码抹去历史运行差异。

不能据此认定“模型天生无法制作短剧”。日志证实多名子 Agent 成功交回结构化结果，也证实具体失败任务；没有做不同模型的对照实验。

## 7. 根因五：完成状态只覆盖任务，不覆盖作品交付

主 Run 的 completed 表示其 render/concat tasks 成功，不能证明内容完整。

两个项目制作完成后：

- 项目仍为 draft；正常剧集仍未完成领域交付闭环。
- 所有视频资产仍为 candidate，镜头为 review，媒体审核任务为 awaiting_human。
- Timeline 与 Deliverable 均不存在；成片由兼容画布保存，而不是正式交付实体。
- 还有一个没有正式镜头的 `legacy-main`“兼容画布”Episode。

快速模式允许跳过人工内容质检；缺口是没有自动检查替代它，且画布拼接与正式完成状态没有统一。无需引入新的人工确认才能修正这一点。

文本任务也没有按 Skill 要求保存为可恢复的 ProductionTasks。右侧第一次失败之后，第二次入口重新执行了分段分析、故事归并、分集规划；两个 workflow run 和对应子会话记录可证实。不能宣称当前已实现文本阶段按失败任务恢复。

## 8. 排除与诚实边界

- **已排除“只是还没等完”**：两个主 Run 均 completed，右侧完成后仍缺第 3 集正式剧本。
- **已排除“原文件没导入”**：两项目源文记录均有 4392 字符，来源 hash 一致。
- **已排除“全部媒体调用失败”**：两项目均有可被 ffprobe 读取的完整拼接文件和音轨。
- **没有把历史配置错误当主因**：左侧额外 Run 的错误为选定实现不存在；主 Run 最终生成成功，但内容和时长仍错误。
- **当前安装文件已核对**：web profile 安装副本的 index、child-policy、contracts、compiler 和 Skill 与仓库逐字相同；主进程监听 3080，工作目录为此仓库。历史调用预算差异保留，以会话记录为准。
- **未确认**：逐帧角色漂移、实际对白语言/错词率、视觉表现、外部模型对素材的响应原因。已有证据足以证明缺失剧本与参数断点，无需猜测远程模型故障。
- 工作区原有 `studio/index.html` 修改及媒体删除均未覆盖、未 stash。本次只新增本报告。

## 9. 修复顺序与验收建议（尚未实施）

涉及多个模块，按仓库要求先给出可审核范围，确认后才实施。

| 顺序 | 文件 / 执行层 | 最小改动方向 | 验收条件 |
| --- | --- | --- | --- |
| 1 | `lib/index.js` 编排 | 校验每个摘要和分集结果；失败保留任务身份并中止相关生产；删除把缺剧本补成通用镜头的成功路径 | 注入一个分集失败，项目不能自动批准缺失集、不能生成整片 completed |
| 2 | `lib/index.js`、`lib/script/contracts.js` | 按原文事件和预算规划容量；检查关键事件到镜头覆盖；写作取得对应源文事实 | 引用整段原文但没有对应事件镜头的结果不能通过验收 |
| 3 | `lib/index.js` 的 batch / render 交接 | 从每镜时长及所选实现帧率、合法帧数网格计算生成参数；明确不支持时长时的失败或分镜策略 | 不同镜头计划时长产生相应请求；实际时长按声明误差验收 |
| 4 | `lib/prompts/compiler.js` | 将独立对白、声音说明纳入正式 prompt；防止已有 prompt 对白重复 | 独立对白标记进入 snapshot；真实成片再检查对白可辨认且完整 |
| 5 | 编排 / 参考绑定 / 制作任务图 | 生成或使用经认可的角色场景参考，绑定到镜头；增加文本任务 checkpoint | 每镜可追溯身份参考；恢复只重做失败任务 |
| 6 | assembly / domain delivery | 合并快速模式自动验收、Timeline、Deliverable 和最终状态更新 | 全部规划集与镜头、时长、媒体文件、交付实体一致才标完成 |

先修确定性断点，再用同一素材做完整制作验收。单元或模拟验证只能证明代码行为，不能替代真实成片的视听验收。

## 10. 证据复查入口

- 父子会话：`/Users/mac/.dsh/sessions/--Users-mac-ai-llm-dsh-plugins--/<session ID>/session.v4.jsonl.zstd`，用 `zstd -dc` 读取 JSONL；关注 `tool-workflow/agent-end`、`tool-workflow/run-end`、`assistant/message` 与 `tool/result`。
- 项目记录：取 `record.episodes`、`shots`、`attempts[*].inputSnapshot`、`productionRuns`、`productionTasks`、`reviewTasks`、`timelines`、`deliverables`。
- 媒体检查命令：`ffprobe -v error -show_entries format=duration:stream=codec_type,width,height,duration -of json '<成片路径>'`。
- 最小复现：提取 `studio_novel_orchestrate` 的真实 script 正文；Mock 三集规划和一个返回 null 的分集子 Agent；依本机 parallel 普通异常返回 null 的语义执行，得到 3 个规划集、2 份剧本且 workflow 正常返回。
- 对白复现：真实 `compilePromptSnapshot()` 输入含独立 audioDialogue 标记、prompt 不含该标记，输出 prompt 未包含标记。
