# Segment 尾帧衔接

- 类型：新功能
- 目标：第二段起可选择使用上一段视频尾帧作为首帧，支持全量串行和当前片段提交，并说明段内切镜的来源。
- 调研：当前 `4ba45756` 三段各有两个分镜，第二段为特写交替；三个最终输入均为 t2va。`segment-queue.js` 已严格串行，但各段 plan 独立。`startVideoJob` 要求实际计划与持久化队列一致。现有 ComfyUI 抽帧需要显式帧号及排队，本次用媒体服务器 FFmpeg 精确解码尾部提取最后一帧。

## 人工决策

无。开关默认关闭，避免改变现有项目及跨场景创作意图。首段不显示开关；不重新生成用户现有视频。

## 执行步骤

1. 数据与 UI：修改 `dsh-elysium/src/database/schemas/production.js`、`src/server/projects/production.js`、`src/client/workbench/{segment-editor,production-workflow,styles}.js`，保存 use_previous_tail、展示前段来源、传入 AI 上下文和生成说明，H3 输入记录动态首帧来源。→ AC-1/2
2. 执行：新增 `src/models/protocols/ssh-media/tail-frame.{js,py}`，经 `models/managers/runtime/index.js` 和 AutoDL/Runpod provider 调用；修改 `server/projects/segment-queue.js`，冻结来源视频身份、上一段完成后提取尾帧、校验并持久化实际 i2va plan 后启动；失败可恢复同任务。→ AC-3/4
3. 来源变更：在上游采用新视频时标记沿用尾帧的后续段需更新；UI/合片拒绝把旧衔接误当当前完成。→ AC-4
4. 验证与交付：补充 production、UI、远端抽帧测试；完整测试、构建、Registry；运行中的 AI/视频任务完成后刷新 Harness 加载新版本。→ AC-5

## 验收标准

- AC-1：首段不能开启；后续段可开启/关闭并随快照保存，旧数据默认关闭。
- AC-2：分镜/H3 生成能看到开关和前段描述；开启时 H3 输入标明前段尾帧，不要求 AI 伪造图片 URL。
- AC-3：全量队列等待前段成功再抽帧并以 i2va 启动后段；单段缺少可用前段视频时明确报错；关闭保持原行为。
- AC-4：实际首帧、来源视频版本持久化；失败/重启复用，不能回退为 t2va；上游版本改变后标记依赖视频需更新。
- AC-5：测试与构建通过；真实抽帧验证得到前段视频最后一帧；界面可见新选项。新视频画面衔接效果不在没有生成对照的情况下声称已验收。

## 验证结果

2026-09-19 已完成 AC-1～AC-5：220 项插件测试、10 项 Harness 测试、构建和 Registry 打包通过；真实服务器抽帧与源视频最后一帧解码像素一致。Harness 已重启，浏览器确认第一段不显示开关、第二段显示默认关闭的“使用上一段尾帧”。未重新生成真实视频，视觉衔接改善程度未验收。详情见 `docs/implement/实施-Segment尾帧衔接.md`。
