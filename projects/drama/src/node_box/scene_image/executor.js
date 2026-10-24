import { modelClient } from '@agent-modules/http-client'
import { composeNodePrompt } from '../../node_runtime/node_prompt_composer.js'
import { sceneImageTarget, sceneImageFingerprint, referenceImage } from './state.js'
export class SceneImageExecutor {
  constructor({ projects, records, models, save }) {
    Object.assign(this, { projects, records, models, save })
    records.tasks.register('scene_image', { label: '场景图', plan: task => [{kind:task.action,name:task.action==='revise'?'重新生成场景图':'生成场景图',executor:'ai'}], execute: ctx => this.execute(ctx) })
    records.tasks.recover(records.scope)
  }
  async execute(ctx) {
    const m = ctx.task.metadata, { project } = await this.projects.snapshot(m.session_id)
    const target = project?.basic_info.id === m.project_id && sceneImageTarget(project, m.scene_id)
    if (!target || sceneImageFingerprint(project, target) !== m.input_hash) throw new Error('场景或生图输入已变化，请重新生成')
    const {rules, reference_image, ...input} = m.input_snapshot, config = await this.models.read()
    const reference = referenceImage(reference_image)
    if (reference && config.image.model !== 'gpt-image') throw new Error('当前图片模型不支持参考图，请选择GPT Image')
    const prompt = composeNodePrompt({nodeType:'scene_image',action:ctx.step.kind,rules,input,goal:m.instruction})
    ctx.recordPrompt({model:config.image.model,messages:prompt.messages,input:{...input,reference_image}})
    const record = async (transfer, options) => { transfer.title=`场景图 · ${ctx.task.name}`;transfer.id=ctx.recordHttp(transfer,options)||transfer.id;await this.records.http.record(transfer,options) }
    const bytes = await modelClient.generateImage({baseUrl:config.baseUrl,apiKey:config.apiKey,model:config.image.model,
      prompt:prompt.messages.map(row=>row.content).join('\n\n'),aspectRatio:input.aspect_ratio,references:reference?[reference]:[],signal:ctx.signal,requestId:ctx.step.id,record})
    ctx.signal.throwIfAborted()
    return {result:{output:await this.save(ctx,bytes),saved:true}}
  }
}
