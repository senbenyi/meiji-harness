# ComfyUI 接入评估调研

## 结论
- AC-1 — 已确认 — meiji 现在已经间接使用 ComfyUI：网关 `elysium-image` / `elysium-video` 由网关内部工作流执行（接口文档写明「工作流固定使用 25 步」「视频固定 24 fps、8 步、帧数 17k+5」「响应不包含 ComfyUI 地址」）。meiji 直连 ComfyUI 的代码已于 2026-10-01（44cb7d1）删除。
- AC-2 — 已确认 — 文本类步骤（摘要、大纲、人物/场景/道具提取、镜头表、每秒指令、文本分镜审核）不适合 ComfyUI。
- AC-3 — 已确认 — 图片类步骤（人物图、场景图、附属素材图、铅笔分镜）最适合用 ComfyUI 工作流增强，主要收益是角色一致性、可控构图和稳定复现。
- AC-4 — 未验收 — 成片可用 ComfyUI 视频工作流，但当前网关视频已是工作流实现；是否换模型需要实测画质与时长，不能从代码判断。
- AC-5 — 已确认 — 建议继续以网关为唯一接入点，在网关侧增加工作流与参数，meiji 只改请求字段；不恢复 meiji 直连。

## 规格
- 目标：判断 ComfyUI 能用在 meiji 现有任务的哪些步骤、收益与代价，以及接入方式。
- 非目标：不实施；不评估具体模型画质（需真实出图）。
- 验收标准：AC-1 现状；AC-2/3/4 逐步骤可用性；AC-5 接入方式建议。

## 现状调用链
- 图片：`flow/operations/images.js` → `generate/image.js`（`submitAssetImage` / `generateStillFile` / `submitPencilBoard`）→ `generate/gateway.js:generateGatewayImage`：无参考图走 `/v1/images/generations`（可带 seed），有参考图走 `/v1/images/edits`（multipart，1–10 张，不接受 seed）→ 下载 URL 转 Base64 → 保存候选 → 人工确认。
- 视频：`flow/operations/films.js` → `generate/film.js:submitH3` → `gateway.js` `/v1/videos`；meiji 只用 `reference_images`（最多 9 张）或 `input_reference`（上一镜尾帧作首帧）；未使用网关已支持的 `last_frame`、`reference_videos`、`reference_audios`。
- 尾帧与合成：本地 FFmpeg。

## 逐步骤评估
| 步骤 | 现在 | ComfyUI 是否适合 | 可带来的改进 | 代价/风险 |
|---|---|---|---|---|
| 剧集摘要、大纲、人物/场景/道具提取、镜头表、每秒指令、文本分镜审核 | 网关文本模型 | 不适合 | — | — |
| 文本分镜（最终视频提示词） | 程序编译 | 不需要 | — | — |
| 人物参考图（文字生图） | `images/generations`，固定 25 步 | 适合，收益最大 | 固定角色 LoRA 或身份类节点（如 IPAdapter、InstantID、PuLID）锁脸；灰白背景、全身正面等规范由工作流固定；同一 seed 复现 | 需要准备模型与节点；每角色 LoRA 需训练时间 |
| 人物参考图（参考图生图、按意见修改） | `images/edits` 多参考图 | 适合 | 局部重绘（mask）只改服装或发型，不重画脸；编辑类模型做「保持主体」修改 | 当前 edits 不接受 seed 和 mask，需网关加字段 |
| 附属素材图（服装、道具、发型、坐骑） | 同上 | 适合 | 道具白底产品图、服装平铺图模板化；可与人物图做换装合成 | 低 |
| 场景参考图 | 文字生图/编辑 | 适合 | ControlNet（深度、线稿）固定空间布局，多机位同一场景保持地标位置；无人约束由工作流负向/检测保证 | 需要布局草图或深度图来源 |
| 铅笔分镜 | 文字生图 | 很适合 | 线稿风格 LoRA 或 lineart 预处理；以人物/场景参考图 + 姿态（OpenPose）控制构图，和每秒指令机位对应 | 需要从每秒指令生成姿态/构图输入，开发量中等 |
| 成片 | 网关视频工作流，参考图或首帧 | 可以，但需实测 | 首尾帧同时约束（`last_frame` 网关已支持，meiji 未用）；主体参考视频模型锁角色；按镜头换工作流 | GPU 时长与画质需对比；网关体积 64 MiB 上限 |
| 尾帧提取、全片合成 | FFmpeg | 不需要 | 可选：工作流做插帧、超分、调色统一 | 增加耗时 |
| 新增：图片自动检查 | 无（人工确认） | 适合做辅助 | 人脸相似度比对人物图与已确认主图；场景图人体检测，作为程序自审 | 需要阈值调优，只能辅助人工 |

## 接入方式比较
| 方式 | 说明 | 优点 | 缺点 |
|---|---|---|---|
| A. 网关侧扩展（推荐） | 在网关增加工作流或新模型名（如人物锁脸、局部重绘、铅笔线稿），开放 seed、mask、control 图等字段；meiji 只改 `gateway.js` 请求字段与提示词 | 维持现有鉴权、限流、媒体存储、任务记录；meiji 已有完整步骤与回退逻辑 | 需改网关代码与接口文档 |
| B. meiji 直连 ComfyUI | 恢复 44cb7d1 前的 `/prompt` 提交 + `/history` 轮询 + `/view` 下载 | 不依赖网关排期，可直接试工作流 | 重复实现队列、重提保护、取消与存储；之前已因隐式回退问题删除；本地需 GPU |

## 证据
| 来源 | 支持的结论 |
|---|---|
| `下游接入接口文档.md` §6.1、§7.1 | 图片工作流固定 25 步；视频 24 fps、8 步、帧数 17k+5；响应不含 ComfyUI 地址（AC-1） |
| `下游接入接口文档.md` §6.2 | edits 只接受 model/prompt/size/image[]，其他字段 400（AC-3 代价） |
| `下游接入接口文档.md` §7.1–7.2 | 网关支持 `last_frame`、`reference_videos`、`reference_audios`（AC-4） |
| `meiji/server/generate/gateway.js:197–222, 257–286` | meiji 生图分 generations/edits、视频只用 reference_images 或 input_reference |
| `git show 44cb7d1 -- meiji/server/generate/image.js` | 已删除的直连实现：RealVisXL 检查点、30 步、img2img denoise 0.55、journal 防重提（AC-5 B） |
| `.agents/architecture.md:151` | 「删除缺密钥时的 ComfyUI 隐式回退」 |
| `meiji/config/models.json` | 当前文本/图片/视频都走同一网关 |

## 建议顺序
1. 人物图锁脸（收益最大）：网关增加人物参考工作流，meiji 人物图「参考图生图」改用它。
2. 局部修改：网关 edits 增加 mask（或单独编辑模型），meiji 服装/发型修改只重绘局部。
3. 铅笔分镜：线稿风格 + 人物/场景参考，构图对应每秒指令机位。
4. 成片首尾帧：meiji 对需要强连续的镜头同时传上一镜尾帧与本镜目标尾帧（网关已支持），先做小范围实测。
5. 图片程序自审：人脸相似度、场景无人检测，作为人工确认前的提示。

## 待用户决定
1. 接入方式：网关侧扩展（推荐）还是 meiji 直连 ComfyUI？
2. 是否有可用的 ComfyUI 机器与 GPU、以及允许安装的模型和节点（决定 1–3 项能否做）。
3. 先做哪一项（建议从人物图锁脸开始）。
