# 引用编排 skill 收敛调研

## 结论
- AC-1 已确认：`generateShotStoryboard` 直接调用引用编排，不再生成独立文本镜头；基础 skill 仍有 110 行、7098 字及重复创作规则。
- AC-2 已确认：`buildStoryboardPrompts` 引入整个剧情背景；`buildShotPrompts` 与人工编辑审核追加完整镜头表和前镜最终稿，超出引用转写验收范围。
- AC-3 已确认：catalog、接口注册、预览、节点技能仍保留 text-shot；主操作已不支持独立 text-shot-edit。
- AC-4 已确认：输出格式和引用检查由 TextStoryboardModel、h3PromptFailures 管理，必须保留；任务执行器、存储与 Base64 提交无需调整。

## 规格
- 目标：已通过的每秒指令直接转写及绑定多模态素材，生成、审核和修订共用精简基础规则。
- 非目标：重新设计镜头、调用真实视频服务、修改任务状态或项目存储格式。
- AC-1：skill 只保留完整性、身份、素材用途、引用链及尾帧规则；角色、语言、输出与声音标签由 Model 明确提供。
- AC-2：生成、审核、修订和人工编辑审核只接收本镜每秒指令、关联资料、固定素材及当前意见；不重新审查整集与前镜最终稿。
- AC-3：删除停用的 text-shot Model、skill、接口、预览和节点操作入口；历史任务及已有节点补充数据不删除。
- AC-4：保留 text/reference 输出结构、格式校验、失败草稿、补充隔离、图片快照顺序与 Base64 提交行为。

## 调用链
shot-storyboard/storyboard-bind → generateShotStoryboard → buildStoryboardPrompts → TextStoryboardModel → runTextSteps → h3PromptFailures → 保存提示词。
storyboard-text → reviewContent → buildEditedContentReview → TextStoryboardModel。

## 证据
| 来源 | 结论 |
|---|---|
| server/generate/shot-text.js:generateShotStoryboard | 单阶段读取通过的每秒指令，固定图片快照 |
| server/prompts/shot-prompts.js:buildStoryboardPrompts/buildShotPrompts | 重复上游背景及跨镜审核上下文 |
| server/prompts/text-prompts.js:buildEditedContentReview | 人工编辑审核同样范围过宽 |
| skills/task/generate-text-storyboard-skill.md | 重复空间、动作、武术、表情及多模式说明 |
| skills/catalog.js、prompts/interfaces/registry.js、preview.js | 旧独立文本镜头仍注册 |

## 待用户决定
无，用户已同意按评估修改。现有工作区改动保留，图谱落后 3 次提交，以源码取证。
