import {makePlan} from './helpers/adaptation-plan.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectDocument} from '../src/drama_runtime/drama_document.js'
import {applyCandidate,currentCandidate,prepareText} from '../src/node_box/shared/production/text_pipeline.js'
import {parseCandidate,outputContract} from '../src/node_box/shared/agent/contracts.js'
import {actionRules} from '../src/node_box/shared/agent/rules.js'
import {applyCandidate as applyGuidance} from '../src/node_box/adaptation_plan/runtime/pipeline.js'
import {readable} from '../src/client/ui/readable.js'
const guidance=()=>(makePlan({direction:'保持原著主题',requirements:[],development:'保留主线，以人物动机强化冲突；具体分段由定稿决定。',character_plans:[{id:'cp_guard',name:'守卫',description:'守卫营地',motivation:'守住营地',relationships:'与来客对峙',arc:'面对来客作出决定'}],scene_plans:[{id:'sp_camp',name:'营地',function:'承载主线对峙',description:'守卫驻守的营地'}],group_plans:[{id:'guard',name:'守卫队',social_role:'营地守卫',description:'共同组织身份，成员面容各异'}]}))
function sourceProject(){const p=createProjectDocument({id:'p_guidance',name:'全篇指导'});p.source={current_revision_id:'src',revisions:[{id:'src',file_ref:'sources/original.txt',original_name:'原稿.txt',character_count:8,line_index_ref:null}]};p.source_analysis={source_revision_id:'src',chapters:[{id:'c1',sequence:1,title:'前部',body:'原著前部',summary:''},{id:'c2',sequence:2,title:'后部',body:'原著后部',summary:''}],facts_ref:null,coverage_ref:null};p.node_states.source_analysis.status='confirmed';p.adaptation_plan={...guidance(),revision:1,source_revision_id:'src'};p.node_states.adaptation_plan.status='confirmed';return p}
const segment=id=>({id,title:id,body:'完整动作与对白。',continuity:'开场和结尾位置保持连贯。'})
const fakeProjects=()=>({documents:{writeArtifact:async()=> 'artifacts/guidance.json'}})

test('联合改编按全篇约束和四类规划正向组织任务，当前用户要求作为目标',async()=>{
 const [unit]=await prepareText({},'adaptation_plan',sourceProject(),{})
 const description=outputContract('adaptation_plan',unit).properties.creative_constraints.description
 assert.match(unit.material.instruction,/全篇创作约束、全篇剧情发展、人物规划、团队规划、场景规划/)
 assert.match(unit.material.instruction,/因果推进、关键转折/);assert.match(description,/用户明确锁定要求/)
 for(const action of ['generate','review','revise']){
  const rules=await actionRules('adaptation_plan',action,'保留原著对白')
  for(const section of ['全篇创作约束','剧情发展','人物规划','团队规划','场景规划'])assert.ok(rules.includes(section))
  assert.match(rules,/稳定ID/);assert.match(rules,/原著事实边界/)
  assert.match(rules,/短剧定制规则（优先）\n保留原著对白/)
 }
 const [custom]=await prepareText({},'adaptation_plan',sourceProject(),{instruction:'面向成年人，保留科学争论'})
 assert.equal(custom.material.goal,'面向成年人，保留科学争论')
})

test('联合改编契约只有全篇指导与精简团队，禁止旧段计划、声线和制服结构',()=>{
 const output=guidance();parseCandidate('adaptation_plan',{},output)
 assert.throws(()=>parseCandidate('adaptation_plan',{}, {...output,segment_plans:[]}),/不允许字段/)
 assert.throws(()=>parseCandidate('adaptation_plan',{}, {...output,group_plans:[{...output.group_plans[0],costumes:[]}]}),/不允许字段/)
 const next=applyCandidate(createProjectDocument({id:'p_groups',name:'团队'}),'adaptation_plan',{},output)
 assert.equal(next.adaptation_plan.plot_development,output.plot_development);assert.equal(next.adaptation_plan.group_plans.length,1);assert.match(readable({group_plans:output.group_plans}),/团队规划/)
 assert.throws(()=>applyCandidate(next,'adaptation_plan',{}, {...output,group_plans:[output.group_plans[0],output.group_plans[0]]}),/ID重复/)
})

test('联合改编只建一个全篇单元，覆盖全部原著，不再按章制定段计划',async()=>{
 const p=sourceProject(),units=await prepareText({},'adaptation_plan',p,{})
 assert.equal(units.length,1);assert.equal(units[0].kind,'guidance');assert.deepEqual(units[0].source_spans.map(s=>[s.start,s.end]),[[0,4],[4,8]])
 assert.equal(Object.hasOwn(units[0],'chapter_id'),false);assert.equal(Object.hasOwn(units[0],'plan_key'),false)
 await assert.rejects(prepareText({},'adaptation_plan',p,{unit_id:'c1'}),/只生成全篇指导/)
})

test('故事阶段自主返回多段，程序记录来源、顺序和指导版本，不存在上游段计划',async()=>{
 const p=sourceProject(),units=await prepareText(fakeProjects(),'story_segments',p,{})
 assert.equal(units.length,2);assert.deepEqual(units[0].read_refs,['artifacts/guidance.json']);assert.equal(Object.hasOwn(units[0],'plan_item_id'),false)
 const output={segments:[segment('first'),segment('second')]};parseCandidate('story_segments',units[0],output)
 const next=applyCandidate(p,'story_segments',units[0],output)
 assert.deepEqual(next.story_segments.segments.map(s=>[s.id,s.sequence,s.adaptation_revision,s.source_chapter_ids]),[['first',1,1,['c1']],['second',2,1,['c1']]])
 const later=applyCandidate(next,'story_segments',units[1],{segments:[segment('third')]})
 assert.deepEqual(later.story_segments.segments.map(s=>s.id),['first','second','third'])
 const revised=applyCandidate(later,'story_segments',units[0],{segments:[segment('first'),segment('new'),segment('second')]})
 assert.deepEqual(revised.story_segments.segments.map(s=>s.id),['first','new','second','third']);assert.equal(revised.story_segments.segments[0].revision,2);assert.equal(revised.story_segments.segments[3].revision,1)
 assert.throws(()=>applyCandidate(later,'story_segments',units[0],{segments:[segment('third')]}),/其他原著阅读单元/)
 assert.throws(()=>applyCandidate(later,'story_segments',units[0],{segments:[segment('first'),segment('first')]}),/ID不能重复/)
 assert.throws(()=>parseCandidate('story_segments',units[0],{segments:[]}),/至少|长度|数量/)
})

test('定稿修订恢复本阅读范围完整多段候选，保留ID，不读取其他范围正文',async()=>{
 const p=sourceProject(),units=await prepareText(fakeProjects(),'story_segments',p,{})
 let next=applyCandidate(p,'story_segments',units[0],{segments:[segment('one'),segment('two')]},{one:{body_ref:'artifacts/one.txt',continuity_ref:'artifacts/one-cont.txt'},two:{body_ref:'artifacts/two.txt'}})
 next=applyCandidate(next,'story_segments',units[1],{segments:[segment('three')]},{three:{body_ref:'artifacts/three.txt'}})
 const reads=[],projects={documents:{read:async()=>next,readArtifact:async(_id,ref)=>{reads.push(ref);return Buffer.from(ref)}}}
 const candidate=await currentCandidate(projects,'p_guidance','story_segments',units[0])
 assert.deepEqual(candidate.segments.map(s=>s.id),['one','two']);assert.ok(reads.every(ref=>!ref.includes('three')))
 const global=await currentCandidate(projects,'p_guidance','adaptation_plan',{})
 assert.deepEqual(global,Object.fromEntries(Object.entries(p.adaptation_plan).filter(([key])=>!['revision','source_revision_id'].includes(key))));assert.equal(Object.hasOwn(global,'segment_plans'),false)
})

test('定稿必须有当前原稿的有效全篇指导，自由创作允许无原著',async()=>{
 const p=sourceProject();p.adaptation_plan.plot_development='';await assert.rejects(prepareText(fakeProjects(),'story_segments',p,{}),/全篇联合改编指导/)
 p.adaptation_plan.plot_development=sourceProject().adaptation_plan.plot_development;p.adaptation_plan.source_revision_id=null;await assert.rejects(prepareText(fakeProjects(),'story_segments',p,{}),/当前原稿更新/)
 const free=createProjectDocument({id:'p_free',name:'自由故事',creation_mode:'自由创作'});free.adaptation_plan={...guidance(),revision:1,source_revision_id:null};free.node_states.adaptation_plan.status='confirmed'
 const units=await prepareText(fakeProjects(),'story_segments',free,{});assert.equal(units.length,1);assert.deepEqual(units[0].source_chapter_ids,[])
 const next=applyCandidate(free,'story_segments',units[0],{segments:[segment('free')]});assert.equal(next.story_segments.segments.length,1)
})

test('创作约束和剧情事件不可用旧字段或空事件替代',()=>{
 const p=sourceProject(),output=guidance()
 assert.throws(()=>parseCandidate('adaptation_plan',{}, {...output,goal:'旧目标'}),/不允许字段/)
 assert.throws(()=>applyCandidate(p,'adaptation_plan',{}, {...output,creative_constraints:{...output.creative_constraints,style:''}}),/全篇创作约束/)
 assert.throws(()=>applyCandidate(p,'adaptation_plan',{}, {...output,plot_development:''}),/剧情发展/)
})

for(const [key,label]of [['character_plans','主要人物'],['scene_plans','关键场景']])test(`有原稿的联合改编拒绝空${label}规划，拒绝时不修改原文档`,()=>{
 const project=sourceProject(),before=structuredClone(project)
 assert.throws(()=>applyGuidance(project,{}, {...guidance(),[key]:[]}),new RegExp(label))
 assert.deepEqual(project,before)
})

test('有原稿保留人物场景而无团队可保存，无原稿自由创作不强制编造规划',()=>{
 const project=sourceProject();applyGuidance(project,{}, {...guidance(),group_plans:[]})
 assert.equal(project.adaptation_plan.character_plans.length,1);assert.equal(project.adaptation_plan.scene_plans.length,1);assert.deepEqual(project.adaptation_plan.group_plans,[])
 const free=createProjectDocument({id:'p_free',name:'自由创作',creation_mode:'自由创作'})
 applyGuidance(free,{}, {...guidance(),character_plans:[],scene_plans:[],group_plans:[]})
 assert.deepEqual(free.adaptation_plan.character_plans,[])
})

test('审核指出有据可核的遗漏，修订保持有效内容和稳定ID',async()=>{
 const review=await actionRules('adaptation_plan','review'),revise=await actionRules('adaptation_plan','revise')
 assert.match(review,/有原著依据且影响剧情或交接/);assert.match(review,/content_issue/);assert.match(review,/位置、证据和修改方向/)
 assert.match(revise,/补齐主要人物、关键场景、实际团队与剧情推进/);assert.match(revise,/保留有效内容、稳定ID及用户锁定要求/)
 for(const action of ['generate','review','revise'])assert.match(await actionRules('adaptation_plan',action),/无适用团队时返回\[\]/)
})
