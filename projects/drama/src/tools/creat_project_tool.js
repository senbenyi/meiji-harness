import { projectFields } from '../node_box/project/create_project.js'
import { latestUserGoal } from '../session/planning_context.js'

/** AI接口适配：只声明工具协议并把宿主调用上下文交给项目服务。 */
export class CreateProjectTool {
  constructor({ projects }) {
    if (!projects || typeof projects.create !== 'function') throw new TypeError('需提供项目服务')
    this.projects = projects
    this.name = 'drama-create-project'
    this.description = '按用户明确请求创建短剧项目，保存本地JSON，为项目创建以项目名称命名的独立工作区和新会话，保留原会话归属及消息。只需项目名；未提供的剧本和创作要求留空，不编造。返回新会话ID，面板自动切换。允许从已有项目会话创建其他项目。'
    this.parameters = { type: 'object', additionalProperties: false, properties: projectFields, required: ['name'] }
    this.output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }
  }

  async execute(args, exec) {
    const sessionId = exec?.agent?.session?.id
    if (!sessionId) throw new Error('必须从 Harness 会话调用')
    return JSON.stringify(await this.projects.create(args, { sessionId, requestId: exec.callId, source: 'conversation', goal: latestUserGoal(exec.agent) }))
  }
}
