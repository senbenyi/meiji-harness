import {assertProjectDocument} from '../project_runtime/project_document.js'
import {nodeBoxes} from '../node_box/registry.js'

const box=stage=>{const pipeline=nodeBoxes[stage]?.pipeline;if(!pipeline)throw new TypeError('此步骤没有文本产物');return pipeline}
export function applyCandidate(document,stage,unit,output,files={}){const next=structuredClone(document);box(stage).applyCandidate(next,unit,output,files);assertProjectDocument(next);return next}
export async function prepareText(projects,stage,project,input,options){const units=await box(stage).prepareText(projects,project,input,options);for(const unit of units)unit.initial_action??=box(stage).initialAction?.(unit)||'generate';return units}
export async function commitTextCandidate(projects,projectId,stage,unit,output,{signal,checkpoint}={}){
  signal?.throwIfAborted()
  const files=await box(stage).writeCandidateFiles(projects,projectId,output)
  return projects.documents.mutate(projectId,p=>{
    signal?.throwIfAborted();const next=applyCandidate(p,stage,unit,output,files),node=next.node_states[stage];node.product_revision++;node.status='partial';node.reason='候选已保存，待独立审核';if(checkpoint)node.checkpoint={...checkpoint,product_revision:node.product_revision};box(stage).afterCommit?.(next);return next
  })
}
export async function currentCandidate(projects,projectId,stage,unit){return box(stage).currentCandidate(projects,projectId,unit,await projects.documents.read(projectId))}
