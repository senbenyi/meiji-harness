# Segment 尾帧衔接实施记录

## 已修改文件

以下路径相对 `dsh-elysium/`。

- `src/database/schemas/production.js` — 保存布尔字段 `use_previous_tail`，默认关闭，首段不能开启；标记依赖旧尾帧的后续视频需更新。
- `src/server/projects/production.js` — 编辑保存开关；分镜与 H3 输入上下文带上前段开始衔接要求；开启后固定为 i2va，记录前段来源而不伪造图片 URL；切换上游视频版本时使后续衔接失效。
- `src/server/projects/segment-queue.js` — 冻结来源视频版本，严格等待前段成功，提取尾帧后校验并持久化实际提交计划；抽帧或启动失败可原任务恢复，单段提交缺少前段视频时明确报错。
- `src/server/projects/composition.js` — 依赖旧尾帧的视频不能作为当前审核结果合片。
- `src/models/protocols/ssh-media/tail-frame.js`、`tail-frame.py` — 校验原视频路径，在原媒体服务器使用 FFmpeg 提取真正最后一帧，按不可变任务缓存并返回服务器图片 URL。兼容现有 FFmpeg 的 `-vsync 0` 参数。
- `src/models/managers/runtime/index.js`、`src/models/providers/{autodl,runpod}/index.js` — 经现有模型平台边界连接并提取尾帧。
- `src/client/workbench/segment-editor.js`、`production-workflow.js`、`styles.js` — 第二段起显示尾帧开关、来源说明；输入详情展示动态首帧来源，生成详情展示实际首帧及来源版本，旧衔接显示待更新。
- `tests/segment-continuity.test.js`、`tests/production-ui.test.js` — 覆盖首段限制、开关持久化、AI 上下文、串行依赖、抽帧/启动失败恢复、冻结计划、单段提交、上游版本变更和 UI。

## 当前项目诊断

`4ba45756` 的 3 个 Segment 各有 2 个分镜，共 6 个。第二段最终 Prompt 明确包含 `Alternating close-ups`，会要求段内切换人物特写，因此画面切换次数不等于 Segment 数量。此前三段都是 t2va，没有用上一段尾帧进行图片约束。仅靠提示词中的 Continuation 不等于实际图像衔接；未逐帧审阅全部成片，其他具体跳变原因未确认。

开关改善段与段之间的起始画面衔接，不取消段内分镜要求，也不保证模型生成的后续画面完全一致。需要同场景连续动作时开启；需要切场景时可保持关闭。修改并保存开关后，按页面流程更新分镜和 H3 输入再提交视频。

## 验收标准核对

| AC | 状态 | 验证方式与证据 |
|----|------|--------------|
| AC-1 | 通过 | 布尔校验及保存测试；浏览器第一段开关数量为 0，第二段显示默认未选中的“使用上一段尾帧”，来源为“书店初遇”。 |
| AC-2 | 通过 | 测试核对前段结束状态进入上下文；即使 AI 返回 t2va，开启时保存 i2va 与 previous_tail 来源，执行前不填图片 URL。 |
| AC-3 | 通过 | 队列测试核对前段完成前不启动后段，后段实际提交 first_frame；单段缺少已审核来源时拒绝。 |
| AC-4 | 通过 | 抽帧和启动失败、恢复及重启测试；实际提交参数与持久化队列完全一致；上游重生成或采用旧版本后标记后段待更新，合片拒绝旧衔接。 |
| AC-5 | 通过 | 220 项插件测试、10 项 Harness 测试通过；构建、Registry 和 git diff --check 通过。Harness 重启至 PID 66754，认证入口刷新后 UI 可见。 |

真实抽帧：来源任务 `4fd61767e1d981c882171c4602f56877`，服务器输出 `elysium/references/4fd61767e1d981c882171c4602f56877/last.png`，700671 字节。源视频最后一帧与 PNG 分别解码为 RGB24，二者 MD5 均为 `ab82b9f5273dabf1b969c8737ec00ffd`。仅运行 FFmpeg 抽帧，没有提交真实视频推理；新的尾帧接续画面效果尚未实测。

验收时另观察到左侧项目列表提示“项目缺少剧集结构”：现有内部自由创作项目 `00000000` 无 episodes，而列表加载在过滤 internal=free 前调用 ensureEpisodes。与本次新增开关无关，未扩展修改该逻辑；当前项目详情与开关验收正常。

## 人工待办

无实施阻塞。现有项目、视频与开关选择未被批量改动；可由用户选定需要连续动作的片段后按原流程重新生成，评估实际衔接效果。
