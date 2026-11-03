import test from 'node:test'
import assert from 'node:assert/strict'
import {modelTurn} from '../src/shared/agent/model_loop.js'
import {call,reply} from './helpers/production-fixture.js'

const candidate={goal:'保留原著主线，强化人物动机',locked_requirements:[],plot_text:'保留冲突与关系，强化因果。',character_plans:[],scene_plans:[],group_plans:[]}
function runtime({body='张飞走进营帐，说：“来战！”',material={goal:'保留对白'},required=true}={}){
  const files=new Map(),prompts=[],sourceId='source_current'
  const snapshot={basic_info:{output_language:'zh'},node_states:{adaptation_plan:{opinion:'',rules:{generate:'本项目规则：保留营帐。',review:'独立核对当前候选。',revise:'只修有效意见。'}}},source:{revisions:[{id:sourceId,file_ref:'sources/original.txt'}]},source_analysis:{source_revision_id:sourceId,chapters:[{id:'chapter_one',sequence:1,title:'营帐',body,summary:'人物对峙'}]}}
  const unit={id:'unit_one',kind:'guidance',source_spans:[{source_revision_id:sourceId,start:0,end:body.length}],material}
  files.set('sources/original.txt',body);files.set('artifacts/snapshot.json',JSON.stringify(snapshot));files.set('artifacts/unit.json',JSON.stringify(unit));files.set('artifacts/candidate.json',JSON.stringify(candidate))
  const projects={documents:{readArtifact:async(_id,ref,range)=>{assert.ok(files.has(ref),ref);return range?files.get(ref).slice(range.start,range.end):files.get(ref)},writeArtifact:async(_id,text)=>{const ref=`artifacts/trace_${files.size}.json`;files.set(ref,text);return ref}},records:{http:{record:async()=>{}}}}
  const ctx={signal:new AbortController().signal,task:{metadata:{project_id:'project_one',snapshot_ref:'artifacts/snapshot.json'}},step:{id:'step_one',metadata:{phase:'generate_phase'}},previousResults:[],recordPrompt:p=>prompts.push(p),recordHttp:()=>{}}
  const models={read:async()=>({baseUrl:'http://model.invalid',apiKey:'test',text:{model:'mock'}})}
  let number=0
  const turn=async(calls,{action='generate',candidateRef,...options}={})=>{
    ctx.step={id:`step_${++number}`,metadata:{phase:action+'_phase'}}
    let request
    const result=await modelTurn({ctx,projects,models,unit,unitRef:'artifacts/unit.json',snapshot,snapshotRef:'artifacts/snapshot.json',stage:'adaptation_plan',action,candidateRef,requireSourceCoverage:required,validate:async()=>{},client:{turn:async input=>{request=input;return reply(calls)}},...options})
    ctx.previousResults.push({id:ctx.step.id,result:{trace:result.trace}})
    return {...result,request,stored:JSON.parse(files.get(result.trace.file_ref))}
  }
  return {turn,ctx,files,prompts,unit,snapshot}
}

test('首轮提供当前动作规则、短单元与契约，固定资料不再通过工具读取',async()=>{
  const f=runtime({required:false}),r=await f.turn([call('submit_candidate',{output:candidate})])
  assert.equal(r.pending,false)
  const [system,user]=r.request.messages,catalog=JSON.parse(user.content)
  assert.equal(r.request.messages.length,2);assert.match(system.content,/本项目规则：保留营帐/)
  assert.doesNotMatch(system.content,/审核须完整读取当前候选/)
  assert.deepEqual(catalog.unit.material,{goal:'保留对白'});assert.ok(catalog.output_contract.properties.goal)
  assert.equal(catalog.unit_material_included,true);assert.equal('skill_index' in catalog,false)
  assert.ok(r.request.tools.every(t=>!['read_skill','read_contract','read_unit'].includes(t.function.name)))
  assert.deepEqual(JSON.parse(f.files.get(f.prompts[0].input.messages_ref)),r.request.messages)
})

for(const [name,read]of [
  ['快照全部分段',call('read_context',{pointer:'/source_analysis/chapters'})],
  ['快照单段正文',call('read_context',{pointer:'/source_analysis/chapters/0/body'})],
  ['JSON快照文件',call('read_file_json',{ref:'artifacts/snapshot.json',pointer:'/source_analysis/chapters/0'})],
  ['完整快照文本',call('read_file',{ref:'artifacts/snapshot.json',start:0,end:16000})],
  ['原稿文件',call('read_file',{ref:'sources/original.txt',start:0,end:16000})]
])test(`${name}已读正文后，下一轮可提交且工具历史完整续接`,async()=>{
  const f=runtime(),readResult=await f.turn([read]),r=await f.turn([call('submit_candidate',{output:candidate})])
  assert.equal(readResult.pending,true);assert.equal(r.pending,false)
  assert.equal(r.request.messages[2].tool_calls[0].id,read.id);assert.equal(r.request.messages[3].tool_call_id,read.id)
  assert.equal(r.stored.source_ranges[0].source_revision_id,'source_current')
})

test('摘要与搜索片段不计作原著已读，来源版本不同也不能满足覆盖',async()=>{
  const f=runtime()
  await f.turn([call('read_context',{pointer:'/source_analysis/chapters/0/summary'}),call('search_source',{query:'张飞'})])
  let r=await f.turn([call('submit_candidate',{output:candidate})]);assert.equal(r.pending,true);assert.match(r.stored.validation_error,/读完当前分段正文/)
  await f.turn([call('read_context',{pointer:'/source_analysis/chapters'})]);f.unit.source_spans[0].source_revision_id='different_source'
  r=await f.turn([call('submit_candidate',{output:candidate})]);assert.equal(r.pending,true);assert.match(r.stored.validation_error,/读完当前分段正文/)
})

test('批量读取可在一轮完成，预算拒绝的正文不登记已读',async()=>{
  const body='原'.repeat(11900),f=runtime({body})
  const r=await f.turn(Array.from({length:3},()=>call('read_context',{pointer:'/source_analysis/chapters/0/body'})))
  const results=r.stored.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content))
  assert.equal(typeof results[0],'string');assert.equal(typeof results[1],'string');assert.match(results[2].error,/读取预算/)
  assert.equal(r.stored.source_ranges.length,2)
  const rejected=runtime({body});rejected.files.set('artifacts/pad.json',JSON.stringify({x:'填'.repeat(15000)}));rejected.unit.read_refs=['artifacts/pad.json']
  const denied=await rejected.turn([call('read_file',{ref:'artifacts/pad.json',start:0,end:15000}),call('read_file',{ref:'artifacts/pad.json',start:0,end:15000}),call('read_source',{start:0,end:body.length})])
  assert.equal(denied.stored.source_ranges.length,0)
  const submit=await rejected.turn([call('submit_candidate',{output:candidate})]);assert.match(submit.stored.validation_error,/读完当前分段正文/)
})

test('长单元保持按需读取，未提供的资料不能直接提交',async()=>{
  const f=runtime({required:false,material:{detail:'长'.repeat(17000),goal:'保留对白'}})
  let r=await f.turn([call('submit_candidate',{output:candidate})])
  const catalog=JSON.parse(r.request.messages[1].content)
  assert.equal(catalog.unit_material_included,false);assert.equal('material' in catalog.unit,false);assert.ok(r.request.tools.some(t=>t.function.name==='read_unit'))
  assert.match(r.stored.validation_error,/单元资料/)
  r=await f.turn([call('read_unit',{pointer:'/goal'})]);assert.equal(r.stored.unit_read,false)
  r=await f.turn([call('read_unit',{pointer:'/detail'})]);assert.match(JSON.parse(r.stored.messages.at(-1).content).error,/资料过长/)
  const length=f.files.get('artifacts/unit.json').length
  await f.turn([call('read_file',{ref:'artifacts/unit.json',start:0,end:16000}),call('read_file',{ref:'artifacts/unit.json',start:16000,end:length})])
  r=await f.turn([call('submit_candidate',{output:candidate})]);assert.equal(r.pending,false)
})

test('审核使用独立规则和上下文，读完候选后才允许提交，修订不继承生成历史',async()=>{
  const f=runtime({required:false});await f.turn([call('submit_candidate',{output:candidate})])
  let r=await f.turn([call('submit_review',{output:{status:'passed',issues:[],suggestions:[]}})],{action:'review',candidateRef:'artifacts/candidate.json'})
  assert.equal(r.request.messages.length,2);assert.match(r.request.messages[0].content,/独立核对当前候选/);assert.doesNotMatch(r.request.messages[0].content,/本项目规则：保留营帐/)
  assert.match(r.stored.validation_error,/最新候选/)
  await f.turn([call('read_candidate')],{action:'review',candidateRef:'artifacts/candidate.json'})
  r=await f.turn([call('submit_review',{output:{status:'passed',issues:[],suggestions:[]}})],{action:'review',candidateRef:'artifacts/candidate.json'});assert.equal(r.pending,false)
  r=await f.turn([call('read_candidate')],{action:'revise',candidateRef:'artifacts/candidate.json'});assert.equal(r.request.messages.length,2);assert.match(r.request.messages[0].content,/只修有效意见/)
})

test('读取与提交仍须分轮；纯文本不冒充保存，取消不执行晚到工具',async()=>{
  const f=runtime(),r=await f.turn([call('read_source',{start:0,end:f.unit.source_spans[0].end}),call('submit_candidate',{output:candidate})])
  assert.equal(r.pending,true);assert.match(r.stored.validation_error,/唯一调用/)
  const text=await f.turn([]);assert.equal(text.pending,true);assert.equal(text.stored.messages.at(-1).role,'user')
  const controller=new AbortController();f.ctx.signal=controller.signal
  await assert.rejects(f.turn([],{client:{turn:async()=>{controller.abort();return reply([call('submit_candidate',{output:candidate})])}}}),/abort/i)
})

for(const read of [call('read_file_json',{ref:'artifacts/candidate.json'}),call('read_file',{ref:'artifacts/candidate.json',start:0,end:16000})])test(`${read.function.name}读完整候选后审核可提交，无须重复read_candidate`,async()=>{
  const f=runtime({required:false})
  await f.turn([read],{action:'review',candidateRef:'artifacts/candidate.json'})
  const r=await f.turn([call('submit_review',{output:{status:'passed',issues:[],suggestions:[]}})],{action:'review',candidateRef:'artifacts/candidate.json'})
  assert.equal(r.pending,false)
})

test('历史裁剪保留完整assistant/tool配对，已读范围恢复时不逐轮倍增',async()=>{
  const f=runtime({required:false})
  for(let i=0;i<4;i++){
    const c=call('read_context',{pointer:'/source_analysis/chapters/0/body'}),ref=`artifacts/history_${i}.json`
    f.files.set(ref,JSON.stringify({messages:[reply([c]),{role:'tool',tool_call_id:c.id,content:JSON.stringify({body:'长'.repeat(40000)})}],source_ranges:[{source_revision_id:'source_current',start:0,end:1}]}))
    f.ctx.previousResults.push({id:`history_${i}`,result:{trace:{phase:'generate_phase',file_ref:ref}}})
  }
  const r=await f.turn([call('remember',{note:'保留事实'})])
  assert.match(r.request.messages[2].content,/移出当前窗口/)
  const historical=r.request.messages.slice(3)
  assert.equal(historical.length,4)
  for(let i=0;i<historical.length;i+=2)assert.equal(historical[i].tool_calls[0].id,historical[i+1].tool_call_id)
  assert.equal(r.stored.source_ranges.length,1)
})
