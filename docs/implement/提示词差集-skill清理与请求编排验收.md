# 提示词差集报告

## 字数（改造前 → 改造后）

| 场景 | 请求 | 角色 | 改造前 | 改造后 | 变化 |
|---|---|---|---:|---:|---:|
| episode:regenerate | generation | system | 938 | 872 | -66 |
| episode:regenerate | generation | user | 316 | 316 | 0 |
| episode:regenerate | review | system | 850 | 784 | -66 |
| episode:regenerate | review | user | 337 | 337 | 0 |
| episode:regenerate | revision | system | 1017 | 951 | -66 |
| episode:regenerate | revision | user | 366 | 366 | 0 |
| outline:regenerate | generation | system | 2850 | 2611 | -239 |
| outline:regenerate | generation | user | 363 | 363 | 0 |
| outline:regenerate | review | system | 2871 | 2508 | -363 |
| outline:regenerate | review | user | 351 | 351 | 0 |
| outline:regenerate | revision | system | 2929 | 2690 | -239 |
| outline:regenerate | revision | user | 390 | 390 | 0 |
| characters:regenerate | generation | system | 2548 | 2518 | -30 |
| characters:regenerate | generation | user | 310 | 310 | 0 |
| characters:regenerate | review | system | 2294 | 2264 | -30 |
| characters:regenerate | review | user | 308 | 308 | 0 |
| characters:regenerate | revision | system | 2627 | 2597 | -30 |
| characters:regenerate | revision | user | 347 | 347 | 0 |
| scenes:regenerate | generation | system | 1639 | 1639 | 0 |
| scenes:regenerate | generation | user | 310 | 310 | 0 |
| scenes:regenerate | review | system | 1624 | 1624 | 0 |
| scenes:regenerate | review | user | 308 | 308 | 0 |
| scenes:regenerate | revision | system | 1718 | 1718 | 0 |
| scenes:regenerate | revision | user | 347 | 347 | 0 |
| shots:regenerate | generation | system | 5959 | 5959 | 0 |
| shots:regenerate | generation | user | 786 | 786 | 0 |
| shots:regenerate | review | system | 929 | 929 | 0 |
| shots:regenerate | review | user | 4362 | 4362 | 0 |
| shots:regenerate | revision | system | 6038 | 6038 | 0 |
| shots:regenerate | revision | user | 831 | 831 | 0 |
| seconds-all:regenerate | generation | system | 7538 | 7538 | 0 |
| seconds-all:regenerate | generation | user | 902 | 902 | 0 |
| seconds-all:regenerate | review | system | 930 | 930 | 0 |
| seconds-all:regenerate | review | user | 5138 | 5138 | 0 |
| seconds-all:regenerate | revision | system | 7617 | 7617 | 0 |
| seconds-all:regenerate | revision | user | 947 | 947 | 0 |
| seconds-shot:regenerate | generation | system | 7538 | 7538 | 0 |
| seconds-shot:regenerate | generation | user | 636 | 636 | 0 |
| seconds-shot:regenerate | review | system | 930 | 930 | 0 |
| seconds-shot:regenerate | review | user | 4872 | 4872 | 0 |
| seconds-shot:regenerate | revision | system | 7617 | 7617 | 0 |
| seconds-shot:regenerate | revision | user | 681 | 681 | 0 |
| shot-revise:regenerate | generation | system | 4690 | 4690 | 0 |
| shot-revise:regenerate | generation | user | 585 | 585 | 0 |
| shot-revise:regenerate | review | system | 1054 | 1054 | 0 |
| shot-revise:regenerate | review | user | 4162 | 4162 | 0 |
| shot-revise:regenerate | revision | system | 4769 | 4769 | 0 |
| shot-revise:regenerate | revision | user | 630 | 630 | 0 |
| storyboard-text:regenerate | generation | system | 12936 | 12936 | 0 |
| storyboard-text:regenerate | generation | user | 995 | 995 | 0 |
| storyboard-text:regenerate | review | system | 930 | 930 | 0 |
| storyboard-text:regenerate | review | user | 8271 | 8271 | 0 |
| storyboard-text:regenerate | revision | system | 13015 | 13015 | 0 |
| storyboard-text:regenerate | revision | user | 1040 | 1040 | 0 |
| storyboard-reference:regenerate | generation | system | 12936 | 12936 | 0 |
| storyboard-reference:regenerate | generation | user | 1013 | 1013 | 0 |
| storyboard-reference:regenerate | review | system | 930 | 930 | 0 |
| storyboard-reference:regenerate | review | user | 8406 | 8406 | 0 |
| storyboard-reference:regenerate | revision | system | 13015 | 13015 | 0 |
| storyboard-reference:regenerate | revision | user | 1058 | 1058 | 0 |
| episode:modify | generation | system | 1017 | 951 | -66 |
| episode:modify | generation | user | 373 | 373 | 0 |
| episode:modify | review | system | 859 | 793 | -66 |
| episode:modify | review | user | 399 | 399 | 0 |
| episode:modify | revision | system | 1017 | 951 | -66 |
| episode:modify | revision | user | 383 | 383 | 0 |
| outline:modify | generation | system | 2929 | 2690 | -239 |
| outline:modify | generation | user | 408 | 408 | 0 |
| outline:modify | review | system | 2881 | 2518 | -363 |
| outline:modify | review | user | 434 | 434 | 0 |
| outline:modify | revision | system | 2929 | 2690 | -239 |
| outline:modify | revision | user | 427 | 427 | 0 |
| characters:modify | generation | system | 2627 | 2597 | -30 |
| characters:modify | generation | user | 1987 | 1987 | 0 |
| characters:modify | review | system | 2304 | 2274 | -30 |
| characters:modify | review | user | 2013 | 2013 | 0 |
| characters:modify | revision | system | 2627 | 2597 | -30 |
| characters:modify | revision | user | 364 | 364 | 0 |
| scenes:modify | generation | system | 1718 | 1718 | 0 |
| scenes:modify | generation | user | 1918 | 1918 | 0 |
| scenes:modify | review | system | 1634 | 1634 | 0 |
| scenes:modify | review | user | 1944 | 1944 | 0 |
| scenes:modify | revision | system | 1718 | 1718 | 0 |
| scenes:modify | revision | user | 364 | 364 | 0 |
| shots:modify | generation | system | 6038 | 6038 | 0 |
| shots:modify | generation | user | 854 | 854 | 0 |
| shots:modify | review | system | 929 | 929 | 0 |
| shots:modify | review | user | 4438 | 4438 | 0 |
| shots:modify | revision | system | 6038 | 6038 | 0 |
| shots:modify | revision | user | 847 | 847 | 0 |
| seconds-all:modify | generation | system | 7617 | 7617 | 0 |
| seconds-all:modify | generation | user | 983 | 983 | 0 |
| seconds-all:modify | review | system | 930 | 930 | 0 |
| seconds-all:modify | review | user | 5227 | 5227 | 0 |
| seconds-all:modify | revision | system | 7617 | 7617 | 0 |
| seconds-all:modify | revision | user | 963 | 963 | 0 |
| seconds-shot:modify | generation | system | 7617 | 7617 | 0 |
| seconds-shot:modify | generation | user | 682 | 682 | 0 |
| seconds-shot:modify | review | system | 930 | 930 | 0 |
| seconds-shot:modify | review | user | 4926 | 4926 | 0 |
| seconds-shot:modify | revision | system | 7617 | 7617 | 0 |
| seconds-shot:modify | revision | user | 697 | 697 | 0 |
| shot-revise:modify | generation | system | 4769 | 4769 | 0 |
| shot-revise:modify | generation | user | 626 | 626 | 0 |
| shot-revise:modify | review | system | 1054 | 1054 | 0 |
| shot-revise:modify | review | user | 4211 | 4211 | 0 |
| shot-revise:modify | revision | system | 4769 | 4769 | 0 |
| shot-revise:modify | revision | user | 653 | 653 | 0 |
| storyboard-text:modify | generation | system | 13015 | 13015 | 0 |
| storyboard-text:modify | generation | user | 1117 | 1117 | 0 |
| storyboard-text:modify | review | system | 930 | 930 | 0 |
| storyboard-text:modify | review | user | 8401 | 8401 | 0 |
| storyboard-text:modify | revision | system | 13015 | 13015 | 0 |
| storyboard-text:modify | revision | user | 1056 | 1056 | 0 |
| storyboard-reference:modify | generation | system | 13015 | 13015 | 0 |
| storyboard-reference:modify | generation | user | 1135 | 1135 | 0 |
| storyboard-reference:modify | review | system | 930 | 930 | 0 |
| storyboard-reference:modify | review | user | 8536 | 8536 | 0 |
| storyboard-reference:modify | revision | system | 13015 | 13015 | 0 |
| storyboard-reference:modify | revision | user | 1074 | 1074 | 0 |
| episode:new | generation | system | 938 | 872 | -66 |
| episode:new | generation | user | 340 | 340 | 0 |
| episode:new | review | system | 850 | 784 | -66 |
| episode:new | review | user | 361 | 361 | 0 |
| episode:new | revision | system | 1017 | 951 | -66 |
| episode:new | revision | user | 404 | 404 | 0 |
| outline:en | generation | system | 2841 | 2602 | -239 |
| outline:en | generation | user | 363 | 363 | 0 |
| outline:en | review | system | 2862 | 2499 | -363 |
| outline:en | review | user | 351 | 351 | 0 |
| outline:en | revision | system | 2920 | 2681 | -239 |
| outline:en | revision | user | 390 | 390 | 0 |
| storyboard:plain | generation | system | 12353 | 12353 | 0 |
| storyboard:plain | generation | user | 866 | 866 | 0 |
| storyboard:plain | review | system | 347 | 347 | 0 |
| storyboard:plain | review | user | 8142 | 8142 | 0 |
| storyboard:plain | revision | system | 12432 | 12432 | 0 |
| storyboard:plain | revision | user | 911 | 911 | 0 |
| edited:storyboard | review | system | 930 | 930 | 0 |
| edited:storyboard | review | user | 7470 | 7470 | 0 |
| edited:outline | review | system | 2870 | 2507 | -363 |
| edited:outline | review | user | 391 | 391 | 0 |
| image-prompt | generation | system | 399 | 399 | 0 |
| image-prompt | generation | user | 25 | 25 | 0 |
| image-prompt | review | system | 347 | 347 | 0 |
| image-prompt | review | user | 183 | 183 | 0 |
| image-prompt | revision | system | 478 | 478 | 0 |
| image-prompt | revision | user | 70 | 70 | 0 |
| image:character | prompt | prompt | 168 | 168 | 0 |
| image:scene | prompt | prompt | 1150 | 1167 | 17 |
| image:part | prompt | prompt | 158 | 158 | 0 |
| image:pencil | prompt | prompt | 439 | 409 | -30 |

## 全局删除（改造后任何请求都不再出现的句子）

### 其他（需人工确认）（14）

- 请根据提供的项目摘要、剧本和前后集剧情，创作指定集的摘要。　〔9 处，如 episode:regenerate/generation〕
- 重新创作本集时，仅依据本次提供的资料，不沿用本集旧摘要或历史意见。　〔9 处，如 episode:regenerate/generation〕
- 在 outline 字符串内写大纲正文，不写分镜或视频提示词。　〔10 处，如 outline:regenerate/generation〕
- 依据本集已确定的事件与因果展开剧情，补足合理的行动细节与过渡，不提前演出后集事件。　〔10 处，如 outline:regenerate/generation〕
- 以可见行动推动事件：人物的选择落实为具体动作与结果，动机来自目标与冲突；　〔10 处，如 outline:regenerate/generation〕
- 不写景别、机位或逐秒调度。　〔10 处，如 outline:regenerate/generation〕
- 先逐段分析本次生成的大纲，盘点所有需要出现在画面中的人物，再决定角色卡范围。　〔6 处，如 characters:regenerate/generation〕
- 填入本次 items，每个符合条件的独立外形身份一张卡，不额外输出盘点过程。　〔6 处，如 characters:regenerate/generation〕
- 根据场景资料与生成规则，生成一张场景参考图。　〔1 处，如 image:scene/prompt〕
- 请根据本次场景资料和画面要求，生成一张无人环境全景图。　〔1 处，如 image:scene/prompt〕
- 只输出图片，不输出解释或审核文字。　〔1 处，如 image:scene/prompt〕
- 用户明确请求本次图片操作才进入可视化模式。　〔1 处，如 image:pencil/prompt〕
- 将已批准文本分镜逐秒绘制成多宫格铅笔分镜，覆盖完整时长。　〔1 处，如 image:pencil/prompt〕
- 保持项目视觉设计中的身份和场景，但草图使用黑白铅笔线稿，不画成最终渲染图。　〔1 处，如 image:pencil/prompt〕

## 按请求移出（仍在其他请求或场景中）

| 场景 | 请求 | 角色 | 句数 |
|---|---|---|---:|
| outline:regenerate | generation | system | 15 |
| outline:regenerate | review | system | 15 |
| outline:regenerate | revision | system | 15 |
| outline:modify | generation | system | 15 |
| outline:modify | review | system | 15 |
| outline:modify | revision | system | 15 |
| outline:en | generation | system | 15 |
| outline:en | review | system | 15 |
| outline:en | revision | system | 15 |
| edited:outline | review | system | 15 |

## 删除去向核对

- 摘要的“根据资料创作”和重新生成边界：已在 EpisodeSummaryModel 本次任务与资料片段提供。
- 大纲的 outline 字段描述：由输出协议管理；剧情因果、合理过渡及不提前演出保留为同义规则。
- 大纲重复的可见行动与不写机位：保留行动规则及正文中的阶段边界；删除逐招、嘴型、机位可见性及跨镜声学细则，它们仍在镜头/每秒/分镜规则中。
- 人物首句：合并为全部实际出镜身体的覆盖要求；items 的结构由输出协议提供，身体拆分细则保留。
- 场景任务与只输出图片：迁入 SceneImageModel，skill 保留无人全景；三模式独立任务、统一输出要求。
- 铅笔操作授权：由人工操作入口和 agent 门禁控制；逐秒覆盖与黑白线稿规则同义保留。
- 视频首句改为生产连续性约束；没有删除具体事件与衔接要求。
