import {makePlan} from './helpers/adaptation-plan.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectDocument,assertProjectDocument,editProjectProduct} from '../src/drama_runtime/drama_document.js'
import {applyCandidate,currentCandidate,prepareText} from '../src/node_box/shared/production/text_pipeline.js'
import {parseCandidate,outputContract} from '../src/node_box/shared/agent/contracts.js'
import {actionRules} from '../src/node_box/shared/agent/rules.js'
import {applyCandidate as applyGuidance} from '../src/node_box/adaptation_plan/runtime/pipeline.js'
const guidance=()=>makePlan({character_plans:[{original_content:'守卫：营地中的守卫',adaptation_plan:'守卫面对来客作出选择，推动冲突'}],scene_plans:[{original_content:'营地：原著中的对峙空间',adaptation_plan:'将营地作为主线对峙的发生地'}],group_plans:[{original_content:'守卫队：营地的守卫组织',adaptation_plan:'通过成员分歧推动主线'}]})
function sourceProject(){const p=createProjectDocument({id:'p_guidance',name:'全篇指导'});p.source={current_revision_id:'src',revisions:[{id:'src',file_ref:'sources/original.txt',original_name:'原稿.txt',character_count:8}]};p.source_analysis={source_revision_id:'src',chapters:[{id:'c1',sequence:1,title:'前部',body:'原著前部',summary:''},{id:'c2',sequence:2,title:'后部',body:'原著后部',summary:''}],coverage_ref:null};p.node_states.source_analysis.status='confirmed';p.adaptation_plan.data=guidance();p.adaptation_plan.state.status='confirmed';return p}
const segment=id=>({id,title:id,body:'完整动作与对白。',continuity:'开场和结尾位置保持连贯。'})
const fakeProjects=()=>({documents:{writeArtifact:async()=> 'artifacts/guidance.json'}})

test('规划按新字段组织单一全篇任务，不预先分段、不创建资产',async()=>{
 const p=sourceProject(),[unit]=await prepareText({},'adaptation_plan',p,{})
 assert.equal(unit.kind,'guidance');assert.deepEqual(unit.source_spans.map(s=>[s.start,s.end]),[[0,8]])
 assert.equal(unit.material.source_ref,'sources/original.txt')
 assert.match(unit.material.instruction,/受众、风格、故事方向、人物规划、团队规划、场景规划/)
 assert.match(unit.material.instruction,/不预先规定故事段数与分段边界/)
 assert.match(unit.material.instruction,/original_content与adaptation_plan/)
 assert.equal(unit.material.existing_guidance_ref,'snapshot:/adaptation_plan/data')
 await assert.rejects(prepareText({},'adaptation_plan',p,{unit_id:'c1'}),/只生成全篇指导/)
 const [custom]=await prepareText({},'adaptation_plan',p,{instruction:'面向成年人，保留科学争论'})
 assert.equal(custom.material.goal,'面向成年人，保留科学争论')
})

test('改编规划直接以原件建立范围，不要求解析状态或解析正文',async()=>{
 const p=sourceProject();p.source_analysis={source_revision_id:null,chapters:[],coverage_ref:null};p.node_states.source_analysis.status='empty'
 const [unit]=await prepareText({},'adaptation_plan',p,{})
 assert.deepEqual(unit.source_spans,[{source_revision_id:'src',start:0,end:8}]);assert.equal(unit.material.source_ref,'sources/original.txt')
 assert.equal(Object.hasOwn(unit.material,'source_index_ref'),false)
 p.source_analysis.chapters=[{id:'derived',sequence:1,title:'解析',body:'不同的派生正文',summary:''}]
 const [again]=await prepareText({},'adaptation_plan',p,{})
 assert.deepEqual(again.source_spans,unit.source_spans)
})

test('生成与修订契约严格对齐新data，拒绝旧字段和规划ID',()=>{
 const output=guidance();parseCandidate('adaptation_plan',{},output)
 for(const action of ['generate','revise'])assert.deepEqual(Object.keys(outputContract('adaptation_plan',{},action).properties),Object.keys(output))
 for(const field of ['creative_constraints','plot_development','revision','source_revision_id','segment_plans'])assert.throws(()=>parseCandidate('adaptation_plan',{}, {...output,[field]:{}}),/不允许字段/)
 assert.throws(()=>parseCandidate('adaptation_plan',{}, {...output,group_plans:[{...output.group_plans[0],id:'old'}]}),/不允许字段/)
 const next=applyCandidate(createProjectDocument({id:'p_groups',name:'团队'}),'adaptation_plan',{},output)
 assert.deepEqual(next.adaptation_plan.data,output);assert.deepEqual(next.asset_library.characters,[])
 assert.deepEqual(Object.keys(next.adaptation_plan),['id','type','data','state'])
 assert.equal(Object.hasOwn(next.adaptation_plan.state,'product_revision'),false)
 assertProjectDocument(next)
})

test('人工编辑不要求版本号，允许覆盖当前节点但拒绝旧版业务字段',()=>{
 let p=sourceProject();p=editProjectProduct(p,'adaptation_plan',{...p.adaptation_plan.data,style:'新风格'})
 p=editProjectProduct(p,'adaptation_plan',{...p.adaptation_plan.data,audience:'成年人'},{expectedRevision:999})
 assert.equal(p.adaptation_plan.data.audience,'成年人');assert.equal(p.adaptation_plan.state.status,'draft')
 assert.equal(p.adaptation_plan.state.checkpoint,null)
 assert.throws(()=>editProjectProduct(p,'adaptation_plan',{...p.adaptation_plan.data,revision:2}),/不允许字段/)
})

test('生成保留已有必须保留情节和创作约束，拒绝空受众风格与主线',()=>{
 const p=sourceProject();p.adaptation_plan.data.story_direction.must_preserve=['保留相见'];p.adaptation_plan.data.story_direction.constraints=['不能改变结局']
 const output=structuredClone(p.adaptation_plan.data),before=structuredClone(p)
 for(const field of ['audience','style'])assert.throws(()=>applyCandidate(p,'adaptation_plan',{}, {...output,[field]:' '}),/受众/)
 assert.throws(()=>applyCandidate(p,'adaptation_plan',{}, {...output,story_direction:{...output.story_direction,main_plot:' '}}),/故事主线/)
 for(const key of ['must_preserve','constraints'])assert.throws(()=>applyCandidate(p,'adaptation_plan',{}, {...output,story_direction:{...output.story_direction,[key]:[]}}),/不能丢失/)
 assert.deepEqual(p,before)
})

for(const [key,label]of [['character_plans','主要人物'],['scene_plans','关键场景']])test('有原稿拒绝空'+label+'规划且不修改输入',()=>{
 const p=sourceProject(),before=structuredClone(p)
 assert.throws(()=>applyGuidance(p,{}, {...guidance(),[key]:[]}),new RegExp(label));assert.deepEqual(p,before)
})

test('团队可空，自由创作不强制编造人物场景',()=>{
 const p=sourceProject();applyGuidance(p,{}, {...guidance(),group_plans:[]});assert.deepEqual(p.adaptation_plan.data.group_plans,[])
 const free=createProjectDocument({id:'p_free',name:'自由创作',creation_mode:'自由创作'})
 applyGuidance(free,{},makePlan());assert.deepEqual(free.adaptation_plan.data.character_plans,[])
})

test('故事定稿按新规划交接，自主分段且不保存改编版本',async()=>{
 const p=sourceProject(),[unit]=await prepareText(fakeProjects(),'story_segments',p,{})
 assert.equal(Object.hasOwn(unit,'adaptation_revision'),false);assert.deepEqual(unit.read_refs,['artifacts/guidance.json'])
 const next=applyCandidate(p,'story_segments',unit,{segments:[segment('first'),segment('second')]})
 assert.deepEqual(next.story_segments.segments.map(s=>[s.id,s.sequence]),[['first',1],['second',2]])
 assert.ok(next.story_segments.segments.every(s=>!Object.hasOwn(s,'adaptation_revision')))
 const candidate=await currentCandidate({documents:{read:async()=>next,readArtifact:async()=>Buffer.from('正文')}},'p_guidance','story_segments',unit)
 assert.deepEqual(candidate.segments.map(s=>s.id),['first','second'])
 p.adaptation_plan.data.story_direction.main_plot=''
 await assert.rejects(prepareText(fakeProjects(),'story_segments',p,{}),/全篇联合改编指导/)
})

test('三个动作规则采用原著内容与具体改编方案，不要求规划ID',async()=>{
 for(const action of ['generate','review','revise']){
  const rule=await actionRules('adaptation_plan',action,'保留原著对白')
  for(const section of ['受众与风格','故事方向','人物规划','团队规划','场景规划'])assert.ok(rule.includes(section))
  assert.match(rule,/original_content和adaptation_plan/);assert.match(rule,/不输出ID/)
  assert.match(rule,/不预先规定故事段数与分段边界/);assert.match(rule,/无适用团队时返回\[\]/)
  assert.match(rule,/短剧定制规则（优先）/)
 }
 assert.match(await actionRules('adaptation_plan','review'),/content_issue/)
})
