/** 面板与会话共用分镜盒子Service。 */
export class GenerateShotsTool {
  constructor({ shotDesign }) {
    this.shotDesign = shotDesign
    this.name = 'drama-generate-shots'
    this.description = '按用户明确要求生成或修改当前绑定项目完整分镜。读取已确认故事大纲与现有场景、团队、人物服装资料，设计开场和连续声画节拍，不再改编剧情或台词；不要求图片。工具等待生成、审核和必要修订；有效候选即时保存，只有completed才表示审核通过。不会生成分片或视频。重新生成可指定regenerate=true，instruction始终包含用户意见。'
    this.parameters = { type: 'object', additionalProperties: false, properties: {
      regenerate: { type: 'boolean', description: '从头重新设计完整分镜，仍遵守instruction意见。' },
      instruction: { type: 'string', minLength: 1, maxLength: 10000, description: '用户本次明确的分镜设定要求，不自行添加剧情或风格目标。' },
      retry_of: { type: 'string', minLength: 1, description: '关联修复后的原分镜盒子group_id，新建任务保留原目标。' },
    }, required: ['instruction'] }
    this.output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }
  }
  async execute(args, exec) {
    const sessionId = exec?.agent?.session?.id
    if (!sessionId) throw new Error('必须从Harness会话调用')
    if (!args || Object.keys(args).some(key => !['instruction', 'retry_of', 'regenerate'].includes(key))) throw new TypeError('只允许提交instruction、retry_of和regenerate')
    const accepted = await this.shotDesign.generateShots(args, { sessionId, requestId: exec.callId, source: 'conversation' })
    return JSON.stringify(await this.shotDesign.waitShots(accepted.group_id, sessionId, exec.signal))
  }
}
