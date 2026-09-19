# AI 自动规划 Segment 衔接实施记录

## 已修改文件

以下路径相对 `dsh-elysium/`。

- `src/server/projects/production.js` — segments 阶段要求 AI 逐段输出 use_previous_tail 与 tail_reason；根据时空、连续动作、构图及主动切镜判断，不以 Scene ID 判断；回写遗漏、非布尔值或空原因时拒绝保存并保留请求供补齐。
- `src/database/schemas/production.js` — 持久化 tail_reason，普通片段编辑保留已有判断与原因，首段仍禁止使用前段尾帧。
- `src/client/workbench/segment-editor.js` — 删除手动开关，第二段起只读显示 AI 规划的衔接方式和原因；历史未评估片段明确提示，不冒充 AI 判断。
- `src/client/workbench/styles.js` — 删除只用于旧开关的两条样式。
- `src/tools/project/production.js` — 对话修改片段衔接时要求 AI 同时给出判断与原因。
- `tests/production.test.js`、`tests/segment-continuity.test.js`、`tests/production-ui.test.js` — 更新 AI 返回契约；覆盖遗漏拒绝、原请求重试、首段拒绝、布尔决定与原因的保存和继承、只读 UI 以及原队列自动抽帧回归。

## 验收标准核对

| AC | 状态 | 验证方式与证据 |
|----|------|--------------|
| AC-1 | 通过 | 缺少判断、字符串布尔值、缺少/空白原因均拒绝且不消费请求；修正后可保存 false/true/false 的三段结果；首段 true 拒绝。 |
| AC-2 | 通过 | UI 测试确认无 checkbox，展示采用/不采用及原因，历史数据提示尚无 AI 判断；编辑其他字段保留判断。重启后浏览器第二段显示只读“片段衔接 · AI 规划”，原开关数量为 0。 |
| AC-3 | 通过 | 保存重读及分镜上下文含原因，原 i2va、前段依赖、任务冻结及恢复测试通过。 |
| AC-4 | 通过 | 15 项相关测试、最终 222 项插件全量测试通过；构建、Registry、git diff --check 通过。Harness 重启为 PID 70836，刷新认证入口后实际页面验证通过。 |

## 并行工作说明

用户已确认另一个任务正在清理旧 UI，要求保留其改动。期间因旧文件删除而构建引用尚未同步，全量测试与构建暂时失败；本次未恢复这些文件或修改其构建清单。另一个任务更新引用后，重新执行测试与构建全部通过。现有项目及视频不改动，不自动重规划或生成视频。

## 真实 AI 验收

通过：使用现有 `qwen3.8-27b-elysium` 模型及产品实际的 `project_production_complete` 工具定义，合成三个各 5 秒 Scene；前两段不同 Scene ID 但同一时空连续机位，第三段跳时换景。AI 自行返回并经真实工具校验保存到独立临时项目，结果为：

1. false — 第一段无上一段可承接。
2. true — 同一时空同一机位，连续走动动作可自然承接上一段结束画面。
3. false — 换到次日清晨公园，新地点新时间新独立机位，无法承接书店结束画面。

此前两个纯文本 JSON 探测分别遇到 Markdown 包裹和缺少末尾括号；最终通过证据来自上述实际工具调用协议，而不是修补不完整文本。验证项目位于本次新建的临时目录，完成后移除；未改动用户项目或提交视频任务。

## 人工待办

无。新规划自动生成判断；旧片段沿用现有数据，页面明确显示尚无 AI 判断，不自动重做视频。
