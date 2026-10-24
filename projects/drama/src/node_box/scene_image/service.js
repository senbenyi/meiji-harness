import {join} from 'node:path'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {NodeStateModel} from '@agent-modules/task/models'
import {ProjectManager} from '../../project_runtime/project_manager.js'
import {nodeRules} from '../../node_runtime/node_state.js'
import {waitBoxTask} from '../../node_runtime/box_report.js'
import {reconcileSceneAssets} from '../scene_extraction/state.js'
import {sceneImageTarget,sceneImageFingerprint,referenceImage,digest} from './state.js'
import {SceneImageExecutor} from './executor.js'
export class SceneImageService {
  constructor({projects,records,models}) {
    Object.assign(this,{projects,records,models});projects.enableTaskRecords(records)
    this.executor=new SceneImageExecutor({projects,records,models,save:(...args)=>this.save(...args)})
  }
  async project(sessionId,projectId) {
    const {project}=await this.projects.snapshot(sessionId)
    if(!project || projectId && project.basic_info.id!==projectId)throw Object.assign(new Error('当前会话未绑定此项目'),{code:'PROJECT_SCOPE'})
    return project
  }
  async ensure(project) {
    project.scene_extraction.assets=await reconcileSceneAssets(project.scene_extraction.assets,project.scene_extraction.scenes,project.scene_extraction.scenes,project.basic_info.aspect_ratio)
  }
  saveInputs({scene_id,instruction,reference_image,previous_instruction,previous_reference_image,...unknown},{sessionId,projectId}={}) {
    if(Object.keys(unknown).length || typeof scene_id!=='string' || !scene_id || typeof instruction!=='string' || instruction.length>10000 || typeof previous_instruction!=='string' || typeof previous_reference_image!=='string')throw new TypeError('请提供场景、生图要求及保存前的输入值')
    referenceImage(reference_image)
    return this.projects.writes.run(async()=>{
      const project=await this.project(sessionId,projectId)
      if(this.projects.activeExecution(project.basic_info.id))throw new Error('项目任务正在执行，暂不能修改生图输入')
      await this.ensure(project)
      const target=sceneImageTarget(project,scene_id)
      if(!target)throw new Error('场景不存在')
      const image=target.image
      if(image.node_state.opinion!==previous_instruction || image.reference_image!==previous_reference_image)throw new Error('生图输入已变化，请刷新后重试')
      const changed=image.node_state.opinion!==instruction || image.reference_image!==reference_image
      image.reference_image=reference_image;image.node_state.opinion=instruction
      if(changed)image.node_state=new NodeStateModel({...image.node_state,status:image.address?'expired':'empty',reason:image.address?'生图要求或参考图已变化，需重新生成':''}).toJSON()
      const manager=await ProjectManager.open(join(this.projects.root,'projects',project.basic_info.id,'project.json'))
      manager.change(next=>{next.scene_extraction.assets=project.scene_extraction.assets});await manager.model.update()
      this.projects.emit('updated',{project_id:project.basic_info.id,session_ids:[sessionId]})
      return {instruction,reference_image}
    })
  }
  generate({scene_id,instruction='',retry_of,...unknown}={}, {sessionId,projectId,requestId,source='ui',retryAction}={}) {
    if(Object.keys(unknown).length || typeof instruction!=='string' || instruction.length>10000 || typeof requestId!=='string' || !requestId.trim() || requestId.length>200)throw new TypeError('场景生图要求或请求ID无效')
    return this.projects.writes.run(async()=>{
      const project=await this.project(sessionId,projectId);projectId=project.basic_info.id
      if(retry_of){
        const parent=this.records.tasks.detail(this.records.scope,retry_of)
        if(!parent || parent.tasks[0].node_type!=='scene_image' || parent.tasks[0].metadata.project_id!==projectId || parent.tasks[0].metadata.session_id!==sessionId || ['queued','running'].includes(parent.status) || source!=='ui' || retryAction!=='regenerate')throw new Error('原场景图任务不可重试')
        scene_id=parent.tasks[0].metadata.scene_id
      } else if(retryAction)throw new Error('缺少原场景图任务')
      if(typeof scene_id!=='string'||!scene_id)throw new TypeError('场景ID必选')
      const id=digest(['scene_image',sessionId,requestId]),signature=digest({scene_id,instruction,retry_of})
      const old=this.records.tasks.detail(this.records.scope,id)
      if(old){if(old.tasks[0].metadata.request_signature!==signature)throw new Error('同一请求ID不能用于不同生图要求');return{project_id:projectId,group_id:id,status:old.status}}
      if(this.projects.activeExecution(projectId))throw new Error('项目已有排队或执行中的任务')
      if(project.scene_extraction.node_state.status!=='generated')throw new Error('请先完成场景提取')
      await this.ensure(project)
      const target=sceneImageTarget(project,scene_id);if(!target)throw new Error('场景不存在')
      const config=await this.models.read();const reference=referenceImage(target.image.reference_image)
      if(reference && config.image.model!=='gpt-image')throw new Error('当前图片模型不支持参考图，请选择GPT Image')
      const manager=await ProjectManager.open(join(this.projects.root,'projects',projectId,'project.json'))
      manager.change(next=>{next.scene_extraction.assets=project.scene_extraction.assets});await manager.model.update()
      const goal=instruction.trim()||target.image.node_state.opinion.trim()||`生成${target.scene.name}的无人场景总览图`
      this.records.tasks.submit(this.records.scope,{group:{id,name:'生成场景图',source,metadata:{project_id:projectId,notify_main:source==='ui',parent_group_id:retry_of||null}},tasks:[{
        node_type:'scene_image',action:target.image.address?'revise':'generate',name:target.scene.name,
        metadata:{project_id:projectId,project_name:project.basic_info.name,session_id:sessionId,request_id:requestId,request_signature:signature,scene_id,instruction:goal,goal,parent_group_id:retry_of||null,
          input_hash:sceneImageFingerprint(project,target),node_state_before:structuredClone(target.image.node_state),input_snapshot:{scene:structuredClone(target.scene),reference_image:target.image.reference_image,aspect_ratio:project.basic_info.aspect_ratio,instruction:goal,output_language:config.output_language,rules:nodeRules(target.image.node_state)}}}]})
      this.projects.watchProjectTask(id);return{project_id:projectId,group_id:id,status:'queued',scene_id}
    }).then(async result=>{if(source==='ui')await this.projects.showPanelTaskStart?.(result.group_id);this.records.tasks.start(this.records.scope);return result})
  }
  async wait(groupId,sessionId,signal){const detail=this.records.tasks.detail(this.records.scope,groupId);if(!detail||detail.tasks[0].node_type!=='scene_image'||detail.tasks[0].metadata.session_id!==sessionId)throw new Error('任务不属于当前会话');const result=await waitBoxTask(this.records,groupId,signal);await this.projects.writes.run(()=>{});return result}
  save(ctx,bytes){if(!Buffer.isBuffer(bytes)||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('图片模型未返回有效PNG图片');return this.projects.writes.run(async()=>{
    ctx.signal.throwIfAborted();const m=ctx.task.metadata,project=await this.project(m.session_id,m.project_id),target=sceneImageTarget(project,m.scene_id)
    if(!target||sceneImageFingerprint(project,target)!==m.input_hash)throw new Error('场景或生图输入已变化，拒绝迟到结果')
    const task=this.records.tasks.detail(this.records.scope,ctx.task.group_id)?.tasks.find(row=>row.id===ctx.task.id)
    if(task?.task_status!=='running')throw new Error('任务已结束，拒绝写入')
    const filename=`${ctx.task.id}-${ctx.step.id}.png`,folder=join(this.projects.root,'projects',m.project_id,'scene-images')
    await mkdir(folder,{recursive:true});await writeFile(join(folder,filename),bytes)
    const address=`/api/drama/scene-image?${new URLSearchParams({session_id:m.session_id,file:filename})}`
    const manager=await ProjectManager.open(join(this.projects.root,'projects',m.project_id,'project.json'))
    manager.change(next=>{const image=sceneImageTarget(next,m.scene_id).image;image.address=address;image.aspect_ratio=m.input_snapshot.aspect_ratio;image.node_state=new NodeStateModel({...image.node_state,status:'generated',reason:'',dependency_hash:m.input_hash}).toJSON()})
    ctx.signal.throwIfAborted();await manager.model.update();this.projects.emit('updated',{project_id:m.project_id,session_ids:[m.session_id]});return{address,scene_id:m.scene_id}
  })}
  async readImage(sessionId,filename){if(!/^[a-zA-Z0-9_-]+\.png$/.test(filename||''))throw new TypeError('图片文件名无效');const project=await this.project(sessionId);return readFile(join(this.projects.root,'projects',project.basic_info.id,'scene-images',filename))}
}
