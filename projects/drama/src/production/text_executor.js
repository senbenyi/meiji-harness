import {UnitProductionExecutor} from './unit_executor.js'
import {uid,readJSON,stageStep} from './execution_support.js'
import {prepareText,applyCandidate,commitTextCandidate,currentCandidate} from './text_pipeline.js'
import {modelTurn} from './model_loop.js'
import {textStages} from './rules.js'
import {nodeBoxes} from '../node_box/registry.js'

/** 文本盒子共用读取、生成、独立审核和修订循环。 */
export class TextProductionExecutor extends UnitProductionExecutor {
  constructor(service){super(service,textStages)}
  get stepKinds(){return ['generate','review','revise']}
  nextStep(unit,resume){return resume?.issues?.length?'revise':resume?.candidate_ref?'review':unit.initial_action||'generate'}
  async createUnits(ctx,project,input){
    const units=await prepareText(this.projects,ctx.task.node_type,project,input,{signal:ctx.signal})
    if(input.revise)for(const unit of units){ctx.signal.throwIfAborted();unit.initial_candidate_ref=await this.projects.documents.writeArtifact(project.basic_info.id,JSON.stringify(await currentCandidate(this.projects,project.basic_info.id,ctx.task.node_type,unit)),{extension:'json'});unit.initial_action='revise'}
    return units
  }
  async executeUnit(ctx){
    const stage=ctx.task.node_type,id=ctx.task.metadata.project_id,hooks=nodeBoxes[stage].pipeline
    const manifestRef=ctx.step.metadata.manifest_ref,manifest=await readJSON(this.projects,id,manifestRef),originalUnitRef=ctx.step.metadata.unit_ref,originalUnit=await readJSON(this.projects,id,originalUnitRef)
    let unitRef=originalUnitRef,unit=originalUnit
    let snapshotRef=ctx.step.metadata.unit_snapshot_ref
    if(!snapshotRef){
      const current=await this.projects.documents.read(id)
      if(hooks.prepareUnit)({unit,unitRef}=await hooks.prepareUnit.call(this,ctx,current,unit,unitRef))
      snapshotRef=await this.projects.documents.writeArtifact(id,JSON.stringify(current),{extension:'json'})
    }
    const snapshot=await readJSON(this.projects,id,snapshotRef),action=ctx.step.kind
    let auditCandidateRef=null
    if(hooks.prepareCandidate){const prepared=await hooks.prepareCandidate.call(this,ctx,unit,unitRef);({unit,unitRef}=prepared);auditCandidateRef=prepared.candidateRef}
    const previous=ctx.previousResults.findLast(row=>row.result?.unit_id===unit.id&&row.result?.candidate_ref),candidateRef=auditCandidateRef||ctx.step.metadata.candidate_ref||previous?.result.candidate_ref
    const issues=ctx.previousResults.findLast(row=>row.result?.unit_id===unit.id&&row.result?.review)?.result.review.issues||ctx.step.metadata.previous_issues||[]
    const turn=await modelTurn({ctx,projects:this.projects,models:this.service.models,unit,unitRef,snapshot,snapshotRef,stage,action,candidateRef,issues,requireSourceCoverage:hooks.requireSourceCoverage===true,client:this.service.textClient,validate:async output=>{
      applyCandidate(await this.projects.documents.read(id),stage,unit,output)
    }})
    const metadata={...ctx.step.metadata,...(candidateRef?{candidate_ref:candidateRef}:{}),...hooks.stepMetadata?.(unit),unit_ref:unitRef,phase:turn.trace.phase,unit_snapshot_ref:snapshotRef}
    if(turn.pending)return {result:{trace:turn.trace,unit_id:unit.id},nextSteps:[stageStep(action,metadata,ctx.step.round)]}
    if(action!=='review'){
      const candidate_ref=await this.projects.documents.writeArtifact(id,JSON.stringify(turn.output),{extension:'json'})
      ctx.signal.throwIfAborted()
      const savedProduct=await commitTextCandidate(this.projects,id,stage,unit,turn.output,{signal:ctx.signal,checkpoint:{task_id:ctx.task.id,unit_id:unit.id,unit_ref:unitRef,candidate_ref,state:'saved'}})
      this.service.notify(ctx.task)
      return {result:{candidate_ref,saved:true,product_revision:savedProduct?.node_states[stage].product_revision??(await this.projects.documents.read(id)).node_states[stage].product_revision,unit_id:unit.id,trace:turn.trace},nextSteps:[stageStep('review',{...metadata,phase:uid('phase'),candidate_ref},ctx.step.round)]}
    }
    const review=turn.output
    if(review.status==='passed'){
      if(hooks.afterReview)({unit,unitRef}=await hooks.afterReview.call(this,ctx,unit,unitRef))
      await this.projects.documents.mutate(id,p=>{ctx.signal.throwIfAborted();p.node_states[stage].checkpoint={task_id:ctx.task.id,unit_id:unit.id,unit_ref:unitRef,candidate_ref:candidateRef,state:'reviewed',product_revision:p.node_states[stage].product_revision};return p})
      const accepted_ref=candidateRef,result={review,accepted_ref,unit_ref:unitRef,unit_id:unit.id,trace:turn.trace,saved:true}
      const advance=await this.advance(ctx,manifest,manifestRef,{unit_id:unit.id,unit_ref:unitRef,accepted_ref})
      return {result,nextSteps:advance}
    }
    let repeated=false;const currentText=(await this.projects.documents.readArtifact(id,candidateRef)).toString();for(const row of ctx.previousResults)if(row.result?.unit_id===unit.id&&row.result?.review&&JSON.stringify(row.result.review.issues)===JSON.stringify(review.issues)&&row.result.candidate_ref&&(await this.projects.documents.readArtifact(id,row.result.candidate_ref)).toString()===currentText)repeated=true
    if(review.status!=='content_issue'||ctx.step.round>=3||repeated)return {status:'rejected',reason:review.issues.map(i=>`${i.location}：${i.reason}`).join('\n'),result:{review,candidate_ref:candidateRef,unit_id:unit.id,trace:turn.trace,saved:true}}
    return {result:{review,candidate_ref:candidateRef,unit_id:unit.id,trace:turn.trace},nextSteps:[stageStep('revise',{...metadata,phase:uid('phase'),candidate_ref:candidateRef},ctx.step.round+1)]}
  }
  async afterUnits(ctx,manifest,manifestRef,done){const hooks=nodeBoxes[ctx.task.node_type].pipeline;return hooks.afterUnits?hooks.afterUnits.call(this,ctx,manifest,manifestRef,done):[stageStep('finish',{manifest_ref:manifestRef})]}
}
