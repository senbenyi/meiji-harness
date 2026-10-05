# 技能与约束

每个功能维护一份基础生产规则，统一放在 `task/`；有自审步骤的功能另维护一份审核 skill，统一放在 `review/`。两个目录都按功能命名 Markdown，不设分类子目录。大纲、人物提取、场景提取、道具提取的生产规则与审核 skill 分别对应独立文件。不存在通用、修订、共享或指导 skill。

`skill-catalog.js` 登记功能与约束文件；`output-protocols.js` 保存程序解析需要的输出协议。`load-skills.js` 读取和校验基础正文。基础只读，空正文有效，缺失或未登记文件报错。

大模型文本生成与修订统一返回具名 JSON 对象：摘要用 summary，大纲用七个固定中文字段（值为正文字符串），资料提取用 items，镜头表与每秒指令用各自的 shots 结构，图片提示词改写用 prompt；审核用 passed/issues。字段解析后才保存和展示，正文换行由 JSON 转义还原。程序编译的视频提示词和图片/视频媒体接口保持各自格式。

每个需要大模型参与的步骤由独立 Model 编排：生成使用生产规则与任务资料；自审只使用对应的审核 skill（以【审核标准】编入审核请求），不再复用生成规则；修订使用生产规则，增加基稿与本次意见，只修改受影响内容。角色、语言、审核协议、修订边界及输出协议由代码负责。图片、视频步骤保留现有调用能力，不为统一方法增加额外 API 请求。

当前集当前节点的补充 skill 是独立输入，与基础规则一同组装，支持增删改，不跨集继承。任务开始时冻结规则与补充，预览复用真实编排，步骤历史保存实际请求。旧的基础覆盖、本剧审核/修订覆盖不再参与新请求；运行数据不删除。

动作、台词、表情、声音等仍有用的生产要求已归入对应功能基础正文，不再独立注册。参考素材是资料，不是额外基础 skill。

只有短剧制作预设的 session-plugin 将 `session/panel.md` 注册给 Harness，供会话 agent 使用，不参与生产提示词组装。

基础约束文件统一以 `-skill.md` 结尾；正文不包含展示用 Markdown 标题、skill 用途或程序实现介绍，只保留可直接编入提示词的执行要求。条件规则使用明确条件句，不能省略适用对象。


约束文件统一使用小写 kebab-case「动作-对象-skill.md」：生成用 `generate-`，提取用 `extract-`，审核用 `review-`。例如 `generate-shot-table-skill.md`、`extract-story-characters-skill.md`、`review-shot-table-skill.md`。生成和按意见修订共用 `task/` 中的基础正文，自审使用 `review/` 中的审核正文；改名只更新 catalog 和引用，不改变运行时 skill ID。

剧本按要求修改使用 `revise-script-skill.md` 与 `review-script-revision-skill.md`，方案绑定剧本/摘要依据并逐条确认；单镜不创建独立 revise 约束文件。单镜修订复用 `generate-shot-table-skill.md`；指定镜头、基稿、意见、编号时长与修改范围由 ShotRevisionModel 编排，自审使用 `review-shot-revision-skill.md`（核对意见落实、改动范围与前后镜衔接）。

审核 skill 在 `skill-catalog.js` 中用 `reviewFile` 登记，大纲节点用 `reviewVariants` 按 outline / characters / scenes / props 分别登记；`load-skills.js` 校验 `review/` 中的文件都已登记。审核正文写可执行的验收条目：审核依据、判为不通过的具体情形（每条要求引用待审原文与对应资料）以及不判失败的情形，覆盖生成规则中的约束与项目流程上下游边界。审核协议（JSON 结论格式）、角色与审核范围由代码负责，不写进审核正文。视频、人物/场景/道具/铅笔分镜图片没有大模型自审，不建审核 skill。人工编辑大纲只使用大纲审核 skill；其他剧情卡片编辑的综合审核保留大纲、人物、场景一致性检查。

图片提示词改写没有独立基础 skill：保留原主体、限定外观修改、禁止编造素材等生成规则由 ImagePromptModel 编排；其自审使用 `review-image-prompt-skill.md`。

目录职责：`task/` 放具体任务的基础 skill，`review/` 放对应任务的审核 skill，`session/` 放处理会话的 skill。三个 JS 文件保留：`skill-catalog.js` 管理功能登记及文件映射，`load-skills.js` 管理读取、校验和会话注册数据，`output-protocols.js` 管理输出协议；它们是代码，不是额外的 skill 正文。

基础正文只描述生产约束；根据哪些资料做什么，由 Model 的本次任务描述。上下文、修改意见和输出结构由 Model 分区组装，不能在基础规则中重复模式编排或接口说明。

会话工具、操作与任务的依赖图维护在 `tool-graph.json`；测试核对实际注册集合、stageCatalog 和 skill 引用。剧情提取模型携带三类库文字目录，输出可指定条目/变体关联。道具只收本集主要且反复出现的物件，或已有库条目；一般服装保留在角色造型。
