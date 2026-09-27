# H3 官方 skill 与模板参考库

来源：[MiniMax-AI/MiniMax-H3](https://github.com/MiniMax-AI/MiniMax-H3)。归档日期：2026-09-27。

固定提交：`d21241f0a4b3acbb34c97dae47fa417b7065e438`。
本目录完整保存该提交下的 `skills/`：9 套 skill、36 个文件，含官方提供的中文版本、引用模板及元数据。所有文件均从固定提交下载，已核对 Git blob SHA；逐文件地址、校验值见 [manifest.json](manifest.json)。没有中文版本的文件保留官方原文，不将自行翻译冒充官方版本。

本目录供查阅，不注册或自动注入 Meiji。实际运行使用 `../meiji/skills/` 中的项目适配规则：设置决定生成语言，镜头表、每秒指令和文本分镜分阶段生成。官方原文中的英文输出、动画风格、画布操作或合并阶段要求，不自动覆盖项目规则。更新参考时记录新提交，不混淆官方原文和本地适配。

## 全部 skill

| 用途 | 英文原文 | 官方中文版本 |
|---|---|---|
| 叙事动画完整制作流程 | [3d-animation-short-generator](skills/3d-animation-short-generator/SKILL.md) | [中文](skills/3d-animation-short-generator/SKILL.cn.md) |
| H3 通用视频提示词 | [h3-prompt-writing](skills/h3-prompt-writing/SKILL.md) | 未提供 |
| 品牌宣传视频 | [brand-promo-video-generator](skills/brand-promo-video-generator/SKILL.md) | [中文](skills/brand-promo-video-generator/SKILL.cn.md) |
| 合作游戏开场 | [co-op-game-intro-generator](skills/co-op-game-intro-generator/SKILL.md) | [中文](skills/co-op-game-intro-generator/SKILL.cn.md) |
| 手绘与实拍融合视频 | [handdrawn-live-video-generator](skills/handdrawn-live-video-generator/SKILL.md) | [中文](skills/handdrawn-live-video-generator/SKILL.cn.md) |
| 极简产品广告 | [minimalist-product-ad-generator](skills/minimalist-product-ad-generator/SKILL.md) | [中文](skills/minimalist-product-ad-generator/SKILL.cn.md) |
| 音乐与字幕视频 | [music-video-subtitle-generator](skills/music-video-subtitle-generator/SKILL.md) | [中文](skills/music-video-subtitle-generator/SKILL.cn.md) |
| 纸张拼贴解说 | [paper-collage-explainer-generator](skills/paper-collage-explainer-generator/SKILL.md) | [中文](skills/paper-collage-explainer-generator/SKILL.cn.md) |
| 纸艺定格解说 | [papercraft-stop-motion-explainer](skills/papercraft-stop-motion-explainer/SKILL.md) | [中文](skills/papercraft-stop-motion-explainer/SKILL.cn.md) |

## 提示词及返回模板入口

| 要查的内容 | 对应原文 |
|---|---|
| 六列镜头表、每秒指令五要素、镜头表自检 | [shot-table-spec.md](skills/3d-animation-short-generator/references/shot-table-spec.md) |
| 每镜 Markdown 返回骨架、空间锚点、分时段条目及 ASCII 样本 | [storyboard-guidelines.md](skills/3d-animation-short-generator/references/storyboard-guidelines.md) |
| 文生、首帧、首尾帧、尾帧视频提示词和返回示例 | [base-en.txt](skills/h3-prompt-writing/references/base-en.txt) |
| 多模态六段返回结构、Subject/Picture 绑定、保留分析及完整示例 | [ref-en.txt](skills/h3-prompt-writing/references/ref-en.txt) |
| 游戏开场确认图提示词模板 | [h3-confirmation-image-template.md](skills/co-op-game-intro-generator/references/h3-confirmation-image-template.md) |
| 游戏开场视频提示词模板 | [h3-video-prompt-template.md](skills/co-op-game-intro-generator/references/h3-video-prompt-template.md) |
| 模型选择及不同模型的提示词处理 | [model-selection.md](skills/3d-animation-short-generator/references/model-selection.md) |
| 失败处理、重试与降级规则 | [fallback-policy.md](skills/3d-animation-short-generator/references/fallback-policy.md) |
| 成片检查与交付 | [qc-checklist.md](skills/3d-animation-short-generator/references/qc-checklist.md) |

其余专用视频的提示词组织方式、输出规则和样本包含在各自 `SKILL.md` / `SKILL.cn.md` 内，并非全部另设模板文件。参照完整原文阅读前置条件，不把某一类广告、动画或音乐视频的模板当作所有剧情的共同规则。

## 当前项目的镜头表模板

[项目镜头表 skill](../meiji/skills/skill-jingtou-jingtoubiao-table-generate.md) 中的“输出模板”是当前运行格式：`## S01 / 12s` 标题后接叙事任务、起始状态、出镜人物、场景空间、机位构图、切镜理由、声音、结束状态等自由文本条目。程序只读取标题中的编号和时长，不要求正文 JSON。
