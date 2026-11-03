import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectDocument,assertProjectDocument} from '../src/drama_runtime/drama_document.js'
import {applyCandidate,prepareText} from '../src/node_box/shared/production/text_pipeline.js'
import {parseCandidate} from '../src/node_box/shared/agent/contracts.js'
import {makePlan} from './helpers/adaptation-plan.js'

function project(){const p=createProjectDocument({id:'p_events',name:'因果衔接',creation_mode:'自由创作'});p.adaptation_plan={...makePlan({character_plans:[{id:'cp_a',name:'主角',description:'探索者',motivation:'争取支持',relationships:'与委员会冲突',arc:'坚定'}],scene_plans:[{id:'sp_a',name:'会议厅',function:'公开论证',description:'会议空间'}]}),revision:1,source_revision_id:null};p.adaptation_plan.plot_development.events.push({...p.adaptation_plan.plot_development.events[0],id:'event_two',sequence:2,title:'获得支持',cause:'公开论证说服委员会',action:'委员会表决',result:'附带条件通过'});p.node_states.adaptation_plan.status='confirmed';return assertProjectDocument(p)}
const segment=(id,plot_event_ids)=>({id,title:id,plot_event_ids,body:'主角公开论证，委员会质疑后表决通过。',continuity:'会议厅内，主角获得附带条件的支持。'})
const unit={kind:'story',source_chapter_ids:[],source_spans:[],adaptation_revision:1,plot_event_ids:['event_main','event_two']}

test('V3只接受全篇约束与四类规划，拒绝V2总纲字段',()=>{
 const p=project();assert.equal(p.schema_version,3)
 const {revision,source_revision_id,...output}=p.adaptation_plan
 assert.deepEqual(Object.keys(parseCandidate('adaptation_plan',{},output)).sort(),['creative_constraints','plot_development','character_plans','group_plans','scene_plans'].sort())
 for(const key of ['goal','plot_text','locked_requirements'])assert.throws(()=>parseCandidate('adaptation_plan',{}, {...output,[key]:key==='locked_requirements'?[]:'旧内容'}),/不允许字段/)
 assert.throws(()=>assertProjectDocument({...p,schema_version:2}),/固定值/)
})

test('事件ID、连续顺序及人物团队场景章节引用均校验',()=>{
 for(const change of [p=>p.adaptation_plan.plot_development.events[1].id='event_main',p=>p.adaptation_plan.plot_development.events[1].sequence=3,p=>p.adaptation_plan.plot_development.events[0].character_ids=['missing'],p=>p.adaptation_plan.plot_development.events[0].group_ids=['missing'],p=>p.adaptation_plan.plot_development.events[0].scene_ids=['missing'],p=>p.adaptation_plan.plot_development.events[0].source_chapter_ids=['missing']]){const p=project();change(p);assert.throws(()=>assertProjectDocument(p),/ID重复|连续顺序|引用不存在/)}
})

test('定稿拒绝未知事件、跨单元事件、事件遗漏，拒绝时不改变原文档',()=>{
 const p=project(),before=structuredClone(p)
 assert.throws(()=>applyCandidate(p,'story_segments',unit,{segments:[segment('one',['unknown'])]}),/有效且不重复/)
 assert.throws(()=>applyCandidate(p,'story_segments',{...unit,plot_event_ids:['event_main']},{segments:[segment('one',['event_two'])]}),/其他阅读单元/)
 assert.throws(()=>applyCandidate(p,'story_segments',unit,{segments:[segment('one',['event_main'])]}),/遗漏/)
 assert.deepEqual(p,before)
})

test('事件与段落不机械一一对应，同事件可分段且多事件可合段',()=>{
 const p=project(),combined=applyCandidate(p,'story_segments',unit,{segments:[segment('one',unit.plot_event_ids)]})
 assert.deepEqual(combined.story_segments.segments[0].plot_event_ids,unit.plot_event_ids)
 const split=applyCandidate(p,'story_segments',unit,{segments:[segment('one',['event_main']),segment('two',['event_main','event_two'])]})
 assert.equal(split.story_segments.segments.length,2);assert.deepEqual(split.story_segments.segments[1].plot_event_ids,['event_main','event_two'])
})

test('定稿单元携带事件范围并冻结完整指导，后续修改不改写冻结资料',async()=>{
 const p=project(),files=[];const units=await prepareText({documents:{writeArtifact:async(_id,text)=>{files.push(text);return 'artifacts/frozen.json'}}},'story_segments',p,{})
 assert.deepEqual(units[0].plot_event_ids,unit.plot_event_ids);assert.deepEqual(units[0].material.plot_event_ids,unit.plot_event_ids)
 p.adaptation_plan.plot_development.events[0].result='后改结果'
 assert.notEqual(JSON.parse(files[0]).plot_development.events[0].result,'后改结果')
 assert.match(units[0].material.instruction,/事件不等于故事段/)
})

test('相邻衔接修订必须保留事件归属',()=>{
 const p=applyCandidate(project(),'story_segments',unit,{segments:[segment('one',['event_main']),segment('two',['event_two'])]})
 assert.throws(()=>applyCandidate(p,'story_segments',{kind:'story_audit',segment_ids:['one','two']},{segments:[segment('one',['event_two']),segment('two',['event_main'])]}),/不能改变/)
})
