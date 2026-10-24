export class GenerateCostumeImagesTool {
  constructor({ costumeImages }) {
    this.costumeImages = costumeImages
    this.name = 'drama-generate-costume-images'
    this.description = '仅当用户明确要求生成角色定妆照时调用。未指定character_id时一键生成所有角色及各套明确服装的定妆照，无服装目录的角色生成一张人物照；指定角色和服装ID时仅生成对应照片。读取项目角色资料，逐张生成和保存，保存后即完成，不新增人物或服装。遇到失败停止剩余批次并保留已保存图片，返回任务事实。'
    this.parameters = { type: 'object', additionalProperties: false, properties: {
      instruction: { type: 'string', minLength: 1, maxLength: 10000 }, character_id: { type: 'string', minLength: 1 }, costume_id: { type: ['string', 'null'] },
    }, required: ['instruction'] }
    this.output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }
  }
  async execute(args, exec) {
    const sessionId = exec?.agent?.session?.id
    if (!sessionId) throw new Error('必须从Harness会话调用')
    if (!args || Object.keys(args).some(key => !['instruction', 'character_id', 'costume_id'].includes(key))) throw new TypeError('定妆照输入含未声明字段')
    const result = await this.costumeImages.generate(args, { sessionId, requestId: exec.callId, source: 'conversation' })
    return JSON.stringify(await this.costumeImages.wait(result.group_id, sessionId, exec.signal))
  }
}
