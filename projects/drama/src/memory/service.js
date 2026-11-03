import {applyMemoryChange} from './mutations.js'
import {mkdir,readFile,writeFile,rename,lstat} from 'node:fs/promises'
import {join,dirname} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createWriteQueue} from '../project_runtime/write_queue.js'
import {projectStages} from '../shared/production/production_stages.js'

export const memoryDomain='video_production'
export const memoryPriority='本次用户明确目标 > 短剧记忆 > Drama工程偏好。正式产物是实际内容来源；记忆不替代产物、不改程序契约，旧审核意见不是新要求。'
const scopes=['project','engineering']
const empty=()=>({schema_version:1,domain:memoryDomain,revision:0,entries:[],history:[]})

const eligible=(entry,stage)=>entry.status==='active'&&(!stage||!entry.stages.length||entry.stages.includes(stage))
const index=entry=>({id:entry.id,scope:entry.scope,key:entry.key,title:entry.title,kind:entry.kind,stages:entry.stages,status:entry.status,revision:entry.revision})

/** 两层用户记忆；盒子只读任务快照，不写长期用户决定。 */
export class MemoryService {
  constructor(projects){this.projects=projects;this.queue=createWriteQueue()}
  async location(context,scope){
    if(!scopes.includes(scope))throw new TypeError('记忆范围必须是project或engineering')
    if(typeof context?.sessionId!=='string'||!context.sessionId)throw new TypeError('需要Drama会话')
    if(scope==='engineering')return {project:null,path:join(this.projects.root,'memory','user-preferences.json')}
    const project=await this.projects.context(context.sessionId,context.projectId)
    return {project,path:join(this.projects.documents.directory(project.basic_info.id),'memory.json')}
  }
  async load(path){
    try{if((await lstat(path)).isSymbolicLink())throw new TypeError('记忆文件不能使用符号链接');const data=JSON.parse(await readFile(path,'utf8'));if(data.schema_version!==1||data.domain!==memoryDomain||!Number.isSafeInteger(data.revision)||!Array.isArray(data.entries)||!Array.isArray(data.history))throw new TypeError('记忆存储格式无效');return data}catch(error){if(error.code==='ENOENT')return empty();throw error}
  }
  async read(scope,options={},context){
    if(options.query!==undefined&&(typeof options.query!=='string'||options.query.length>200))throw new TypeError('记忆检索词最多200字符')
    const {path}=await this.location(context,scope),data=await this.load(path)
    const offset=options.offset??0,limit=options.limit??20
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20)throw new TypeError('记忆分页最多20项')
    if(options.stage&&!projectStages.some(s=>s.id===options.stage))throw new TypeError('未知制作步骤')
    if(options.summary)return {domain:memoryDomain,scope,revision:data.revision,digest:await this.findView(data.entries.filter(e=>eligible(e,options.stage)),scope==='project'?(await this.projects.context(context.sessionId,context.projectId)).basic_info.id:null)}
    if(options.history){const rows=data.history.filter(row=>!options.id||row.entry_id===options.id);return {domain:memoryDomain,scope,revision:data.revision,total:rows.length,entries:rows.slice().reverse().slice(offset,offset+limit)}}
    if(options.id){const entry=data.entries.find(e=>e.id===options.id);if(!entry)throw Object.assign(new Error('记忆不存在'),{code:'ENOENT'});return {domain:memoryDomain,scope,revision:data.revision,entry}}
    const rows=data.entries.filter(e=>(options.include_archived||e.status==='active')&&(!options.stage||!e.stages.length||e.stages.includes(options.stage))&&(!options.query||JSON.stringify([e.key,e.title,e.content]).toLowerCase().includes(String(options.query).toLowerCase())))
    return {domain:memoryDomain,scope,revision:data.revision,total:rows.length,entries:rows.slice(offset,offset+limit).map(index)}
  }
  async save(path,data){
    const bytes=JSON.stringify(data,null,2);if(Buffer.byteLength(bytes)>40*1024*1024)throw new TypeError('记忆存储超过40MiB，请整理后保存')
    await mkdir(dirname(path),{recursive:true});if((await lstat(dirname(path))).isSymbolicLink())throw new TypeError('记忆目录不能使用符号链接')
    const temporary=join(dirname(path),`memory-${randomUUID()}.tmp`);await writeFile(temporary,bytes,{flag:'wx',mode:0o600});await rename(temporary,path)
  }
  async change(scope,command,context){return this.changeBatch(scope,[command],command.expected_revision,context)}
  async changeBatch(scope,commands,expectedRevision,context){
    const {path}=await this.location(context,scope)
    return this.queue.run(async()=>{
      const data=await this.load(path);if(expectedRevision!==data.revision)throw Object.assign(new Error('记忆已被修改，请刷新后保存'),{code:'EDIT_CONFLICT'})
      let result={entry:null,deleted_id:null};for(const command of commands)result=applyMemoryChange(data,scope,command,context)
      if(data.entries.length>500||data.history.length>10000)throw new TypeError('记忆条目或历史过多，请整理后保存')
      context.signal?.throwIfAborted();await this.save(path,data)
      if(commands.some(c=>c.action==='delete')){const ids=new Set(commands.filter(c=>c.action==='delete').map(c=>c.id)),views=await this.views();views.views=views.views.filter(v=>!v.source_ids.some(id=>ids.has(id)));await this.save(join(this.projects.root,'memory','views.json'),views)}
      this.projects.emit('updated',{project_id:scope==='project'?(await this.projects.context(context.sessionId,context.projectId)).basic_info.id:null,memory_scope:scope})
      return {saved:true,domain:memoryDomain,scope,revision:data.revision,...result,changes:commands.length}
    })
  }
  async views(){try{const value=JSON.parse(await readFile(join(this.projects.root,'memory','views.json'),'utf8'));if(value.domain!==memoryDomain||!Array.isArray(value.views))throw new TypeError('压缩视图格式无效');return value}catch(error){if(error.code==='ENOENT')return {domain:memoryDomain,views:[]};throw error}}
  async findView(entries,projectId){const signature=memorySignature(entries);return (await this.views()).views.findLast(v=>v.signature===signature&&(!v.project_id||v.project_id===projectId))||null}
  async entriesFor(scope,context,stage){
    if(scope==='effective')return (await this.resolve(context,stage)).entries
    const {path}=await this.location(context,scope);return (await this.load(path)).entries.filter(e=>eligible(e,stage))
  }
  async cacheView(scope,context,stage,entries,summary,jobRef){
    return this.queue.run(async()=>{const current=await this.entriesFor(scope,context,stage);if(memorySignature(current)!==memorySignature(entries))throw Object.assign(new Error('压缩期间记忆已变化，请重新整理'),{code:'EDIT_CONFLICT'});context.signal?.throwIfAborted();const data=await this.views(),view={domain:memoryDomain,id:`view_${randomUUID()}`,project_id:scope==='engineering'?null:(await this.projects.context(context.sessionId,context.projectId)).basic_info.id,signature:memorySignature(entries),source_ids:entries.map(e=>e.id),summary,job_ref:jobRef,created_at:new Date().toISOString()};data.views=data.views.filter(v=>v.signature!==view.signature||v.project_id!==view.project_id);data.views.push(view);data.views=data.views.slice(-64);await this.save(join(this.projects.root,'memory','views.json'),data);return view})
  }
  async resolve(context,stage){
    const {project,path}=await this.location(context,'project'),projectMemory=await this.load(path),engineering=await this.load((await this.location(context,'engineering')).path),merged=new Map()
    for(const entry of engineering.entries.filter(e=>eligible(e,stage)))merged.set(entry.key,entry)
    for(const entry of projectMemory.entries.filter(e=>eligible(e,stage)))merged.set(entry.key,entry)
    return {schema_version:1,domain:memoryDomain,project_id:project.basic_info.id,stage:stage||null,priority:memoryPriority,project_revision:projectMemory.revision,engineering_revision:engineering.revision,entries:[...merged.values()].sort((a,b)=>a.key.localeCompare(b.key))}
  }
  async capture(context,stage){
    if(!projectStages.some(s=>s.id===stage))throw new TypeError('未知制作步骤')
    return this.queue.run(async()=>{const snapshot=await this.resolve(context,stage),digest=await this.findView(snapshot.entries,snapshot.project_id);return {...snapshot,...(digest?{digest}:{})}})
  }
  async dispose(){await this.queue.run(async()=>{})}
}
export function searchMemory(snapshot,{query='',offset=0,limit=20}={}){
  if(typeof query!=='string'||query.length>200||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20)throw new TypeError('记忆检索范围无效')
  const terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean),rows=snapshot.entries.filter(e=>terms.every(term=>[e.key,e.title,e.content].join(' ').toLowerCase().includes(term)))
  return {total:rows.length,offset,limit,entries:rows.slice(offset,offset+limit).map(index)}
}
export async function taskMemory(projects,task){
  if(!task.metadata.memory_snapshot_ref)return {entries:[],priority:memoryPriority}
  const memory=JSON.parse((await projects.documents.readArtifact(task.metadata.project_id,task.metadata.memory_snapshot_ref)).toString())
  if(memory.domain!==memoryDomain||memory.project_id!==task.metadata.project_id||memory.stage!==task.node_type)throw new TypeError('记忆快照不属于当前任务')
  return memory
}
export async function mediaMemory(projects,task){
  const snapshot=await taskMemory(projects,task);if(!snapshot.entries.length)return ''
  const body=snapshot.digest?JSON.stringify({summary:snapshot.digest.summary,exact_requirements:snapshot.entries.filter(e=>e.kind!=='preference').map(({key,content,kind,scope})=>({key,content,kind,scope}))}):JSON.stringify(snapshot.entries.map(({key,title,content,kind,scope})=>({key,title,content,kind,scope})))
  if(body.length>12000)throw new TypeError('此媒体步骤的适用记忆超过12000字符，压缩后仍有过多决定/约束，请收窄适用步骤或归档旧记忆；不会静默遗漏要求')
  return `用户记忆（仅当前任务冻结版本）\n${snapshot.priority}\n${body}`
}

export const memorySignature=entries=>JSON.stringify(entries.map(e=>[e.id,e.revision]).sort((a,b)=>a[0].localeCompare(b[0])))

// 正文与要求完整返回；大量历史引文留在原始记录，模型先看少量来源和总数。
export function modelMemoryEntry(entry){
  const source=entry.source||{},citations=source.citations
  return {...entry,source:{...source,...(citations?{citations:citations.slice(0,2),citation_count:citations.length}:{})}}
}
