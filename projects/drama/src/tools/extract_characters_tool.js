/** 自然语言目标接口；业务执行与数据访问统一交给角色盒子的服务。 */
export class ExtractCharactersTool {
  constructor({ characterExtraction }) {
    this.characterExtraction = characterExtraction
    this.name = 'drama-extract-characters'
    this.description = '仅按用户明确要求生成或修改当前会话绑定项目的角色。只传本次具体角色修改意见，不传完整剧本、项目ID或规则；程序读取完整故事大纲、已有角色和项目规则。没有大纲会明确失败。工具等待生成、审核及必要修订结束后返回任务状态；有效结果自动保存，saved与审核状态独立；只有completed才可声称审核通过。不会执行其他制作节点或修改规则。'
    this.parameters = { type: 'object', additionalProperties: false, properties: { retry_of: { type: 'string', minLength: 1, description: '修复规则或上游后，关联原盒子报告的group_id；创建全新任务ID，原目标保留。' }, instruction: { type: 'string', minLength: 1, maxLength: 10000, description: '用户本次明确的角色要求；如用户仅说生成角色，保留这一目标，不自行添加风格或情节要求。' } }, required: ['instruction'] }
    this.output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }
  }
  async execute(args, exec) {
    const sessionId = exec?.agent?.session?.id
    if (!sessionId) throw new Error('必须从Harness会话调用')
    if (!args || Object.keys(args).some(key => !['instruction', 'retry_of'].includes(key))) throw new TypeError('只允许提交instruction和retry_of')
    const result = await this.characterExtraction.extractCharacters(args, { sessionId, requestId: exec.callId, source: 'conversation' })
    return JSON.stringify(await this.characterExtraction.waitCharacters(result.group_id, sessionId, exec.signal))
  }
}
