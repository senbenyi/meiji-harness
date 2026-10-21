/** 为宿主自带模式提供共享业务工具和指导，不覆盖模式自身的身份及能力。 */
export const name = 'drama-session'
export const inject = ['drama', 'tools', 'systemPrompt']

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(ctx.drama), 'drama: create project tool')
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'drama:project-creation',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
    text: '项目创建：仅当用户明确要求创建短剧项目时，调用 drama-create-project；项目名使用用户指定名称，其他资料仅填写用户已提供的内容，未提供则留空，不编造。工具会创建以项目名称命名的独立工作区和标准模式新会话，保留原会话的归属及消息。以工具结果确认是否成功，失败不得声称创建成功。允许从已有项目会话创建其他项目。',
  }), 'drama: project creation guidance')
}
