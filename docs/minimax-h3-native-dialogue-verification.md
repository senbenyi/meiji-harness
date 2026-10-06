# MiniMax H3 分镜对白与视频原生音频修复记录

## 已实施

- `lib/prompts/compiler.js`：读取 Shot 的 `audioDialogue`、`audioNotes`；r2v/i2v 将具体对白、稳定说话人和声音要求写入 H3 对应段落；结构化 prompt 补齐缺失对白但不重复注入；明确静音时禁用声音；图片生成不接收语音指令。
- `lib/domain/read-models.js`：分镜正文显示画面、对白和声音备注；分镜与生成视频采用不同节点 ID，保存兼容画布后仍保留分镜正文。
- `lib/index.js`、`lib/guidance.js`、`lib/compat/legacy-canvas-adapter.js`：默认原生音频，工具支持 native；生产指引要求逐镜具体台词与声音备注，由视频模型同时生成声音。
- 短剧、3D 动画、品牌片 Skill 和 H3 映射参考：明确对白属于分镜，视频生成原生声音，不增加独立旁白或配音步骤。四个安装 Skill 已同步，内容 hash 一致。
- `studio/stages.js`：步骤名为“视频”，独立音频、旁白文本不能归入视频；明确阶段字段同样遵循视频类型约束。
- `studio/app.js`、`studio/index.html`：默认音频展示与后端一致，升级脚本和阶段模块版本；保留空画布空白行为。
- `tests/studio/h3-native-dialogue.test.js`、`tests/domain/script-development.test.js`：增加对白落库、编译、画布留存、原生音频图连接及视频分类回归。

## 验证结果

- 当前聚焦检查 29 项通过、0 失败、0 跳过，包含实际本地 MP4 拼接及音轨探测。
- 当前 `npm run smoke:all` 通过；`git diff --check` 通过。
- 两个活动 H3 工作流的全部 fast/balanced/quality 档位：最终 graph 含具体对白，`VAEDecodeAudio` 连入 `CreateVideo` 并由 `SaveVideo` 保存。
- 安装副本的插件模块及依赖可导入；安装副本提示词和画布正文均保留“小狐狸：我要当宇航员！”；四个安装 Skill 内容 hash 与源码一致。
- Chrome 打开当前本地 DSH 服务页面，使用模拟画布 API 数据验证：视频步骤仅出现视频节点，分镜对白可见，空画布无占位内容，浏览器无 JavaScript 异常。

## 当前限制与并行改动

- 实施期间仓库出现其他提交、文件恢复及生产流程门禁修改。保留这些修改，没有回滚或覆盖其功能。
- 最新全量 `npm run test:all` 为 92 项中 75 通过、17 失败。17 项失败均在新增生产门禁处抛出 `production stages blocked`，旧夹具缺少已批准分析、正式剧本、参考素材或分镜图；本次对白与画布聚焦测试全部通过。没有关闭门禁来使全量测试通过。
- 未执行远端 H3 真实生成，未验证实际语音内容、说话人声音或口型；本地拼接和生成图连接检查不等同于远端实机验证。
- 本地服务检查发现两个活跃媒体 Attempt/生产任务。安装文件已更新，正在运行的后端进程仍需重新加载才能使用新模块；没有中断当前生成任务。
- 当前另一项并行修改将正式 Shot 文本投影放在分集剧本阶段，并为分镜图使用单独的图片准备流程。本次保留该阶段职责，只保证具体对白存在于 Shot 正文且不被归入视频或独立旁白。
