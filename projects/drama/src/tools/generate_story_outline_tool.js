/** 自然语言目标接口；业务执行与数据访问统一交给故事大纲盒子的服务。 */
export class GenerateStoryOutlineTool {
  constructor({ storySegments }) {
    this.storySegments = storySegments
    this.name = 'drama-generate-story-outline'
    this.description = '按用户明确要求生成或修改当前项目故事大纲，或执行统一联动规划中确认的形象/场景描述冲突修正。联动只修正受影响描述，保留用户新设定，不自行扩大剧情改编。只传具体意见，不传完整剧本、项目ID或规则；程序读取当前工作稿、已有大纲和项目规则，没有工作稿会明确失败。工具等待生成、审核及必要修订结束后返回状态；有效结果自动保存，saved与审核状态独立，只有completed才可声称审核通过。盒子不执行其他节点或修改规则。'
    this.parameters = { type: 'object', additionalProperties: false, properties: { retry_of: { type: 'string', minLength: 1, description: '修复规则或上游后，关联原盒子报告的group_id；创建全新任务ID，原目标保留。' }, instruction: { type: 'string', minLength: 1, maxLength: 10000, description: '用户本次明确的大纲要求；如用户仅说生成故事大纲，保留这一目标，不自行添加风格或情节要求。' } }, required: ['instruction'] }
    this.output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }
  }
  async execute(args, exec) {
    const sessionId = exec?.agent?.session?.id
    if (!sessionId) throw new Error('必须从Harness会话调用')
    if (!args || Object.keys(args).some(key => !['instruction', 'retry_of'].includes(key))) throw new TypeError('只允许提交instruction和retry_of')
    const result = await this.storySegments.generateStoryOutline(args, { sessionId, requestId: exec.callId, source: 'conversation' })
    return JSON.stringify(await this.storySegments.waitStoryOutline(result.group_id, sessionId, exec.signal))
  }
}
