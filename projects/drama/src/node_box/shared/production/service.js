import {nodeBoxes,manualStage} from '../../registry.js'
import {MemoryMaintenance} from '../../../memory/maintenance.js'
import {randomUUID} from 'node:crypto'
import {modelClient} from '@agent-modules/http-client'
import {projectStages,stageProduct} from '../../../shared/production/production_stages.js'
import {ImageStore} from '../../../library/image_store.js'
import {createProductionExecutors} from './executor_registry.js'
import {readJSON} from './execution_support.js'
import {actionRules,textStages} from '../agent/rules.js'
import {readNodeFormat} from '../../../shared/nodes/node_rule_files.js'
import {requestIdentity} from '../../../drama_runtime/request-identity.js'
const terminal=status=>!['queued','running'].includes(status)
export class ProductionService {
  constructor({projects,models,textClient=modelClient,mediaClient=modelClient,images=new ImageStore(projects.root)}){
    Object.assign(this,{projects,models,textClient,mediaClient,images});this.executors=createProductionExecutors(this);this.pending=new Map();projects.production=this;projects.documents.validateImages=document=>images.validate(document)
    this.memoryMaintenance=new MemoryMaintenance({projects,models,client:textClient})
    projects.records.tasks.recover(projects.records.scope)
    this.ready=this.recoverProjections()
  }
  async recoverProjections(){
    const tasks=this.projects.records.tasks.store.read(this.projects.records.scope).tasks.filter(task=>task.metadata?.production&&terminal(task.task_status)),latest=new Map()
    for(const task of tasks){const key=task.metadata.project_id+':'+task.node_type;if(!latest.has(key)||latest.get(key).queue_order<task.queue_order)latest.set(key,task)}
    for(const task of latest.values())try{const detail=this.projects.records.tasks.detail(this.projects.records.scope,task.group_id);await this.projects.projectTaskResult(detail);await this.projects.documents.mutate(task.metadata.project_id,p=>{if(p.node_states[task.node_type].status==='partial'){p.node_states[task.node_type].status='draft';p.node_states[task.node_type].reason=detail.reason||'上次执行中断，可从检查点继续'}return p})}catch(error){if(error.code!=='ENOENT')throw error}
  }
  executorFor(stage){const executor=this.executors.get(stage);if(!executor)throw new TypeError(`未知制作步骤：${stage}`);return executor}
  plan(task){return task.metadata.production?this.executorFor(task.node_type).plan(task):[{kind:task.action,name:task.name,executor:'program'}]}
  notify(task){this.projects.emit('updated',{project_id:task.metadata.project_id,session_ids:[task.metadata.session_id]})}
  recorder(ctx){return async(transfer,options)=>{try{transfer.id=ctx.recordHttp(transfer,options)||transfer.id}catch(error){if(error.code!=='STEP_CLOSED')throw error}await this.projects.records.http.record(transfer,options)}}
  async rules(project,stage){if(!projectStages.some(s=>s.id===stage))throw new TypeError('未知步骤');const custom=project.node_states[stage].rules,bases={},hasRules=textStages.includes(stage)||['asset_preparation','video_render'].includes(stage);for(const action of ['generate','review','revise'])bases[action]=hasRules?await actionRules(stage,action,custom[action]):custom[action];if(hasRules)bases.output_format=await readNodeFormat(stage);return {bases,custom}}
  async run(stage,input={},context={}){
    await this.ready
    const {projects}=this,{sessionId,projectId,requestId=randomUUID(),source='ui'}=context
    if(!projectStages.some(s=>s.id===stage&&s.id!=='project'))throw new TypeError('未知制作步骤')
    const groupId=requestIdentity(['production',sessionId,requestId]),options={...input};if(typeof options.instruction!=='string'&&options.instruction!==undefined)throw new TypeError('意见必须为文本');if((options.instruction||'').length>10000)throw new TypeError('意见最多10000字符')
    if(!options.resume_of&&!projects.records.tasks.detail(projects.records.scope,groupId)&&['adaptation_plan','story_segments','shot_design','video_prompt','asset_preparation','video_render'].includes(stage)){const project=await projects.context(sessionId,projectId);if(!projects.activeExecution(project.basic_info.id))await this.memoryMaintenance.ensure(stage,{sessionId,projectId:project.basic_info.id})}
    await projects.writes.run(async()=>{
      const project=await projects.context(sessionId,projectId),id=project.basic_info.id,existing=projects.records.tasks.detail(projects.records.scope,groupId)
      if(existing){if(existing.tasks[0].metadata.project_id!==id||existing.tasks[0].node_type!==stage||JSON.stringify(existing.tasks[0].metadata.options)!==JSON.stringify(options))throw new TypeError('同一请求ID不能改变制作任务');return}
      if(projects.activeExecution(id))throw Object.assign(new Error('短剧已有执行任务'),{code:'PROJECT_ACTIVE'})
      const instruction=options.instruction??project.node_states[stage].opinion,metadata={production:true,document_version:2,text_contract_version:2,project_id:id,session_id:sessionId,source_session_id:sessionId,instruction,goal:instruction||`执行${projectStages.find(s=>s.id===stage).title}`,options,source_revision_id:project.source.current_revision_id}
      if(options.resume_of){const previous=projects.records.tasks.detail(projects.records.scope,options.resume_of),task=previous?.tasks[0];if(!task||task.metadata.project_id!==id||task.node_type!==stage||!terminal(previous.status)||task.metadata.source_revision_id!==project.source.current_revision_id)throw new TypeError('续接任务不属于同短剧/阶段/来源版本');if(task.metadata.instruction!==instruction)throw new TypeError('续接时意见需保持原任务一致；更改目标请重新生成');if(['adaptation_plan','story_segments'].includes(stage)&&task.metadata.text_contract_version!==2)throw new TypeError('联合改编与定稿契约已更新，请重新生成');if(stage==='source_analysis'&&previous.steps.some(s=>['generate','review','revise'].includes(s.kind)))throw new TypeError('原著解析已改为程序执行，请重新执行本步骤');const priorSnapshot=await readJSON(projects,id,task.metadata.snapshot_ref);if(JSON.stringify(priorSnapshot.node_states[stage].rules)!==JSON.stringify(project.node_states[stage].rules))throw new TypeError('规则已变化，请重新生成')
        metadata.memory_snapshot_ref=task.metadata.memory_snapshot_ref
        metadata.resume_manifest_ref=previous.steps.findLast(s=>s.metadata?.manifest_ref)?.metadata.manifest_ref||previous.steps.find(s=>s.result?.manifest_ref)?.result.manifest_ref
        if(!metadata.resume_manifest_ref)throw new TypeError('原任务尚未建立检查点，请重新执行')
        const checkpoint=project.node_states[stage].checkpoint;const revisions=previous.steps.filter(s=>s.result?.product_revision!==undefined).map(s=>s.result.product_revision);if(revisions.length&&Math.max(...revisions,...(checkpoint?.task_id===task.id?[checkpoint.product_revision]:[]))!==project.node_states[stage].product_revision)throw new TypeError('候选已被人工改动，请重新执行审核或修订当前产物');metadata.resume_candidates={};for(const step of previous.steps)if(step.result?.candidate_ref&&step.result?.unit_id)metadata.resume_candidates[step.result.unit_id]={candidate_ref:step.result.candidate_ref,issues:step.result.review?.issues||[]};
        metadata.resume_completed={};for(const step of previous.steps)if(step.result?.accepted_ref&&step.result?.unit_id)metadata.resume_completed[step.result.unit_id]={unit_id:step.result.unit_id,unit_ref:step.result.unit_ref,accepted_ref:step.result.accepted_ref}
        if(checkpoint?.task_id===task.id){if(checkpoint.product_revision!==project.node_states[stage].product_revision)throw new TypeError('检查点之后产物已变化，请重新执行');if(checkpoint.state==='reviewed')metadata.resume_completed[checkpoint.unit_id]={unit_id:checkpoint.unit_id,unit_ref:checkpoint.unit_ref,accepted_ref:checkpoint.candidate_ref};else metadata.resume_candidates[checkpoint.unit_id]={candidate_ref:checkpoint.candidate_ref,issues:metadata.resume_candidates[checkpoint.unit_id]?.issues||[]}}
      }
      if(!metadata.memory_snapshot_ref)metadata.memory_snapshot_ref=await projects.documents.writeArtifact(id,JSON.stringify(await projects.memories.capture({sessionId,projectId:id},stage)),{extension:'json'})
      metadata.snapshot_ref=await projects.documents.writeArtifact(id,JSON.stringify(project),{extension:'json'})
      projects.records.tasks.submit(projects.records.scope,{group:{id:groupId,name:projectStages.find(s=>s.id===stage).title,source,metadata:{project_id:id,notify_main:source==='ui'}},tasks:[{node_type:stage,action:options.resume_of?'continue':options.revise?'revise':'generate',name:projectStages.find(s=>s.id===stage).title,metadata}]})
      await projects.documents.mutate(id,p=>{p.node_states[stage].status='partial';p.node_states[stage].reason='任务已受理';p.node_states[stage].opinion=instruction;return p})
    })
    if(!this.pending.has(groupId)){
      projects.records.tasks.start(projects.records.scope)
      const pending=this.complete(groupId).finally(()=>this.pending.delete(groupId));this.pending.set(groupId,pending);void pending.catch(()=>{})
      await projects.showPanelTaskStart?.(groupId)
    }
    return {group_id:groupId,status:projects.records.tasks.detail(projects.records.scope,groupId).status}
  }
  async complete(groupId){
    const {projects}=this,detail=await projects.wait(groupId),task=detail.tasks[0]
    await projects.projectTaskResult(detail)
    const newer=projects.records.tasks.store.read(projects.records.scope).tasks.some(t=>t.metadata?.project_id===task.metadata.project_id&&t.node_type===task.node_type&&t.queue_order>task.queue_order)
    if(!newer&&detail.status!=='completed')await projects.documents.mutate(task.metadata.project_id,p=>{p.node_states[task.node_type].status=detail.status==='rejected'?'rejected':'draft';p.node_states[task.node_type].reason=detail.reason||'执行已停止';return p})
    this.notify(task);return detail
  }
  async wait(groupId){return this.pending.get(groupId)||this.complete(groupId)}
  async cancel(groupId,{sessionId,projectId}){const project=await this.projects.context(sessionId,projectId),detail=this.projects.records.tasks.detail(this.projects.records.scope,groupId);if(!detail?.tasks[0]?.metadata.production)throw new TypeError('程序保存是原子操作，不能取消；请等待保存结果');if(detail?.tasks[0]?.metadata.project_id!==project.basic_info.id)throw new TypeError('任务不属于当前短剧');this.projects.records.tasks.cancel(this.projects.records.scope,groupId,'用户停止');return {cancelled:true,group_id:groupId}}
  async confirm(document,stage){if(!nodeBoxes[stage])throw new TypeError('未知制作步骤');await nodeBoxes[stage].confirm?.call(this,document);await this.images.validate(document)}
  async manual(ctx,command){
    const {projects}=this,id=ctx.task.metadata.project_id,stage=command.stage||command.node_type||'project';ctx.signal.throwIfAborted()
    if(command.kind==='rules')return {next:await projects.documents.saveRules(id,stage,command.value,{previous:command.previousValue})}
    if(command.kind==='confirm_stage')return {next:await projects.documents.mutate(id,async p=>{ctx.signal.throwIfAborted();if(p.node_states[stage].product_revision!==command.expected_revision)throw Object.assign(new Error('产物已变化，请刷新后确认'),{code:'EDIT_CONFLICT'});await this.confirm(p,stage);ctx.signal.throwIfAborted();p.node_states[stage].status='confirmed';p.node_states[stage].reason='人工检查确认';p.node_states[stage].opinion='';return p})}

    const box=nodeBoxes[manualStage(command)];if(!box?.manual)throw new TypeError('未知人工操作');return box.manual.call(this,ctx,command)
  }
  async dispose(){if(this.closed)return;this.closed=true;await Promise.allSettled([...this.pending.values()]);await this.memoryMaintenance.dispose();this.images.dispose()}
}
