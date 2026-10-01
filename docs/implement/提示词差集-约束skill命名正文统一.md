# 提示词差集报告

## 字数（改造前 → 改造后）

| 场景 | 请求 | 角色 | 改造前 | 改造后 | 变化 |
|---|---|---|---:|---:|---:|
| episode:regenerate | generation | system | 984 | 938 | -46 |
| episode:regenerate | generation | user | 316 | 316 | 0 |
| episode:regenerate | review | system | 896 | 850 | -46 |
| episode:regenerate | review | user | 337 | 337 | 0 |
| episode:regenerate | revision | system | 1063 | 1017 | -46 |
| episode:regenerate | revision | user | 366 | 366 | 0 |
| outline:regenerate | generation | system | 2943 | 2850 | -93 |
| outline:regenerate | generation | user | 363 | 363 | 0 |
| outline:regenerate | review | system | 2964 | 2871 | -93 |
| outline:regenerate | review | user | 351 | 351 | 0 |
| outline:regenerate | revision | system | 3022 | 2929 | -93 |
| outline:regenerate | revision | user | 390 | 390 | 0 |
| characters:regenerate | generation | system | 2557 | 2548 | -9 |
| characters:regenerate | generation | user | 310 | 310 | 0 |
| characters:regenerate | review | system | 2303 | 2294 | -9 |
| characters:regenerate | review | user | 308 | 308 | 0 |
| characters:regenerate | revision | system | 2636 | 2627 | -9 |
| characters:regenerate | revision | user | 347 | 347 | 0 |
| scenes:regenerate | generation | system | 1648 | 1639 | -9 |
| scenes:regenerate | generation | user | 310 | 310 | 0 |
| scenes:regenerate | review | system | 1633 | 1624 | -9 |
| scenes:regenerate | review | user | 308 | 308 | 0 |
| scenes:regenerate | revision | system | 1727 | 1718 | -9 |
| scenes:regenerate | revision | user | 347 | 347 | 0 |
| shots:regenerate | generation | system | 6048 | 5959 | -89 |
| shots:regenerate | generation | user | 786 | 786 | 0 |
| shots:regenerate | review | system | 929 | 929 | 0 |
| shots:regenerate | review | user | 4451 | 4362 | -89 |
| shots:regenerate | revision | system | 6127 | 6038 | -89 |
| shots:regenerate | revision | user | 831 | 831 | 0 |
| seconds-all:regenerate | generation | system | 7692 | 7538 | -154 |
| seconds-all:regenerate | generation | user | 902 | 902 | 0 |
| seconds-all:regenerate | review | system | 930 | 930 | 0 |
| seconds-all:regenerate | review | user | 5292 | 5138 | -154 |
| seconds-all:regenerate | revision | system | 7771 | 7617 | -154 |
| seconds-all:regenerate | revision | user | 947 | 947 | 0 |
| seconds-shot:regenerate | generation | system | 7692 | 7538 | -154 |
| seconds-shot:regenerate | generation | user | 636 | 636 | 0 |
| seconds-shot:regenerate | review | system | 930 | 930 | 0 |
| seconds-shot:regenerate | review | user | 5026 | 4872 | -154 |
| seconds-shot:regenerate | revision | system | 7771 | 7617 | -154 |
| seconds-shot:regenerate | revision | user | 681 | 681 | 0 |
| shot-revise:regenerate | generation | system | 1606 | 1606 | 0 |
| shot-revise:regenerate | generation | user | 585 | 585 | 0 |
| shot-revise:regenerate | review | system | 929 | 929 | 0 |
| shot-revise:regenerate | review | user | 1203 | 1203 | 0 |
| shot-revise:regenerate | revision | system | 1685 | 1685 | 0 |
| shot-revise:regenerate | revision | user | 630 | 630 | 0 |
| storyboard-text:regenerate | generation | system | 13362 | 12936 | -426 |
| storyboard-text:regenerate | generation | user | 995 | 995 | 0 |
| storyboard-text:regenerate | review | system | 930 | 930 | 0 |
| storyboard-text:regenerate | review | user | 8697 | 8271 | -426 |
| storyboard-text:regenerate | revision | system | 13441 | 13015 | -426 |
| storyboard-text:regenerate | revision | user | 1040 | 1040 | 0 |
| storyboard-reference:regenerate | generation | system | 13362 | 12936 | -426 |
| storyboard-reference:regenerate | generation | user | 1013 | 1013 | 0 |
| storyboard-reference:regenerate | review | system | 930 | 930 | 0 |
| storyboard-reference:regenerate | review | user | 8832 | 8406 | -426 |
| storyboard-reference:regenerate | revision | system | 13441 | 13015 | -426 |
| storyboard-reference:regenerate | revision | user | 1058 | 1058 | 0 |
| episode:modify | generation | system | 1063 | 1017 | -46 |
| episode:modify | generation | user | 373 | 373 | 0 |
| episode:modify | review | system | 905 | 859 | -46 |
| episode:modify | review | user | 399 | 399 | 0 |
| episode:modify | revision | system | 1063 | 1017 | -46 |
| episode:modify | revision | user | 383 | 383 | 0 |
| outline:modify | generation | system | 3022 | 2929 | -93 |
| outline:modify | generation | user | 408 | 408 | 0 |
| outline:modify | review | system | 2974 | 2881 | -93 |
| outline:modify | review | user | 434 | 434 | 0 |
| outline:modify | revision | system | 3022 | 2929 | -93 |
| outline:modify | revision | user | 427 | 427 | 0 |
| characters:modify | generation | system | 2636 | 2627 | -9 |
| characters:modify | generation | user | 1987 | 1987 | 0 |
| characters:modify | review | system | 2313 | 2304 | -9 |
| characters:modify | review | user | 2013 | 2013 | 0 |
| characters:modify | revision | system | 2636 | 2627 | -9 |
| characters:modify | revision | user | 364 | 364 | 0 |
| scenes:modify | generation | system | 1727 | 1718 | -9 |
| scenes:modify | generation | user | 1918 | 1918 | 0 |
| scenes:modify | review | system | 1643 | 1634 | -9 |
| scenes:modify | review | user | 1944 | 1944 | 0 |
| scenes:modify | revision | system | 1727 | 1718 | -9 |
| scenes:modify | revision | user | 364 | 364 | 0 |
| shots:modify | generation | system | 6127 | 6038 | -89 |
| shots:modify | generation | user | 854 | 854 | 0 |
| shots:modify | review | system | 929 | 929 | 0 |
| shots:modify | review | user | 4527 | 4438 | -89 |
| shots:modify | revision | system | 6127 | 6038 | -89 |
| shots:modify | revision | user | 847 | 847 | 0 |
| seconds-all:modify | generation | system | 7771 | 7617 | -154 |
| seconds-all:modify | generation | user | 983 | 983 | 0 |
| seconds-all:modify | review | system | 930 | 930 | 0 |
| seconds-all:modify | review | user | 5381 | 5227 | -154 |
| seconds-all:modify | revision | system | 7771 | 7617 | -154 |
| seconds-all:modify | revision | user | 963 | 963 | 0 |
| seconds-shot:modify | generation | system | 7771 | 7617 | -154 |
| seconds-shot:modify | generation | user | 682 | 682 | 0 |
| seconds-shot:modify | review | system | 930 | 930 | 0 |
| seconds-shot:modify | review | user | 5080 | 4926 | -154 |
| seconds-shot:modify | revision | system | 7771 | 7617 | -154 |
| seconds-shot:modify | revision | user | 697 | 697 | 0 |
| shot-revise:modify | generation | system | 1685 | 1685 | 0 |
| shot-revise:modify | generation | user | 626 | 626 | 0 |
| shot-revise:modify | review | system | 929 | 929 | 0 |
| shot-revise:modify | review | user | 1252 | 1252 | 0 |
| shot-revise:modify | revision | system | 1685 | 1685 | 0 |
| shot-revise:modify | revision | user | 653 | 653 | 0 |
| storyboard-text:modify | generation | system | 13441 | 13015 | -426 |
| storyboard-text:modify | generation | user | 1117 | 1117 | 0 |
| storyboard-text:modify | review | system | 930 | 930 | 0 |
| storyboard-text:modify | review | user | 8827 | 8401 | -426 |
| storyboard-text:modify | revision | system | 13441 | 13015 | -426 |
| storyboard-text:modify | revision | user | 1056 | 1056 | 0 |
| storyboard-reference:modify | generation | system | 13441 | 13015 | -426 |
| storyboard-reference:modify | generation | user | 1135 | 1135 | 0 |
| storyboard-reference:modify | review | system | 930 | 930 | 0 |
| storyboard-reference:modify | review | user | 8962 | 8536 | -426 |
| storyboard-reference:modify | revision | system | 13441 | 13015 | -426 |
| storyboard-reference:modify | revision | user | 1074 | 1074 | 0 |
| episode:new | generation | system | 984 | 938 | -46 |
| episode:new | generation | user | 340 | 340 | 0 |
| episode:new | review | system | 896 | 850 | -46 |
| episode:new | review | user | 361 | 361 | 0 |
| episode:new | revision | system | 1063 | 1017 | -46 |
| episode:new | revision | user | 404 | 404 | 0 |
| outline:en | generation | system | 2934 | 2841 | -93 |
| outline:en | generation | user | 363 | 363 | 0 |
| outline:en | review | system | 2955 | 2862 | -93 |
| outline:en | review | user | 351 | 351 | 0 |
| outline:en | revision | system | 3013 | 2920 | -93 |
| outline:en | revision | user | 390 | 390 | 0 |
| storyboard:plain | generation | system | 12779 | 12353 | -426 |
| storyboard:plain | generation | user | 866 | 866 | 0 |
| storyboard:plain | review | system | 347 | 347 | 0 |
| storyboard:plain | review | user | 8568 | 8142 | -426 |
| storyboard:plain | revision | system | 12858 | 12432 | -426 |
| storyboard:plain | revision | user | 911 | 911 | 0 |
| edited:storyboard | review | system | 930 | 930 | 0 |
| edited:storyboard | review | user | 7896 | 7470 | -426 |
| edited:outline | review | system | 2963 | 2870 | -93 |
| edited:outline | review | user | 391 | 391 | 0 |
| image-prompt | generation | system | 399 | 399 | 0 |
| image-prompt | generation | user | 25 | 25 | 0 |
| image-prompt | review | system | 347 | 347 | 0 |
| image-prompt | review | user | 183 | 183 | 0 |
| image-prompt | revision | system | 478 | 478 | 0 |
| image-prompt | revision | user | 70 | 70 | 0 |
| image:character | prompt | prompt | 168 | 168 | 0 |
| image:scene | prompt | prompt | 1192 | 1150 | -42 |
| image:part | prompt | prompt | 158 | 158 | 0 |
| image:pencil | prompt | prompt | 446 | 439 | -7 |

## 全局删除（改造后任何请求都不再出现的句子）

### 旧章节标题（按字段重组，改用来源标题）（37）

- ## 创作本集摘要　〔9 处，如 episode:regenerate/generation〕
- ## 保持前后集衔接　〔9 处，如 episode:regenerate/generation〕
- ## 写清本集剧情　〔9 处，如 episode:regenerate/generation〕
- ## 控制时长与篇幅　〔9 处，如 episode:regenerate/generation〕
- ### 故事大纲　〔10 处，如 outline:regenerate/generation〕
- ## 动作要求　〔44 处，如 outline:regenerate/generation〕
- ## 武术要求　〔44 处，如 outline:regenerate/generation〕
- ## 台词要求　〔44 处，如 outline:regenerate/generation〕
- ## 表情要求　〔44 处，如 outline:regenerate/generation〕
- ## 声音要求　〔44 处，如 outline:regenerate/generation〕
- ### 角色卡　〔6 处，如 characters:regenerate/generation〕
- ### 场景卡　〔6 处，如 scenes:regenerate/generation〕
- ### 事件与切镜　〔6 处，如 shots:regenerate/generation〕
- ### 景别与环境叙事　〔6 处，如 shots:regenerate/generation〕
- ### 视频片段边界　〔6 处，如 shots:regenerate/generation〕
- ### 状态与身份交接　〔6 处，如 shots:regenerate/generation〕
- ## 每段必须交代的内容　〔12 处，如 seconds-all:regenerate/generation〕
- ## 人物朝向与可见面　〔12 处，如 seconds-all:regenerate/generation〕
- ## 行进中的正反面机位切换　〔12 处，如 seconds-all:regenerate/generation〕
- ## 人物与机位连续性　〔12 处，如 seconds-all:regenerate/generation〕
- ### 景别与画面占比　〔12 处，如 seconds-all:regenerate/generation〕
- ## 剧情与视觉细节　〔12 处，如 seconds-all:regenerate/generation〕
- ## 整集上下文与开场衔接　〔16 处，如 storyboard-text:regenerate/generation〕
- ## 朝向优先于参考人像姿态　〔16 处，如 storyboard-text:regenerate/generation〕
- ## 行进中的机位转换　〔16 处，如 storyboard-text:regenerate/generation〕
- ### 剧情与时间线　〔16 处，如 storyboard-text:regenerate/generation〕
- ### 人物、空间与机位　〔16 处，如 storyboard-text:regenerate/generation〕
- ### 切镜后的状态与背景朝向　〔16 处，如 storyboard-text:regenerate/generation〕
- ### 构图保真　〔16 处，如 storyboard-text:regenerate/generation〕
- ### 图片与主体绑定　〔16 处，如 storyboard-text:regenerate/generation〕
- ### 关键帧与中途人物　〔16 处，如 storyboard-text:regenerate/generation〕
- ### 开场与氛围　〔16 处，如 storyboard-text:regenerate/generation〕
- ## 场景状态　〔1 处，如 image:scene/prompt〕
- ## 空间布局　〔1 处，如 image:scene/prompt〕
- ## 方向与视角　〔1 处，如 image:scene/prompt〕
- ## 构图与纵深　〔1 处，如 image:scene/prompt〕
- ## 画面内容　〔1 处，如 image:scene/prompt〕

### 其他（需人工确认）（7）

- 具体分段与时长由镜头表结合场景变化、动作和状态连续性规划，每秒分镜再安排片段内部调度。　〔10 处，如 outline:regenerate/generation〕
- 标题和条目用于阅读，程序不按这些标签解析或校验字段。　〔12 处，如 seconds-all:regenerate/generation〕
- 此规则适用于文本分镜的所有自然语言正文，包括主体定义、摘要、保留分析、动作、机位和声音描述。　〔16 处，如 storyboard-text:regenerate/generation〕
- 协议段落标题、`<Subject N>`、`<Picture N>`、`[Shot N]`、保留状态枚举及 `N/A` 不翻译。　〔16 处，如 storyboard-text:regenerate/generation〕
- 既有台词、歌词和画面文字保持原文，中文对白注明 Mandarin Chinese，英文对白注明 English。　〔16 处，如 storyboard-text:regenerate/generation〕
- 项目采用自由文本、程序固定素材顺序、配置语言、按同框计人数、定向修订与独立语义审核。　〔16 处，如 storyboard-text:regenerate/generation〕
- 该图仅供审稿，最终视频必须剥离全部线稿、标签、箭头和时间码。　〔1 处，如 image:pencil/prompt〕

### 重复的语言规则（统一为共享模块「语言」与代码注入的本次生成语言）（2）

- 语言：读取项目 `outputLanguage`，遵循注入的“本次生成语言”：中文配置生成简体中文，英文配置生成英文，未配置默认简体中文。　〔16 处，如 storyboard-text:regenerate/generation〕
- `outputLanguage` 仍决定新对白语言；　〔16 处，如 storyboard-text:regenerate/generation〕

## 按请求移出（仍在其他请求或场景中）

| 场景 | 请求 | 角色 | 句数 |
|---|---|---|---:|

## 人工核对结论

- 37 项旧章节标题只用于展示，删除后对应生产条目全部保留。
- 大纲的下游分工句、每秒指令的解析说明、文本分镜的项目架构概述：属于程序用途介绍，删除；相应阶段边界与输出协议仍保留。
- 文本分镜旧配置读取说明：改为直接执行本次指定语言，实际配置语言由 Model 注入；全体自然语言、新对白、既定原文、固定协议及引用标签的要求在新正文与语言编排中保留。
- 铅笔分镜：只删除“该图仅供审稿”的用途短语，逐秒覆盖、可读布局、身份空间一致及最终视频剥离标记要求保留。
- 人物图：年龄章节变为条件句；接口仍按年龄选择分支，未成年人/未知年龄不注入成年服装规则。

46 项移除均有明确去向或理由，无未确认生产规则丢失。
