import {projectNodeStates} from '../../../shared/production/production_stages.js'
import {uid,readJSON,stageStep} from './execution_support.js'

/** 共用Task/单元文件生命周期；各类型执行器负责自己的步骤、业务和模型调用。 */
export class UnitProductionExecutor {
  constructor(service,stages){this.service=service;this.projects=service.projects;this.stages=stages}
  assertStage(stage){if(!this.stages.includes(stage))throw new TypeError(`此执行器不支持制作步骤：${stage}`)}
  plan(task){this.assertStage(task.node_type);return [stageStep('prepare')]}
  async execute(ctx){
    this.assertStage(ctx.task.node_type);ctx.signal.throwIfAborted()
    await this.projects.context(ctx.task.metadata.session_id,ctx.task.metadata.project_id)
    if(ctx.step.kind==='prepare')return this.prepare(ctx)
    if(ctx.step.kind==='finish')return this.finish(ctx)
    if(!this.stepKinds.includes(ctx.step.kind))throw new TypeError(`此执行器不支持内部步骤：${ctx.step.kind}`)
    return this.executeUnit(ctx)
  }
  get stepKinds(){return ['execute']}
  async createUnits(){throw new TypeError('执行器未定义工作单元')}
  nextStep(){return 'execute'}
  async afterUnits(_ctx,_manifest,manifestRef){return [stageStep('finish',{manifest_ref:manifestRef})]}
  requiresConfirmation(){return false}
  async prepare(ctx){
    const {projects}=this,stage=ctx.task.node_type,id=ctx.task.metadata.project_id,project=await projects.documents.read(id)
    let manifest
    if(ctx.task.metadata.resume_manifest_ref){
      manifest=await readJSON(projects,id,ctx.task.metadata.resume_manifest_ref);manifest.completed={...manifest.completed,...ctx.task.metadata.resume_completed}
    }else{
      const units=await this.createUnits(ctx,project,ctx.task.metadata.options),refs=[]
      for(const unit of units){ctx.signal.throwIfAborted();refs.push({id:unit.id,ref:await projects.documents.writeArtifact(id,JSON.stringify(unit),{extension:'json'})})}
      manifest={stage,units:refs,completed:{},source_revision_id:project.source.current_revision_id,summary_frontier:null}
    }
    const manifestRef=await projects.documents.writeArtifact(id,JSON.stringify(manifest),{extension:'json'})
    return {result:{manifest_ref:manifestRef,units:manifest.units.length},nextSteps:await this.advance(ctx,manifest,manifestRef)}
  }
  async advance(ctx,manifest,manifestRef,current){
    const id=ctx.task.metadata.project_id,done={...manifest.completed}
    for(const row of ctx.previousResults)if(row.result?.accepted_ref&&row.result?.unit_id)done[row.result.unit_id]={unit_id:row.result.unit_id,unit_ref:row.result.unit_ref,accepted_ref:row.result.accepted_ref}
    if(current)done[current.unit_id]=current
    const next=manifest.units.find(u=>!done[u.id])
    if(next){const unit=await readJSON(this.projects,id,next.ref),resume=ctx.task.metadata.resume_candidates?.[next.id];return [stageStep(this.nextStep(unit,resume),{manifest_ref:manifestRef,unit_ref:next.ref,phase:uid('phase'),...(unit.initial_candidate_ref?{candidate_ref:unit.initial_candidate_ref}:{}),...(resume?{candidate_ref:resume.candidate_ref,previous_issues:resume.issues||[]}:{}),...(resume?.issues?.length?{resume_needs_revision:true}:{})})]}
    return this.afterUnits(ctx,manifest,manifestRef,done)
  }
  async acceptUnit(ctx,result){
    const id=ctx.task.metadata.project_id,manifestRef=ctx.step.metadata.manifest_ref,manifest=await readJSON(this.projects,id,manifestRef),unit=await readJSON(this.projects,id,ctx.step.metadata.unit_ref)
    const accepted_ref=await this.projects.documents.writeArtifact(id,JSON.stringify(result),{extension:'json'})
    this.service.notify(ctx.task)
    return {result:{...result,accepted_ref,unit_ref:ctx.step.metadata.unit_ref,unit_id:unit.id},nextSteps:await this.advance(ctx,manifest,manifestRef,{unit_id:unit.id,unit_ref:ctx.step.metadata.unit_ref,accepted_ref})}
  }
  async finish(ctx){
    const id=ctx.task.metadata.project_id,stage=ctx.task.node_type
    const project=await this.projects.documents.mutate(id,p=>{ctx.signal.throwIfAborted();const human=this.requiresConfirmation(ctx,p)
      projectNodeStates(p)[stage].status=human?'draft':'confirmed';projectNodeStates(p)[stage].reason=human?'已生成候选，请人工检查并选用':'本阶段已完成';if(!human)projectNodeStates(p)[stage].opinion='';return p})
    this.service.notify(ctx.task);return {result:{saved:true,stage,status:projectNodeStates(project)[stage].status,requires_confirmation:projectNodeStates(project)[stage].status==='draft'}}
  }
}
