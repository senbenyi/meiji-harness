import test from 'node:test'
import assert from 'node:assert/strict'
import {prepareUnit,applyCandidate} from '../src/node_box/shot_design/runtime/pipeline.js'
import {modelTurn} from '../src/node_box/shared/agent/model_loop.js'
import {fixture,call,reply,defaultAuthor} from './helpers/production-fixture.js'
import {outputContract,parseCandidate} from '../src/node_box/shared/agent/contracts.js'

test('分镜单元冻结完整资料和图片引用，下一单元看到新资产，历史输入不变',async()=>{
 const files=new Map([['artifacts/body.txt','本段完整定稿正文。'],['artifacts/continuity.txt','本段结尾持物与人物位置。']]),reads=[]
 const projects={documents:{readArtifact:async(id,ref)=>{reads.push(ref);return Buffer.from(files.get(ref))},writeArtifact:async(id,body)=>{const ref=`artifacts/unit_${files.size}.json`;files.set(ref,body);return ref}}}
 const ctx={signal:new AbortController().signal},project={basic_info:{id:'p_one'},shot_design:{shots:[]},story_segments:{segments:[{id:'seg_1',title:'本段',body_ref:'artifacts/body.txt',continuity_ref:'artifacts/continuity.txt'}]},adaptation_plan:{plot_development:'完整改编指导'},asset_library:{characters:[{id:'char_1',name:'人物',description:'稳定特征',image_ids:['img_existing'],selected_image_id:'img_existing',voice_profile:{description:'低沉'}}],character_looks:[],scenes:[],clothing:[],props:[]}}
 const unit={id:'unit_1',kind:'shots',segment_id:'seg_1',read_refs:['artifacts/body.txt'],material:{asset_index_ref:'snapshot:/asset_library'}}
 const before=structuredClone({project,unit}),first=await prepareUnit.call({projects},ctx,project,unit)
 assert.deepEqual({project,unit},before);assert.deepEqual(reads,['artifacts/body.txt','artifacts/continuity.txt'])
 assert.equal(first.unit.context_mode,'complete');assert.deepEqual(first.unit.read_refs,[])
 assert.equal(first.unit.material.segment.body,'本段完整定稿正文。');assert.equal(first.unit.material.segment.continuity,'本段结尾持物与人物位置。')
 assert.deepEqual(first.unit.material.asset_library.characters,[{name:'人物',description:'稳定特征',voice_description:'低沉'}]);assert.deepEqual(first.unit.material.adaptation_plan,project.adaptation_plan)
 assert.equal(first.unit.material.asset_index_ref,undefined)
 assert.equal(first.unit.material.shot_index,undefined)
 assert.deepEqual(first.unit.material.current_shots,[])
 project.asset_library.props.push({id:'prop_new',name:'新道具',description:'道具描述',image_ids:[],selected_image_id:null})
 const second=await prepareUnit.call({projects},ctx,project,{...unit,id:'unit_2'})
 assert.equal(second.unit.material.asset_library.props[0].name,'新道具');assert.deepEqual(first.unit.material.asset_library.props,[])
 assert.deepEqual(JSON.parse(files.get(first.unitRef)),first.unit)
 await assert.rejects(prepareUnit.call({projects},ctx,project,{...unit,segment_id:'missing'}),/指定故事段不存在/)
})

test('分段候选使用本段顺序，重做替换旧镜头并保留其他段和共享素材需求',()=>{
 const shot=(id,segment,sequence)=>({id,story_segment_id:segment,sequence,revision:1,beats:[]})
 const project={asset_library:{},story_segments:{segments:[{id:'seg_2',sequence:2,revision:1},{id:'seg_1',sequence:1,revision:1}]},shot_design:{shots:[shot('old_1','seg_1',1),shot('old_2','seg_1',2),shot('keep','seg_2',3)]},asset_requirements:{items:[{id:'req_shared',shot_ids:['old_2','keep']},{id:'req_removed',shot_ids:['old_2']}]}}
 const output={assets:{},shots:[shot('new_2','seg_1',2),shot('old_1','seg_1',1)],requirements:[]}
 const before=structuredClone(output)
 applyCandidate(project,{segment_id:'seg_1'},output)
 assert.deepEqual(project.shot_design.shots.map(s=>[s.id,s.sequence]),[['old_1',1],['new_2',2],['keep',3]])
 assert.equal(project.shot_design.shots[0].revision,2)
 assert.deepEqual(project.asset_requirements.items,[{id:'req_shared',shot_ids:['keep']}])
 assert.deepEqual(output,before)
 applyCandidate(project,{segment_id:'seg_2'},{assets:{},shots:[shot('keep','seg_2',1),shot('end','seg_2',2)],requirements:[]})
 assert.deepEqual(project.shot_design.shots.map(s=>s.sequence),[1,2,3,4])
 assert.throws(()=>applyCandidate(structuredClone(project),{segment_id:'seg_1'},{assets:{},shots:[shot('keep','seg_1',1)],requirements:[]}),/其他故事段/)
 assert.throws(()=>applyCandidate(structuredClone(project),{segment_id:'seg_1'},{assets:{},shots:[shot('a','seg_1',1),shot('b','seg_1',1)],requirements:[]}),/本段.*唯一/)
})

async function completeTurn({action='review',material={segment:{body:'本段正文'},asset_library:{}},candidate={shots:[{action:'真实候选动作'}]},output={status:'passed',issues:[],suggestions:[]},readRefs=[],sourceSpans=[]}={}){
 const files=new Map([['artifacts/candidate.json',JSON.stringify(candidate)]]),ctx={signal:new AbortController().signal,task:{metadata:{project_id:'p_one',snapshot_ref:'artifacts/snapshot.json'}},step:{id:'step',metadata:{}},previousResults:[],recordPrompt:()=>{},recordHttp:()=>{}}
 const projects={documents:{readArtifact:async(id,ref)=>Buffer.from(files.get(ref)),writeArtifact:async(id,body)=>{const ref=`artifacts/trace_${files.size}.json`;files.set(ref,body);return ref}},records:{http:{record:async()=>{}}}}
 const unit={id:'unit',kind:'shots',context_mode:'complete',read_refs:readRefs,source_spans:sourceSpans,material}
 const snapshot={basic_info:{output_language:'zh-CN'},node_states:{shot_design:{opinion:'',rules:{generate:'',review:'',revise:''}}},source:{revisions:[]},source_analysis:{chapters:[],source_revision_id:null}}
 let request
 const result=await modelTurn({ctx,projects,unit,unitRef:'artifacts/unit.json',snapshot,stage:'shot_design',action,candidateRef:action==='generate'?undefined:'artifacts/candidate.json',models:{read:async()=>({text:{model:'mock'}})},validate:async()=>{},client:{turn:async input=>{request=input;return reply(output?[call(action==='review'?'submit_review':'submit_candidate',{output})]:[])}}})
 return {request,result,catalog:JSON.parse(request.messages[1].content),trace:JSON.parse(files.get(result.trace.file_ref))}
}

test('首轮完整资料和当前候选可直接审核通过，无需任何资料读取工具',async()=>{
 const r=await completeTurn()
 assert.equal(r.catalog.unit_material_included,true);assert.equal(r.catalog.candidate_included,true)
 assert.equal(r.catalog.unit.material.segment.body,'本段正文');assert.deepEqual(r.catalog.candidate,{shots:[{action:'真实候选动作'}]})
 assert.equal(r.result.pending,false);assert.equal(r.result.output.status,'passed');assert.equal(r.trace.candidate_read,true)
 assert.ok(r.request.tools.every(t=>!t.function.name.startsWith('read_')||t.function.name==='read_memory'))
 assert.ok(r.request.tools.every(t=>!['search_source','search_context'].includes(t.function.name)))
})

for(const action of ['generate','review','revise'])test(`${action}共用首轮完整资料，超过旧16000上限仍不额外读取`,async()=>{
 const material={segment:{body:'正文'.repeat(10000)},asset_library:{}},r=await completeTurn({action,material,output:null})
 assert.deepEqual(r.catalog.unit.material,material);assert.equal(r.catalog.unit_material_included,true)
 assert.equal(r.catalog.candidate_included,action!=='generate');assert.equal(r.request.tools.some(t=>t.function.name==='read_file'),false)
})

for(const action of ['generate','review','revise'])test(`${action}提交工具直接声明当前动作的完整输出契约`,async()=>{
 const r=await completeTurn({action,output:null})
 const submit=r.request.tools.find(t=>t.function.name===(action==='review'?'submit_review':'submit_candidate'))
 assert.deepEqual(submit.function.parameters.properties.output,outputContract('shot_design',{kind:'shots'},action))
 if(action!=='review'){
  const shots=submit.function.parameters.properties.output.properties[action==='revise'?'shot_updates':'shots']
  if(action==='generate')assert.equal(shots.minItems,1)
  const item=action==='revise'?shots.items.properties.shot:shots.items
  assert.equal(item.properties.beats.items.properties.dialogues.type,'array')
 }
})

test('分镜空镜头在输出契约层拒绝',()=>{
 assert.throws(()=>parseCandidate('shot_design',{kind:'shots'},{assets:{characters:[],clothing:[],props:[],scenes:[],character_looks:[]},shots:[],requirements:[]}),/数组不足最小长度/)
})

test('对白字符串与代码字符串拒绝后可修正，合法数组和无对白数组正常保存审核',async t=>{
 let invalid=0
 const feedback=[]
 const f=await fixture(t,{author:async(body,context)=>{
  const message=await defaultAuthor(body,context),catalog=JSON.parse(body.messages[1].content)
  if(catalog.stage!=='shot_design'||catalog.action==='review')return message
  for(const m of body.messages.filter(m=>m.role==='tool')){const result=JSON.parse(m.content);if(result.error)feedback.push(result.error)}
  const submit=message.tool_calls?.find(c=>c.function.name==='submit_candidate')
  if(!submit)return message
  const args=JSON.parse(submit.function.arguments)
  if(invalid<2){
   args.output.shots[0].beats[0].dialogues=invalid++===0?'':"[dlg('line','speaker','对白')]"
   submit.function.arguments=JSON.stringify(args)
  }else{
   const beat=structuredClone(args.output.shots[0].beats[0]);beat.dialogues=[]
   args.output.shots[0].beats.push(beat);submit.function.arguments=JSON.stringify(args)
  }
  return message
 }})
 await f.run('source_analysis');await f.run('adaptation_plan');await f.run('story_segments');await f.run('shot_design')
 assert.equal(invalid,2);assert.ok(feedback.some(s=>/dialogues.*必须为数组/.test(s)))
 const shots=(await f.project()).shot_design.shots
 assert.ok(shots.length)
 for(const shot of shots){assert.equal(shot.beats[0].dialogues[0].text,'来战！');assert.deepEqual(shot.beats[1].dialogues,[])}
 assert.ok(f.calls.filter(c=>c.stage==='shot_design').some(c=>c.action==='review'))
})

test('超大资料或候选明确回退分页，不把未提供的候选认作已读',async()=>{
 const largeMaterial=await completeTurn({material:{body:'长'.repeat(64001)}})
 assert.equal(largeMaterial.catalog.unit_material_included,false);assert.equal(largeMaterial.catalog.unit.material,undefined)
 assert.equal(largeMaterial.catalog.candidate_included,false);assert.equal(largeMaterial.catalog.candidate,undefined)
 assert.ok(largeMaterial.request.tools.some(t=>t.function.name==='read_unit'));assert.equal(largeMaterial.result.pending,true)
 const largeCandidate=await completeTurn({candidate:{body:'长'.repeat(64001)}})
 assert.equal(largeCandidate.catalog.candidate_included,false);assert.ok(largeCandidate.request.tools.some(t=>t.function.name==='read_candidate'))
 assert.equal(largeCandidate.trace.candidate_read,false);assert.match(largeCandidate.trace.validation_error,/读取完整单元资料以及最新候选/)
})

test('首轮附带候选仍保留逐字证据校验，外部必读资料仍保留工具',async()=>{
 const r=await completeTurn({output:{status:'content_issue',issues:[{location:'shots',evidence:'凭空编造的证据',reason:'问题',suggestion:'修改'}],suggestions:[]}})
 assert.equal(r.result.pending,true);assert.match(r.trace.validation_error,/实际原文/)
 const required=await completeTurn({readRefs:['artifacts/required.txt'],output:null})
 assert.ok(required.request.tools.some(t=>t.function.name==='read_file'))
})

test('真实分镜执行每段首轮一次提供全部资料，后段复用前段新增造型，审核修订无需读取',async t=>{
 const f=await fixture(t,{author:async(body,context)=>{
  const message=await defaultAuthor(body,context),catalog=JSON.parse(body.messages[1].content)
  if(catalog.stage==='shot_design'&&catalog.action==='generate')for(const tool of message.tool_calls||[]){
   if(tool.function.name!=='submit_candidate')continue
   const args=JSON.parse(tool.function.arguments)
   tool.function.arguments=JSON.stringify(args)
  }
  return message
 }});await f.run('source_analysis');await f.run('adaptation_plan');await f.run('story_segments')
 await f.run('shot_design');await f.run('shot_design',{revise:true})
 const calls=f.calls.filter(c=>c.stage==='shot_design'),generated=calls.filter(c=>c.action==='generate')
 assert.equal(generated.length,2)
 assert.deepEqual(JSON.parse(generated[0].messages[1].content).unit.material.asset_library.character_looks,[])
 assert.equal(JSON.parse(generated[1].messages[1].content).unit.material.asset_library.character_looks[0].name,'张飞战袍定妆')
 assert.equal(JSON.parse(generated[1].messages[1].content).unit.material.shot_index,undefined)
 assert.deepEqual((await f.project()).shot_design.shots.map(s=>s.sequence),[1,2])
 for(const c of calls){
  const catalog=JSON.parse(c.messages[1].content)
  assert.equal(c.messages.length,2);assert.equal(catalog.unit_material_included,true)
  assert.equal(catalog.unit.material.segment.body,'张飞走进营帐，直视对方，说：“来战！”')
  assert.ok(catalog.unit.material.segment.continuity);assert.ok(catalog.unit.material.adaptation_plan.creative_constraints)
  if(c.action!=='generate'){assert.equal(catalog.candidate_included,true);assert.ok(catalog.candidate.shots.length)}
 }
})
