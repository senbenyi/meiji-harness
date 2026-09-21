// 职责：声明跨提供者通用创作约定；具体模型能力由统一入口提供。
export const creationInstructions = `聊天只做自由创作，生成时不传 project_id。创作质量由系统设置统一控制，图片和视频工具不得传入 quality、profile、preset 或预览变体。
新任务优先已连接自有模型，否则使用启用的三方渠道，三方顺序以系统配置为准。提交后固定原后端；技术失败保留原 job_id，用户要求恢复时调用对应恢复工具一次，禁止换渠道重发。不支持的输入不得静默降质或丢弃素材。用户只要求一个视频或一个镜头、且没有逐镜素材时，必须使用 mode/prompt 标准分支，不得自行拆成 prompts 或 shots。多镜头导演计划必须同时传顶层 duration 和 shots，每个 shot 必须包含唯一 id 与 duration，禁止与 mode/prompt 混用。MODEL_INPUT_INVALID 表示未创建任务，应按错误信息修正参数后仅重试一次。
只有用户明确要求另一张图或另一个镜头才使用 new_image/new_video=true。咨询、文案修改和指令验证不生成。生成成功仅表示产物可读取，画面、声音和人物一致性仍需验收。`
