import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

/** TaskManager owns steps and statuses; this executor performs program-only document changes. */
export class ProjectDocumentExecutor {
 constructor(projects){this.projects=projects}
 execute(ctx){return ctx.task.action==='create'?this.create(ctx):this.manual(ctx)}
 async create(ctx){ctx.signal.throwIfAborted();const m=ctx.task.metadata
  if(ctx.task.action!=='create')return this.manual(ctx)
  return this.projects.writes.run(async()=>{
   const state=await this.projects.bindings(),row=state.requests[m.request_key];if(!row||row.deleted)throw new Error('创建请求已失效')
   let project;try{project=await this.projects.documents.read(row.project_id)}catch(error){if(error.code!=='ENOENT')throw error;project=await this.projects.documents.create({id:row.project_id,...row.info,original_script:await readFile(join(this.projects.root,row.input_ref),'utf8'),original_name:row.original_name})}
   if(!row.workspace){const result=await this.projects.workspaceController.create({path:this.projects.documents.directory(row.project_id)});row.workspace={id:result.workspace.workspaceId,path:this.projects.documents.directory(row.project_id)};await this.projects.saveBindings(state)}
   await this.projects.workspaceController.rename({workspaceId:row.workspace.id,title:project.basic_info.name})
   if(!row.session_id){row.pending_session_id||=`session-${randomUUID()}`;await this.projects.saveBindings(state);row.session_id=(await this.projects.sessionController.create({sessionId:row.pending_session_id,workspaceId:row.workspace.id,agentPreset:'standard'})).sessionId;state.sessions[row.session_id]=row.project_id;await this.projects.saveBindings(state)}
   await this.projects.applyMainAgent?.(row.session_id);const created={project_id:row.project_id,session_id:row.session_id,workspace:row.workspace};this.projects.emit('created',{source_session_id:m.source_session_id,...created});return {result:{created}}
  })
 }
 async manual(ctx){const m=ctx.task.metadata,project=await this.projects.context(m.session_id,m.project_id),command=JSON.parse((await this.projects.documents.readArtifact(m.project_id,m.payload_ref)).toString());let next,operation_result=null
  if(command.kind==='product')next=await this.projects.documents.saveProduct(m.project_id,command.stage,command.value,{expectedRevision:command.expected_revision})
  else if(command.kind==='import_script')next=await this.projects.documents.replaceSource(m.project_id,command.value,{original_name:command.originalName,expectedRevision:command.expected_revision??project.node_states.project.product_revision})
  else if(command.kind==='artifact_text')next=await this.projects.documents.editText(m.project_id,command.stage,command.ref,command.value,{expectedRevision:command.expected_revision})
  else if(command.kind==='basic_info')next=await this.projects.documents.saveBasicInfo(m.project_id,command.value,{expectedRevision:command.expected_revision,source:command.source})
  else if(command.kind==='node_opinion')next=await this.projects.documents.saveOpinion(m.project_id,command.node_type,command.value,{previous:command.previousValue})
  else if(this.projects.production){const outcome=await this.projects.production.manual(ctx,command);next=outcome.next;operation_result=outcome.result||null}
  else throw new TypeError('不支持的编辑操作')
  ctx.signal.throwIfAborted();return {result:{operation_result,payload_ref:m.payload_ref,changed:true,saved:true,document_revision:next.document_revision,stage:command.stage||command.node_type||'project'}}
 }
}
