# MiniMax H3 原生对白：契约与实施记录

> 状态：已实施；远端语音内容和口型尚未实机验证。

## 契约

流程为：含对白分镜 → Proposal 批准并保存 Shot → 编译 H3 prompt → H3 同时生成画面和声音 → 保存带原生音轨视频 → 拼接保留音轨 → 画布“视频”阶段展示。

- Shot 使用现有 `audioDialogue`、`audioNotes`，不新增旁白数据模型。
- 有对白时保留原文、说话人和声音要求；无对白可仅有环境声；明确静音时不得补声音。
- r2v/i2v 都把对白写进 H3 对应结构段；已结构化 prompt 只补缺失内容，不重复注入。
- 分镜正文展示画面、对白与声音备注；视频与分镜使用不同节点 ID。
- 画布阶段名为“视频”，独立音频或旁白文本不计入视频产物；空步骤不生成占位。
- 活动 H3 workflow 的 `VAEDecodeAudio` 必须连接 `CreateVideo.audio`，再由 `SaveVideo` 保存。
- concat 保留和重定时音轨；本功能不重写已有音频图或拼接器。

## 实施范围

- `lib/prompts/compiler.js` 接入对白、说话人与声音备注。
- `lib/domain/read-models.js` 投影分镜正文并隔离分镜/视频节点。
- `lib/index.js`、`lib/guidance.js`、legacy adapter 将 native 设为默认并允许显式静音。
- 短剧、3D、品牌片 Skill 与 H3 mapping 使用同一原生音频契约，不增加独立配音步骤。
- `studio/stages.js`、`studio/app.js`、`studio/index.html` 对齐“视频”分类和默认展示。
- 回归覆盖对白落库、r2v/i2v 编译、结构化 prompt 去重、画布留存、原生音频连线与视频分类。

## 验证结果

- 聚焦检查 29 项通过，包含本地 MP4 拼接与音轨探测。
- 当时 `npm run smoke:all` 与 `git diff --check` 通过。
- 两个活动 H3 family 的 fast/balanced/quality 图都含对白，音频解码连接视频保存。
- 安装副本模块可导入，四个安装 Skill 与源码 hash 一致。
- Chrome 模拟画布验证：视频阶段只出现视频节点，分镜对白可见，空画布无占位，控制台无异常。

## 边界

- 当时全量测试 92 项中 17 项因新增生产门禁和旧夹具缺正式前置数据而失败；对白聚焦测试全部通过，未为绿灯关闭门禁。
- 未执行远端 H3 真实生成，不能声称语音内容、说话人音色或口型通过。
- 安装文件已更新，但运行中的后端需重新加载；当时存在活跃媒体任务，因此没有强制重启。
- 后续正式 Shot 投影与分镜图生产调整保留各自职责；本契约只保证对白留存在 Shot，且不被误归类为视频或独立旁白。

