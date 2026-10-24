import { modelClient } from '@agent-modules/http-client'
import { composeNodePrompt } from '../../node_runtime/node_prompt_composer.js'
import { imageTargets, imageFingerprint } from './state.js'

const step = kind => ({ kind, name: kind === 'revise' ? '重新生成定妆照' : '生成定妆照', executor: 'ai' })
export class CostumeImageExecutor {
  constructor({ projects, records, models, save }) {
    Object.assign(this, { projects, records, models, save })
    records.tasks.register('costume_image', { label: '定妆照', plan: task => [step(task.action)], execute: ctx => this.execute(ctx) })
    records.tasks.recover(records.scope)
  }
  async execute(ctx) {
    const metadata = ctx.task.metadata, { project } = await this.projects.snapshot(metadata.session_id)
    if (!project || project.basic_info.id !== metadata.project_id) throw new Error('项目归属已变化')
    const target = imageTargets(project, metadata.character_id, metadata.costume_id)[0]
    if (!target || imageFingerprint(project, target) !== metadata.input_hash) throw new Error('定妆照输入已变化，请重新生成')
    const { rules, reference_image, ...input } = metadata.input_snapshot
    const kind = ctx.step.kind, config = await this.models.read()
    const prompt = composeNodePrompt({ nodeType: 'costume_image', action: kind, rules, input, goal: metadata.instruction })
    const record = async (transfer, options) => { transfer.title = `定妆照 · ${ctx.task.name} · ${ctx.step.name}`; transfer.id = ctx.recordHttp(transfer, options) || transfer.id; await this.records.http.record(transfer, options) }
    const reference = reference_image ? reference_image.match(/^(?:data:(image\/(?:png|jpeg|webp));base64,)?([A-Za-z0-9+/=]+)$/) : null
    if (reference_image && !reference) throw new Error('参考图需为有效Base64图片')
    if (reference && config.image.model !== 'gpt-image') throw new Error('当前图片模型不支持参考图，请选择GPT Image')
    ctx.recordPrompt({ model: config.image.model, messages: prompt.messages, input: { ...input, reference_image } })
    const bytes = await modelClient.generateImage({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.image.model,
      prompt: prompt.messages.map(row => row.content).join('\n\n'), aspectRatio: input.aspect_ratio,
      references: reference ? [{ mime: reference[1] || 'image/png', bytes: Buffer.from(reference[2], 'base64') }] : [],
      signal: ctx.signal, requestId: ctx.step.id, record })
    ctx.signal.throwIfAborted()
    const output = await this.save(ctx, bytes)
    return { result: { output, saved: true } }
  }
}
