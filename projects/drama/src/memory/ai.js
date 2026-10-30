import {modelMemoryEntry} from './service.js'
import {modelClient} from '@agent-modules/http-client'
const tool=(name,properties={},required=Object.keys(properties))=>({type:'function',function:{name,description:name,parameters:{type:'object',properties,required,additionalProperties:false}}})
const str={type:'string'}
/** 一次Step一次原生工具模型调用，独立审核不继承作者消息。 */
export async function memoryTurn(service,ctx,{unit,candidate,phase,issues=[],rules}){
  const action=ctx.step.kind==='review'?'review':ctx.step.round?'revise':'generate',old=ctx.previousResults.filter(s=>s.result?.phase===phase),traces=[]
  if(old.length>=30)throw new TypeError('本记忆单元读取已达30轮，请查看记录后重新整理')
  for(const row of old)if(row.result?.trace_ref)traces.push(await service.read(ctx.task.group_id,row.result.trace_ref))
  const initial=[{role:'system',content:'先按skill_index使用read_skill读取当前动作规则，再read_unit；有候选时read_candidate。通过submit提交当前动作，不直接输出正文。'}, {role:'user',content:JSON.stringify({domain:'video_production',action,mode:unit.mode,has_candidate:!!candidate,scope:ctx.task.metadata.scope,skill_index:[{name:'drama-memory-maintenance-'+action,description:'当前记忆动作的完整规则，必读'}],unit_id:unit.id,source_count:unit.rows?.length,existing_count:unit.existing?.length||0,issues})}]
  let size=JSON.stringify(initial).length;const kept=[];for(const t of traces.slice().reverse()){const n=JSON.stringify(t).length;if(size+n>80000)break;kept.unshift(...t);size+=n}
  const messages=[...initial,...kept],input_ref=await service.write(ctx.task.group_id,messages)
  const config=await service.models.read();ctx.recordPrompt({model:config.text.model,messages:[{role:'user',content:JSON.stringify({input_ref})}],input:{input_ref,phase}})
  const record=async(transfer,options)=>{try{ctx.recordHttp(transfer,options)}catch(error){if(error.code!=='STEP_CLOSED')throw error}await service.projects.records.http.record(transfer,options)}
  const response=await (service.client||modelClient).turn({baseUrl:config.baseUrl,apiKey:config.apiKey,model:config.text.model,messages,tools:[tool('read_skill'),tool('read_unit'),tool('search_existing',{query:str,offset:{type:'integer',minimum:0}},[]),tool('read_existing',{id:str}),tool('read_candidate'),tool('submit',{output:{type:'object'}})],signal:ctx.signal,requestId:ctx.step.id,record})
  ctx.signal.throwIfAborted();if(JSON.stringify(response).length>30000)throw new TypeError('记忆单元输出过大，请拆小对话再整理')
  const delta=[response],readIds=new Set(old.flatMap(s=>s.result?.read_ids||[]));let skillRead=old.some(s=>s.result?.skill_read);let unitRead=old.some(s=>s.result?.unit_read),candidateRead=old.some(s=>s.result?.candidate_read),accepted=null,error=null,budget=0
  for(const call of response.tool_calls||[]){let result;const before={skillRead,unitRead,candidateRead,ids:[...readIds]};try{const args=JSON.parse(call.function.arguments||'{}');switch(call.function.name){
   case'read_skill':result=rules[action];skillRead=true;break
   case'read_unit':{const {existing,messages,...body}=unit;result={...body,existing_index:existing?.slice(0,20).map(({id,title,key,kind,stages})=>({id,title,key,kind,stages})),existing_total:existing?.length||0};unitRead=true;break}
   case'search_existing':{const offset=args.offset??0;if(!Number.isSafeInteger(offset)||offset<0||typeof(args.query??'')!=='string'||(args.query||'').length>200)throw new TypeError('检索参数无效');const rows=(unit.existing||[]).filter(e=>JSON.stringify([e.key,e.title,e.content]).includes(args.query||''));result={total:rows.length,entries:rows.slice(offset,offset+20).map(({id,title,key,kind,stages})=>({id,title,key,kind,stages}))};break}
   case'read_existing':{const entry=(unit.existing||[]).find(e=>e.id===args.id);if(!entry)throw new TypeError('已有记忆不属于本任务快照');result=modelMemoryEntry(entry);readIds.add(entry.id);break}
   case'read_candidate':if(!candidate)throw new TypeError('本动作无候选');result=candidate;candidateRead=true;break
   case'submit':if(response.tool_calls.length!==1||!skillRead||!unitRead||candidate&&!candidateRead)throw new TypeError('须先读取单元/候选，并单独提交');if(action==='review'){for(const id of candidate?.operations?.flatMap(op=>op.target_ids)||[])if(!readIds.has(id))throw new TypeError('审核前须读取候选涉及的已有记忆');if(!['passed','needs_changes'].includes(args.output?.status)||!Array.isArray(args.output.issues)||args.output.issues.length>20||args.output.issues.some(i=>typeof i!=='string'||i.length>1000)||args.output.status==='passed'&&args.output.issues.length)throw new TypeError('审核输出无效')}else service.validate(unit,args.output,ctx.task.metadata.scope,readIds);accepted=args.output;result={accepted:true};break
   default:throw new TypeError('未知记忆工具')}
   if(JSON.stringify(result).length+budget>28000)throw new TypeError('本轮读取预算已满，请下一轮继续')
  }catch(e){if(!(e instanceof TypeError)&&!(e instanceof SyntaxError))throw e;skillRead=before.skillRead;unitRead=before.unitRead;candidateRead=before.candidateRead;readIds.clear();before.ids.forEach(id=>readIds.add(id));result={error:e.message};if(call.function.name==='submit'){accepted=null;error=e.message}}
  budget+=JSON.stringify(result).length;delta.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)})}
  if(!response.tool_calls?.length)delta.push({role:'user',content:'请使用读取工具和submit提交结果。'})
  const trace_ref=await service.write(ctx.task.group_id,delta);if(error&&old.filter(s=>s.result?.validation_error).length>=2)throw new TypeError('记忆输出修复失败：'+error)
  return {accepted,result:{phase,trace_ref,skill_read:skillRead,unit_read:unitRead,candidate_read:candidateRead,read_ids:[...readIds],validation_error:error}}
}
