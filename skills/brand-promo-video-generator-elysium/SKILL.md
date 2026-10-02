---
name: brand-promo-video-generator-elysium
description: 使用当前项目已验证的 Elysium 图片与视频工作流制作品牌、产品、网站或个人项目宣传短片。
trigger: 用户要求把可核验的品牌素材和传播目标制作成宣传短片时使用。
---

# 品牌宣传短片（Elysium）

## 硬边界

- 只使用 `elysium-qwen-image-21-{t2i,i2i}-*` 与 `elysium-minimax-h3-{ref2v,i2v}-*`。
- 每种 capability 首次生成前调用 `comfy_list_workflows`；解析结果必须以 `elysium-` 开头，否则停止并报告配置错误。
- H3 prompt 只委托 `h3-prompt-writing-elysium`。
- 当前 Elysium 视频清单不支持 `continuity_from`；当前活动注册表也没有抽帧和视频超分。不得调用或承诺这些能力。
- 不伪造品牌标识、界面、包装或产品声明。身份资产缺少授权原件时，必须降级为不带真实标识的概念表达。

## 能力对应

| 任务 | 调用 |
| --- | --- |
| 氛围板、概念场景、非身份静帧 | `comfy_generate_image` |
| 授权素材的受控改绘 | `comfy_render(capability='image.image2image', ref_nodes=[...])` |
| 产品/角色参考绑定视频 | `comfy_generate_video(type='r2v', ref_nodes=[...])` |
| 用已有静帧锁定首帧或首末帧 | `comfy_generate_video(type='i2v', first_frame_node=..., last_frame_node=...)` |
| 成片拼接 | `video_concat` |

## 工作流

### 1. 收集事实与规格

确认：传播目标、受众、平台、总时长、画幅、语言、CTA、必须出现与禁止出现的内容、授权素材及来源。把可核验事实整理为品牌真值表；无法核验的卖点不得写入脚本。

明确生成档位 `fast` / `balanced` / `quality`。逐镜调用必须显式传 `tier`，不要依赖缺省。

### 2. 素材规则

- LOGO、UI、包装和具体产品外观优先使用用户提供的原件。
- 身份资产不得通过文生图重新发明。
- 需要氛围化或风格化处理时，只能对已授权的非标识区域做 i2i，并在 prompt 中明确保留项与允许修改项。
- 素材、来源和使用方式写入来源清单。

### 3. 创意与镜头表

先给出一个主创意方向，经用户批准后再写镜头表。镜头表至少包含：镜号/时长、传播功能、素材锚点、画面和运镜、文案与声音、生成形态。

- `r2v`：需要产品、角色或环境参考绑定的镜头。
- `i2v`：已有批准静帧需要锁定开场或结尾的镜头；不得同时传 `ref_nodes`。
- 连续性依靠一致的素材锚点、构图、色彩、运动方向和声音设计，不声称模型 latent 续接。

镜头表与品牌真值表必须由用户确认后才能生成。

### 4. Prompt 与生成

每镜把镜头表行、授权素材绑定、文案和音频要求交给 `h3-prompt-writing-elysium`，生成相应 Ref2VA 或 I2VA 结构化 prompt。

逐镜执行：

1. 核对解析到的实现属于对应 Elysium 家族。
2. 调用 `comfy_generate_video`，显式传 `type`、`tier`、尺寸/画幅、时长及所需绑定。
3. 如实记录工具返回的实际实现、尺寸、warnings 和失败原因。
4. 单镜失败先修事实、prompt 或素材锚点；禁止原参数盲重试。
5. 每镜经用户批准后再继续；重做后只引用新节点。

### 5. 拼接与交付

全部镜头批准后调用 `video_concat`。终检包括：品牌事实、标识与产品外观、文案字准、镜头顺序、时长、音频接缝、黑帧/重复帧及 CTA。

交付清单必须列出成片节点、镜头节点、素材来源、实际档位和尺寸，以及任何未完成项。不得声称执行过已归档的抽帧、续接或超分工作流。
