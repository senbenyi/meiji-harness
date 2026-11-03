import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {requestIdentity} from '../project_runtime/request-identity.js'
import {memoryTurn} from './ai.js'
import {MemoryConversations,conversationUnits} from './conversations.js'
import {memoryDomain,memorySignature} from './service.js'
import {projectStages} from '../shared/production/production_stages.js'
import {readNodeRule,readNodeFormat} from '../shared/nodes/node_rule_files.js'
const step=(kind,metadata={},round=0)=>({kind,name:({prepare:'准备记忆资料',analyze:'提炼/压缩记忆',review:'独立复核记忆',finish:'保存记忆结果'})[kind],executor:['analyze','review'].includes(kind)?'ai':'program',metadata,round})
const ref=()=>randomUUID()+'.json'
const groupRows=rows=>{const groups=[];let group=[];for(const row of rows){if(group.length&&JSON.stringify([...group,row]).length>12000){groups.push(group);group=[]}group.push(row)}if(group.length)groups.push(group);return groups}
const sameSet=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&a.every(v=>b.includes(v))

export class MemoryMaintenance {
  constructor({projects,models,client}){
    Object.assign(this,{projects,models,client});this.conversations=new MemoryConversations(projects);
    projects.records.tasks.register('memory_maintenance',{label:'视频创作记忆整理',plan:()=>[step('prepare')],execute:ctx=>this.execute(ctx)})
    if(!projects.records.nodeTypes.some(n=>n.type==='memory_maintenance'))projects.records.nodeTypes.push({type:'memory_maintenance',label:'视频创作记忆整理'})
  }
  path(id,file){if(!/^[a-f0-9]{64}$/.test(id)||!/^[a-f0-9-]{36}\.json$/.test(file))throw new TypeError('记忆任务文件引用无效');return join(this.projects.root,'memory','jobs',id,file)}
  async write(id,value){const file=ref(),path=this.path(id,file);await mkdir(join(this.projects.root,'memory','jobs',id),{recursive:true});await writeFile(path,JSON.stringify(value),{flag:'wx',mode:0o600});return file}
  async read(id,file){return JSON.parse(await readFile(this.path(id,file),'utf8'))}
  async authorize(id,context){const detail=this.projects.records.tasks.detail(this.projects.records.scope,id),task=detail?.tasks[0];if(!task?.metadata.memory_maintenance)throw new TypeError('不是记忆整理任务');if(task.metadata.project_id){const project=await this.projects.context(context.sessionId,context.projectId);if(project.basic_info.id!==task.metadata.project_id)throw new TypeError('记忆任务不属于当前项目')}else if(task.metadata.session_id!==context.sessionId)throw new TypeError('记忆任务不属于此会话');return detail}
  async history(context,scope){
    if(!['project','engineering'].includes(scope))throw new TypeError('记忆范围无效')
    let project;try{project=await this.projects.context(context.sessionId,context.projectId)}catch(e){if(scope!=='engineering'||e.code!=='PROJECT_SCOPE')throw e}
    const tasks=this.projects.records.tasks.store.read(this.projects.records.scope,{steps:false}).tasks.filter(t=>t.metadata?.memory_maintenance&&(t.metadata.scope===scope||scope==='project'&&t.metadata.scope==='effective')&&(t.metadata.project_id?t.metadata.project_id===project?.basic_info.id:t.metadata.session_id===context.sessionId)).sort((a,b)=>b.queue_order-a.queue_order).slice(0,40)
    return {entries:tasks.map(t=>({id:t.group_id,action:t.action,status:t.task_status,created_at:t.created_at}))}
  }
  async status(id,context,file,{start=0,end=start+16000}={}){const detail=await this.authorize(id,context);if(!file)return detail;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end-start>16000)throw new TypeError('记忆记录每页最多16000字符');const text=JSON.stringify(await this.read(id,file),null,2);return {body:text.slice(start,end),start,end:Math.min(end,text.length),characters:text.length}}
  async run(input={},context){return this.projects.writes.run(()=>this.submit(input,context))}
  async submit({action='extract',scope='project',turns,stage,request_id=randomUUID()}={},context){
    if(!['extract','reconcile','compress'].includes(action)||!['project','engineering','effective'].includes(scope)||scope==='effective'&&action!=='compress')throw new TypeError('记忆整理操作或范围无效')
    let project;try{project=await this.projects.context(context.sessionId,context.projectId)}catch(e){if(scope!=='engineering'||e.code!=='PROJECT_SCOPE')throw e}
    if(stage&&!projectStages.some(s=>s.id===stage))throw new TypeError('未知制作步骤')
    const request_identity=requestIdentity([action,scope,stage||'',JSON.stringify(turns??null)]),id=requestIdentity(['memory-maintain',context.sessionId,request_id]),old=this.projects.records.tasks.detail(this.projects.records.scope,id)
    if(old){await this.authorize(id,context);if(old.tasks[0].metadata.request_identity!==request_identity)throw new TypeError('同一请求ID不能改变记忆整理输入');return {group_id:id,status:old.status}}
    if(project&&this.projects.activeExecution(project.basic_info.id))throw Object.assign(new Error('项目已有执行任务，请结束后整理记忆'),{code:'PROJECT_ACTIVE'})
    const actualScope=scope==='effective'?'project':scope,location=await this.projects.memories.location(context,actualScope),data=await this.projects.memories.load(location.path)
    if(turns){if(!project)throw new TypeError('对话整理需要绑定Drama项目');if(!Array.isArray(turns)||turns.length>1000||turns.some(m=>!['user','assistant'].includes(m.role)||typeof(m.text??m.content)!=='string'))throw new TypeError('对话需为user/assistant文字数组');await this.conversations.append(context,turns)}
    const messages=action==='extract'?await this.conversations.pending(context):[]
    if(action==='extract'&&!messages.some(m=>m.role==='user'))return {group_id:null,status:'completed',saved:false,reason:'没有待整理的用户对话'}
    const format=await readNodeFormat('memory_maintenance'),rules=Object.fromEntries(await Promise.all(['generate','review','revise'].map(async action=>[action,(await readNodeRule('memory_maintenance',action))+'\n\n## 返回格式\n'+JSON.stringify(format[action],null,2)]))),entries=await this.projects.memories.entriesFor(scope,context,stage),input={domain:memoryDomain,rules,scope,action,stage:stage||null,revision:data.revision,entries,messages,context:{sessionId:context.sessionId,projectId:project?.basic_info.id}}
    const input_ref=await this.write(id,input)
    this.projects.records.tasks.submit(this.projects.records.scope,{group:{id,name:'视频创作记忆整理',source:context.source||'api',metadata:{project_id:project?.basic_info.id||null,notify_main:false}},tasks:[{node_type:'memory_maintenance',action,name:'视频创作记忆整理',metadata:{memory_maintenance:true,request_identity,project_id:project?.basic_info.id||null,session_id:context.sessionId,scope,stage:stage||null,input_ref}}]})
    this.projects.records.tasks.start(this.projects.records.scope);return {group_id:id,status:this.projects.records.tasks.detail(this.projects.records.scope,id).status}
  }
  async wait(id,signal){if(!id)return {status:'completed',steps:[]};const abort=()=>this.projects.records.tasks.cancel(this.projects.records.scope,id,'会话停止记忆整理');if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});try{return await this.projects.wait(id)}finally{signal?.removeEventListener('abort',abort)}}
  async cancel(id,context){await this.authorize(id,context);this.projects.records.tasks.cancel(this.projects.records.scope,id,'用户停止记忆整理');return {cancelled:true}}
  async observe(options){
    if(!options.sessionId||!Array.isArray(options.messages)||options.purpose&&options.purpose!=='conversation')return
    const context={sessionId:options.sessionId,source:'api',signal:options.signal};try{await this.projects.context(context.sessionId)}catch(e){if(e.code==='PROJECT_SCOPE')return;throw e}
    const added=await this.conversations.append(context,options.messages)
    const users=added.pending.filter(m=>m.role==='user'),body=users.map(m=>m.text).join('\n')
    if(users.length<3&&body.length<1500&&!/记住|以后.*(?:Drama|项目)|改为|不再|统一.*风格/i.test(body))return
    const project=await this.projects.context(context.sessionId);if(this.projects.activeExecution(project.basic_info.id))return
    // 工程提炼先读取同一原始对话；项目提炼成功后才推进共享处理游标。
    if(/跨项目|所有项目|每个项目|以后.*Drama/i.test(body)){const engineering=await this.run({action:'extract',scope:'engineering'},{...context,source:'api'});const result=await this.wait(engineering.group_id,context.signal);if(result.status!=='completed')return}
    const started=await this.run({action:'extract',scope:'project'},context);await this.wait(started.group_id,context.signal)
  }
  async ensure(stage,context){
    let snapshot=await this.projects.memories.capture(context,stage)
    if(!snapshot.digest&&(snapshot.entries.length>24||JSON.stringify(snapshot.entries.map(e=>e.content)).length>6000)){
      const run=await this.run({action:'compress',scope:'effective',stage},{...context,source:'api'}),done=await this.wait(run.group_id);if(done.status!=='completed')throw new Error('记忆压缩未完成：'+done.reason);snapshot=await this.projects.memories.capture(context,stage)
    }
    return snapshot
  }
  validate(unit,output,scope,readIds){
    if(!output||typeof output!=='object'||JSON.stringify(output).length>16000)throw new TypeError('记忆候选无效或超过16000字符')
    if(unit.mode==='compress'){
      if(typeof output.summary!=='string'||!output.summary.trim()||output.summary.length>1800||!Array.isArray(output.represented)||!sameSet(output.represented,unit.rows.map(r=>r.id)))throw new TypeError('压缩须提供≤1800字符摘要且完整覆盖所有输入row id')
      return
    }
    if(!Array.isArray(output.operations)||output.operations.length>12)throw new TypeError('记忆操作最多12项')
    for(const op of output.operations){
      if(!['add','update','merge','supersede','archive','conflict'].includes(op.action)||!Array.isArray(op.target_ids)||op.target_ids.length>12||new Set(op.target_ids).size!==op.target_ids.length||!Array.isArray(op.evidence)||op.evidence.length>20)throw new TypeError('操作结构无效')
      const targets=op.target_ids.map(id=>{const entry=unit.existing.find(e=>e.id===id);if(!entry||!readIds.has(id))throw new TypeError('更改前须读取本范围已有记忆');return entry})
      const cited=[]
      for(const e of op.evidence){const source=unit.messages.find(m=>m.id===e.turn_id&&m.role==='user');if(!source||typeof e.quote!=='string'||!e.quote.trim()||!source.text.includes(e.quote)||e.quote.length>2000)throw new TypeError('证据必须是用户发言中的实际原文');cited.push(e.quote)}
      if(!['merge','conflict'].includes(op.action)&&!cited.length)throw new TypeError('新增/修改/取消必须有用户原话证据')
      if(['update','supersede','archive'].includes(op.action)&&targets.length!==1||op.action==='merge'&&targets.length<2||op.action==='conflict'&&targets.length<1)throw new TypeError('操作目标数量无效')
      if(['update','supersede','archive'].includes(op.action)&&!cited.some(q=>/改|取消|不再|不用|替换|instead|replace|no longer/i.test(q)))throw new TypeError('替代/失效必须有明确用户修改原话')
      if(scope==='engineering'&&['add','update','supersede','archive'].includes(op.action)&&(!cited.some(q=>q.includes(op.global_quote||'\u0000'))||!/跨项目|所有项目|每个项目|Drama.*(?:都|统一)|all.*projects/i.test(op.global_quote||'')))throw new TypeError('工程新增必须有明确跨Drama通用原话')
      if(op.action==='merge'&&targets.some(t=>t.kind!==targets[0].kind||JSON.stringify(t.stages)!==JSON.stringify(targets[0].stages)))throw new TypeError('不能合并不同类型或适用范围')
      if(op.action==='add'&&unit.existing.some(e=>e.key===op.key))throw new TypeError('主题已存在，请先读取并使用明确替代或冲突操作，不能新增覆盖')
      if(op.action!=='archive'){
        if(typeof op.key!=='string'||!op.key.trim()||op.key.length>80||typeof op.title!=='string'||!op.title.trim()||op.title.length>100||typeof op.content!=='string'||!op.content.trim()||op.content.length>2000||!['decision','constraint','preference','open_question'].includes(op.kind)||!Array.isArray(op.stages)||op.stages.some(s=>!projectStages.some(n=>n.id===s)))throw new TypeError('记忆正文/类型/适用步骤无效')
        if(scope==='engineering'&&op.kind!=='preference'&&op.action!=='conflict')throw new TypeError('工程范围只能存视频制作偏好')
        if(op.action==='merge'&&targets.some(t=>['decision','constraint'].includes(t.kind)&&!op.content.includes(t.content)))throw new TypeError('合并不能丢弃决定/约束原文')
      }
    }
  }
  async prepare(ctx,input,inputRef=ctx.task.metadata.input_ref){
    const rows=input.action==='extract'?conversationUnits(input.messages):input.entries.map(e=>({id:e.id,key:e.key,content:e.content,kind:e.kind,stages:e.stages}))
    const units=(input.action==='extract'?rows.map(row=>[row]):groupRows(rows)).map((rows,i)=>({id:`${input.action}_${randomUUID()}`,mode:input.action==='compress'?'compress':input.action,rows,messages:input.action==='extract'?rows.map(r=>({id:r.turn_id,role:'user',text:r.text})):[],existing:[]}))
    const manifest={input_ref:inputRef,mode:input.action,units:[]}
    for(const unit of units){const unit_ref=await this.write(ctx.task.group_id,unit);manifest.units.push({id:unit.id,ref:unit_ref})}
    const manifest_ref=await this.write(ctx.task.group_id,manifest)
    return {result:{manifest_ref},nextSteps:units.length?[step('analyze',{manifest_ref,unit_ref:manifest.units[0].ref,phase:randomUUID()})]:[step('finish',{manifest_ref})]}
  }
  async execute(ctx){
    ctx.signal.throwIfAborted();const id=ctx.task.group_id
    if(ctx.step.kind==='prepare')return this.prepare(ctx,await this.read(id,ctx.task.metadata.input_ref))
    const manifest=await this.read(id,ctx.step.metadata.manifest_ref),input=await this.read(id,manifest.input_ref)
    if(ctx.step.kind==='finish')return this.finish(ctx,input,manifest)
    const unit=await this.read(id,ctx.step.metadata.unit_ref);if(unit.mode!=='compress')unit.existing=input.entries
    const candidate=ctx.step.metadata.candidate_ref?await this.read(id,ctx.step.metadata.candidate_ref):null
    const turn=await memoryTurn(this,ctx,{unit,candidate,rules:input.rules,phase:ctx.step.metadata.phase,issues:ctx.step.metadata.issues||[]})
    if(!turn.accepted)return {result:turn.result,nextSteps:[step(ctx.step.kind,ctx.step.metadata,ctx.step.round)]}
    if(ctx.step.kind==='analyze'){const candidate_ref=await this.write(id,turn.accepted);return {result:{...turn.result,candidate_ref},nextSteps:[step('review',{...ctx.step.metadata,candidate_ref,phase:randomUUID()},ctx.step.round)]}}
    if(turn.accepted.status!=='passed'){
      if(ctx.step.round>=2)return {status:'rejected',reason:turn.accepted.issues.join('\n'),result:{...turn.result,review:turn.accepted,candidate_ref:ctx.step.metadata.candidate_ref}}
      return {result:{...turn.result,review:turn.accepted},nextSteps:[step('analyze',{...ctx.step.metadata,issues:turn.accepted.issues,phase:randomUUID()},ctx.step.round+1)]}
    }
    const accepted_ref=ctx.step.metadata.candidate_ref,accepted={unit_id:unit.id,accepted_ref};return {result:{...turn.result,...accepted,review:turn.accepted},nextSteps:await this.advance(ctx,manifest,accepted)}
  }
  async advance(ctx,manifest,current){
    const id=ctx.task.group_id,done=new Map(ctx.previousResults.filter(r=>r.result?.accepted_ref).map(r=>[r.result.unit_id,r.result.accepted_ref]));done.set(current.unit_id,current.accepted_ref)
    const next=manifest.units.find(u=>!done.has(u.id));if(next)return [step('analyze',{manifest_ref:ctx.step.metadata.manifest_ref,unit_ref:next.ref,phase:randomUUID()})]
    if(manifest.mode==='compress'&&manifest.units.length>1){
      const rows=[];for(const unit of manifest.units)rows.push({id:unit.id,summary:(await this.read(id,done.get(unit.id))).summary})
      const units=[];for(const [i,group]of groupRows(rows).entries()){const unit={id:`reduce_${manifest.depth||0}_${i}`,mode:'compress',rows:group,messages:[],existing:[]};units.push({id:unit.id,ref:await this.write(id,unit)})}
      if(units.length>=manifest.units.length)throw new TypeError('压缩未缩小，请查看摘要长度')
      const manifest_ref=await this.write(id,{...manifest,units,depth:(manifest.depth||0)+1});return [step('analyze',{manifest_ref,unit_ref:units[0].ref,phase:randomUUID()})]
    }
    return [step('finish',{manifest_ref:ctx.step.metadata.manifest_ref,accepted:[...done]})]
  }
  commands(input,plans,ctx){
    const result=[],seen=new Map()
    for(const plan of plans)for(const op of plan.operations){
      const targets=op.target_ids.map(id=>input.entries.find(e=>e.id===id)),signature=JSON.stringify(op)
      for(const id of op.target_ids){if(seen.has(id)&&seen.get(id)!==signature&&!op.evidence.some(e=>/改|不再|替换|instead|replace/i.test(e.quote))){op.action='conflict';op.kind='open_question';op.content='同一主题有不同用户要求，请确认：'+op.content}seen.set(id,signature)}
      if(result.some(c=>c._operation===signature))continue
      const quote=op.evidence.map(e=>e.quote).join('\n').slice(0,2000)||targets.map(e=>e.source.user_quote).join('\n').slice(0,2000),common={user_quote:quote,citations:op.action==='merge'?[...targets.flatMap(e=>e.source.citations||[]),...op.evidence]:op.evidence,_operation:signature}
      if(op.action==='archive'){result.push({...common,action:'archive',id:targets[0].id});continue}
      if(op.action==='conflict'){if(input.scope==='engineering'){result.push({unresolved:op});continue}op.kind='open_question';op.key=('conflict_'+targets.map(t=>t.id.slice(4,12)).sort().join('_')).slice(0,80)}
      const target=['update','merge','supersede'].includes(op.action)?targets[0]:null
      const prior=result.find(c=>c.action==='upsert'&&c.key===(target?.key||op.key));if(op.action==='add'&&prior&&prior.content===op.content&&prior.kind===op.kind&&JSON.stringify(prior.stages)===JSON.stringify(op.stages)){prior.citations.push(...common.citations);continue}if(prior&&(prior.content!==op.content||prior.kind!==op.kind||JSON.stringify(prior.stages)!==JSON.stringify(op.stages))&&!op.evidence.some(e=>/改|不再|替换|instead|replace/i.test(e.quote))){if(input.scope==='engineering'){result.push({unresolved:op});continue}result.push({...common,action:'upsert',key:('conflict_'+op.key).slice(0,80),title:'待确认：'+op.title.slice(0,80),content:('要求一：'+prior.content+'\n要求二：'+op.content+'\n两项要求是否同时适用，待用户确认。').slice(0,2000),kind:'open_question',stages:op.stages});continue}
      result.push({...common,action:'upsert',...(target?{id:target.id}:{}),key:target?.key||op.key,title:op.title,content:op.content,kind:op.kind,stages:op.stages})
      if(op.action==='merge')for(const target of targets.slice(1))result.push({...common,action:'archive',id:target.id})
    }
    return result
  }
  async finish(ctx,input,manifest){
    const id=ctx.task.group_id,accepted=new Map(ctx.step.metadata.accepted||ctx.previousResults.filter(r=>r.result?.accepted_ref).map(r=>[r.result.unit_id,r.result.accepted_ref])),context={...input.context,source:'memory-maintenance',taskId:ctx.task.id,signal:ctx.signal}
    if(input.action==='compress'){
      const value=manifest.units.length?await this.read(id,accepted.get(manifest.units[0].id)): {summary:'无适用记忆'},view=await this.projects.memories.cacheView(input.scope,context,input.stage,input.entries,value.summary,`${id}/${ctx.step.metadata.manifest_ref}`)
      return {result:{saved:true,view_id:view.id,summary:view.summary,source_ids:view.source_ids}}
    }
    const plans=[];for(const unit of manifest.units)plans.push(await this.read(id,accepted.get(unit.id)))
    const proposed=this.commands(input,plans,ctx),unresolved=proposed.filter(c=>c.unresolved).map(c=>c.unresolved),commands=proposed.filter(c=>!c.unresolved);ctx.signal.throwIfAborted();const applied=await this.projects.memories.changeBatch(input.scope,commands,input.revision,context)
    if(input.action==='extract'&&input.scope==='project')await this.conversations.processed(context,input.messages.map(m=>m.id))
    const result={saved:true,changes:applied.changes,revision:applied.revision,conflicts:commands.filter(c=>c.kind==='open_question').length+unresolved.length,unresolved},entries=await this.projects.memories.entriesFor(input.scope,context,input.stage)
    if(commands.length&&(entries.length>8||JSON.stringify(entries.map(e=>e.content)).length>3000)){const nextInput={...input,action:'compress',entries,messages:[]},input_ref=await this.write(id,nextInput),prepared=await this.prepare(ctx,nextInput,input_ref);return {result:{...result,compression_pending:true},nextSteps:prepared.nextSteps}}
    return {result}
  }
  async dispose(){await this.conversations.dispose()}
}
