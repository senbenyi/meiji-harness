import {MemoryService} from '../memory/service.js'
import {EventEmitter} from 'node:events'
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {ProjectDocumentStore} from './project_document_store.js'
import {projectStages} from './project_document.js'
import {ProjectDocumentExecutor} from '../node_box/project/runtime/executor.js'
import {createWriteQueue} from './write_queue.js'
import {requestIdentity} from './request-identity.js'

/** 全新V2项目入口；不读取旧节点、旧工作稿或执行旧数据迁移。 */
export class ProjectWorkspaceService extends EventEmitter {
 constructor({root,records,workspaceController,sessionController,workspaceForSession}){
  super();Object.assign(this,{root,records,workspaceController,sessionController,workspaceForSession});this.documentVersion=2;this.records.nodeTypes=projectStages.map(row=>({type:row.id,label:row.title}));this.writes=createWriteQueue();this.documents=new ProjectDocumentStore(root)
  this.memories=new MemoryService(this)
  this.executor=new ProjectDocumentExecutor(this)
  this.records.tasks.register('project',{label:'项目与原稿',plan:task=>[{kind:task.action,name:task.name,executor:'program'}],execute:ctx=>this.executor.execute(ctx)})
  for(const stage of projectStages.filter(row=>row.id!=='project'))this.records.tasks.register(stage.id,{label:stage.title,plan:task=>this.production?this.production.plan(task):[{kind:task.action,name:task.name,executor:'program'}],execute:ctx=>ctx.task.metadata.production?this.production.executorFor(ctx.task.node_type).execute(ctx):this.executor.execute(ctx)})
 }
 async bindings(){try{return JSON.parse(await readFile(join(this.root,'bindings.json'),'utf8'))}catch(error){if(error.code==='ENOENT')return {requests:{},sessions:{},drafts:{}};throw error}}
 async saveBindings(value){await mkdir(this.root,{recursive:true});const path=join(this.root,`bindings-${randomUUID()}.tmp`);await writeFile(path,JSON.stringify(value),{mode:0o600});await rename(path,join(this.root,'bindings.json'))}
 async context(sessionId,projectId){const state=await this.bindings();let id=state.sessions[sessionId];if(!id){const workspace=this.workspaceForSession?.(sessionId);id=Object.values(state.requests).find(row=>row.session_id&&!row.deleted&&row.workspace?.id===workspace?.id&&workspace?.path===row.workspace?.path)?.project_id}
  if(!id||projectId&&id!==projectId)throw Object.assign(new Error('当前会话未绑定此项目'),{status:403,code:'PROJECT_SCOPE'});return this.documents.read(id)
 }
 async snapshot(sessionId){await this.production?.ready;try{const project=await this.context(sessionId);const bindings=await this.bindings(),row=Object.values(bindings.requests).find(row=>row.project_id===project.basic_info.id);return {project,session_id:sessionId,workspace:row?.workspace}}catch(error){if(error.code==='PROJECT_SCOPE')return {project:null};throw error}}
 activeExecution(projectId){return this.records.tasks.activeGroups(this.records.scope).flatMap(row=>row.tasks.map(task=>({task,group:row.group}))).find(({task})=>task.metadata.project_id===projectId)}
 sessionInProject(sessionId,projectId){return this.workspaceForSession?.(sessionId)?.path===this.documents.directory(projectId)}
 async nodeStates(sessionId){const {project}=await this.snapshot(sessionId);if(!project)return {project_id:null,nodes:{}};return {project_id:project.basic_info.id,nodes:project.node_states}}
 async listProjects(){const state=await this.bindings();return Promise.all(Object.values(state.requests).filter(row=>row.session_id&&!row.deleted).map(async row=>{const p=await this.documents.read(row.project_id);return {id:row.project_id,name:p.basic_info.name,aspect_ratio:p.basic_info.aspect_ratio,session_id:row.session_id}}))}
 async startSession(requestId){if(typeof requestId!=='string'||!requestId)throw new TypeError('缺少请求ID');return this.writes.run(async()=>{const state=await this.bindings(),id=state.drafts[requestId]||`session-${randomUUID()}`;state.drafts[requestId]=id;await this.saveBindings(state);const cwd=join(this.root,'sessions',id);await mkdir(cwd,{recursive:true});await this.sessionController.create({sessionId:id,cwd,agentPreset:'standard'});await this.applyMainAgent?.(id);return {session_id:id}})}
 async create(input,{sessionId,requestId,source='api'}={}){
  if(!sessionId||!requestId||typeof input?.name!=='string'||!input.name.trim()||input.name.trim().length>100)throw new TypeError('项目名称、会话和请求ID必填')
  let groupId=requestIdentity(['project-v2',sessionId,requestId])
  await this.writes.run(async()=>{
   const state=await this.bindings(),key=JSON.stringify([sessionId,requestId]);let row=state.requests[key]
   const info={name:input.name.trim(),creation_mode:input.creation_mode||'剧本',aspect_ratio:input.aspect_ratio||'9:16'},body=input.original_script??''
   if(typeof body!=='string'||Buffer.byteLength(body)>24*1024*1024)throw new TypeError('原稿不能超过24MiB')
   if(row){if(row.deleted)throw new Error('项目已删除');if(JSON.stringify(row.info)!==JSON.stringify(info))throw new Error('同一请求ID不能使用不同资料');const old=await readFile(join(this.root,row.input_ref),'utf8');if(old!==body)throw new Error('同一请求ID不能使用不同原稿')}
   else{const input_ref=`requests/${randomUUID()}.txt`;await mkdir(join(this.root,'requests'),{recursive:true});await writeFile(join(this.root,input_ref),body,{mode:0o600});row=state.requests[key]={project_id:`p_${randomUUID()}`,info,input_ref,original_name:input.original_script_filename||'剧本.txt'};await this.saveBindings(state)}
   groupId=row.creation_group_id||groupId
   const previous=this.records.tasks.detail(this.records.scope,groupId)
   if(previous&&['failed','cancelled'].includes(previous.status)){row.creation_attempt=(row.creation_attempt||0)+1;groupId=requestIdentity(['project-v2',sessionId,requestId,row.creation_attempt])}
   row.creation_group_id=groupId;await this.saveBindings(state)
   if(!this.records.tasks.detail(this.records.scope,groupId))this.records.tasks.submit(this.records.scope,{group:{id:groupId,name:'创建项目',source},tasks:[{node_type:'project',action:'create',name:'创建项目',metadata:{project_id:row.project_id,source_session_id:sessionId,request_key:key,input_ref:row.input_ref,document_version:2,goal:'创建项目'}}]})
  })
  this.records.tasks.start(this.records.scope);const detail=await this.wait(groupId);await this.projectTaskResult(detail);if(detail.status!=='completed')throw new Error(detail.reason||'创建失败');return {...detail.steps.find(row=>row.result?.created).result.created,group_id:groupId,status:detail.status}
 }
 async projectTaskResult(detail){
  for(const task of detail.tasks){if(!task.metadata?.project_id||!projectStages.some(row=>row.id===task.node_type))continue
   const latest=this.records.tasks.store.read(this.records.scope).tasks.filter(row=>row.metadata?.project_id===task.metadata.project_id&&row.node_type===task.node_type&&!['queued','running'].includes(row.task_status)).sort((a,b)=>b.queue_order-a.queue_order)[0]
   if(latest?.id!==task.id)continue
   try{await this.documents.recordExecution(task.metadata.project_id,task.node_type,{task_id:task.id,status:task.task_status,reason:task.end_reason||task.error_reason||''})}catch(error){if(error.code!=='ENOENT')throw error}
  }
 }
 async wait(groupId){const terminal=()=>{const detail=this.records.tasks.detail(this.records.scope,groupId);return detail&&!['queued','running'].includes(detail.status)?detail:null};if(terminal())return terminal();return new Promise(resolve=>{const unsubscribe=this.records.tasks.store.subscribe(scope=>{if(scope===this.records.scope&&terminal()){const value=terminal();unsubscribe();resolve(value)}});if(terminal()){const value=terminal();unsubscribe();resolve(value)}})}
 async edit(command,{sessionId,projectId,requestId=randomUUID()}={}){
  const project=await this.context(sessionId,projectId);projectId=project.basic_info.id
  if(this.activeExecution(projectId))throw Object.assign(new Error('项目任务正在执行'),{code:'PROJECT_ACTIVE'})
  const stage=command.stage||command.node_type||'project';if(!projectStages.some(row=>row.id===stage))throw new TypeError('未知制作步骤')
  const groupId=requestIdentity(['manual-v2',sessionId,requestId]);const existing=this.records.tasks.detail(this.records.scope,groupId);if(existing){const old=JSON.parse((await this.documents.readArtifact(projectId,existing.tasks[0].metadata.payload_ref)).toString());if(JSON.stringify(old)!==JSON.stringify(command))throw new TypeError('同一请求ID不能使用不同编辑内容')}
  const payload_ref=existing?.tasks[0].metadata.payload_ref||await this.documents.writeArtifact(projectId,JSON.stringify(command),{extension:'json'})
  if(!this.records.tasks.detail(this.records.scope,groupId))this.records.tasks.submit(this.records.scope,{group:{id:groupId,name:'人工编辑',source:'ui'},tasks:[{node_type:command.stage||command.node_type||'project',action:'manual_edit',name:'人工编辑产物',metadata:{project_id:projectId,session_id:sessionId,payload_ref,document_version:2,goal:'人工编辑产物'}}]})
  this.records.tasks.start(this.records.scope);const result=await this.wait(groupId);await this.projectTaskResult(result);if(result.status!=='completed')throw Object.assign(new Error(result.reason||'保存失败'),{status:409});this.emit('updated',{project_id:projectId,session_ids:[sessionId]});return {...await this.snapshot(sessionId),group_id:groupId,operation_result:result.steps.findLast(step=>step.result?.operation_result)?.result.operation_result||null}
 }
 async readOriginalScript(sessionId){const project=await this.context(sessionId),source=project.source.revisions.find(row=>row.id===project.source.current_revision_id);if(!source)throw new Error('尚未导入原稿');return {body:(await this.documents.readArtifact(project.basic_info.id,source.file_ref)).toString(),originalName:source.original_name}}
 async remove({sessionId,projectId}={}){const project=await this.context(sessionId,projectId);projectId=project.basic_info.id;if(this.activeExecution(projectId))throw new Error('请先结束项目任务');await this.writes.run(async()=>{const bindings=await this.bindings();for(const row of Object.values(bindings.requests))if(row.project_id===projectId)row.deleted=true;for(const key of Object.keys(bindings.sessions))if(bindings.sessions[key]===projectId)delete bindings.sessions[key];await this.saveBindings(bindings)});this.emit('updated',{project_id:projectId,deleted:true,session_ids:[sessionId]});return {deleted:true,project_id:projectId,...await this.startSession(randomUUID())}}
 async dispose(){await this.records.tasks.dispose();await this.production?.dispose();await this.memories.dispose();await this.documents.dispose();await this.records.dispose()}
}
