/** 面板与会话共用团队盒子Service。 */
export class GenerateGroupsTool {
  constructor({ groupSetting }) {
    this.groupSetting = groupSetting
    this.name = 'drama-generate-groups'
    this.description = '按用户明确要求独立生成或修改当前绑定项目的团队设定：团队基本形象、群体气质、视觉标识、共同服装。程序读取完整故事大纲、已有场景和团队规则；没有大纲会失败。没有实际出镜团队时输出空groups并审核通过。不会生成人物或定妆照，不自动执行后续节点。工具等待生成、审核及必要修订终态；结构有效候选即时保存，saved与审核通过独立，只有completed才可声称审核通过。只传具体意见和可选原报告ID，不传完整项目或规则。'
    this.parameters = { type: 'object', additionalProperties: false, properties: {
      instruction: { type: 'string', minLength: 1, maxLength: 10000, description: '用户本次明确的团队设定要求，不自行添加剧情或风格目标。' },
      retry_of: { type: 'string', minLength: 1, description: '关联修复后的原团队盒子group_id，新建任务保留原目标。' },
    }, required: ['instruction'] }
    this.output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }
  }
  async execute(args, exec) {
    const sessionId = exec?.agent?.session?.id
    if (!sessionId) throw new Error('必须从Harness会话调用')
    if (!args || Object.keys(args).some(key => !['instruction', 'retry_of'].includes(key))) throw new TypeError('只允许提交instruction和retry_of')
    const accepted = await this.groupSetting.generateGroups(args, { sessionId, requestId: exec.callId, source: 'conversation' })
    return JSON.stringify(await this.groupSetting.waitGroups(accepted.group_id, sessionId, exec.signal))
  }
}
