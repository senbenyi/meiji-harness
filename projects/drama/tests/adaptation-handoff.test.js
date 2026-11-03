import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectDocument,assertProjectDocument} from '../src/drama_runtime/drama_document.js'
import {applyCandidate,prepareText,currentCandidate} from '../src/node_box/shared/production/text_pipeline.js'
import {parseCandidate} from '../src/node_box/shared/agent/contracts.js'
import {makePlan} from './helpers/adaptation-plan.js'
const development='主角提出远行计划，委员会质疑可行性。主角以公开论证争取支持，双方围绕风险与收益交锋。高潮中委员会表决通过附带条件的支持，主角据此启程，条件留下后续风险。'
function project(){const p=createProjectDocument({id:'p_handoff',name:'全篇衔接',creation_mode:'自由创作'});p.adaptation_plan={...makePlan({development}),revision:1,source_revision_id:null};p.node_states.adaptation_plan.status='confirmed';return assertProjectDocument(p)}
const segment=id=>({id,title:id,body:'主角在会议厅论证，委员会提出条件后表决通过。',continuity:'委员会支持主角启程，附带条件留待后续处理。'})
const unit={kind:'story',adaptation_revision:1}

test('V4剧情发展为全篇文本，拒绝旧事件对象和段落事件关联',()=>{
 const p=project(),{revision,source_revision_id,...output}=p.adaptation_plan
 assert.equal(p.schema_version,4);assert.equal(parseCandidate('adaptation_plan',{},output).plot_development,development)
 assert.throws(()=>parseCandidate('adaptation_plan',{}, {...output,plot_development:{events:[]}}),/文本为空或类型错误/)
 assert.throws(()=>parseCandidate('story_segments',unit,{segments:[{...segment('one'),plot_event_ids:['old_event']}]}),/不允许字段/)
 assert.throws(()=>assertProjectDocument({...p,schema_version:3}),/固定值/)
})

test('全篇剧情空白时拒绝候选，原文档保持不变',()=>{
 const p=project(),before=structuredClone(p),{revision,source_revision_id,...output}=p.adaptation_plan
 assert.throws(()=>applyCandidate(p,'adaptation_plan',{}, {...output,plot_development:'  '}),/全篇剧情发展/)
 assert.deepEqual(p,before)
})

test('一份全篇规划可自主形成一个或多个故事段，无事件映射',()=>{
 const p=project(),one=applyCandidate(p,'story_segments',unit,{segments:[segment('one')]})
 const many=applyCandidate(p,'story_segments',unit,{segments:[segment('one'),segment('two')]})
 assert.equal(one.story_segments.segments.length,1);assert.equal(many.story_segments.segments.length,2)
 assert.ok(many.story_segments.segments.every(s=>!Object.hasOwn(s,'plot_event_ids')))
})

test('定稿读取冻结全篇剧情与实体规划，按全篇自主分段',async()=>{
 const p=project(),files=[];const units=await prepareText({documents:{writeArtifact:async(_id,text)=>{files.push(text);return 'artifacts/frozen.json'}}},'story_segments',p,{})
 assert.equal(Object.hasOwn(units[0],'plot_event_ids'),false);assert.equal(Object.hasOwn(units[0].material,'plot_event_ids'),false)
 assert.match(units[0].material.instruction,/自主确定全篇叙事分段/)
 p.adaptation_plan.plot_development='后改内容';assert.equal(JSON.parse(files[0]).plot_development,development)
})

test('定稿修订恢复完整段落，不要求事件字段',async()=>{
 const p=applyCandidate(project(),'story_segments',unit,{segments:[segment('one'),segment('two')]})
 const candidate=await currentCandidate({documents:{read:async()=>p,readArtifact:async()=>Buffer.from('已保存正文')}},p.basic_info.id,'story_segments',unit)
 assert.deepEqual(candidate.segments.map(s=>s.id),['one','two']);assert.ok(candidate.segments.every(s=>!Object.hasOwn(s,'plot_event_ids')))
})

test('相邻衔接修订保留指定两段的稳定ID',()=>{
 const p=applyCandidate(project(),'story_segments',unit,{segments:[segment('one'),segment('two')]})
 assert.throws(()=>applyCandidate(p,'story_segments',{kind:'story_audit',segment_ids:['one','two']},{segments:[segment('one'),segment('other')]}),/当前两段/)
 assert.throws(()=>applyCandidate(p,'story_segments',{kind:'story_audit',segment_ids:['one','two']},{segments:[segment('two'),segment('one')]}),/按顺序/)
})

test('人物团队场景规划属于正式JSON并完整冻结交给定稿',async()=>{
 const p=project();p.adaptation_plan.character_plans=[{id:'cp_a',name:'探索者',description:'推动主线',motivation:'争取支持',relationships:'面对委员会',arc:'更加坚定'}];p.adaptation_plan.group_plans=[{id:'gp_a',name:'委员会',social_role:'审议计划',description:'对计划提出条件'}];p.adaptation_plan.scene_plans=[{id:'sp_a',name:'会议厅',function:'公开论证',description:'面对面交锋的空间'}]
 const persisted=JSON.parse(JSON.stringify(assertProjectDocument(p))),files=[]
 const units=await prepareText({documents:{writeArtifact:async(_id,text)=>{files.push(text);return 'artifacts/full-plan.json'}}},'story_segments',persisted,{})
 const frozen=JSON.parse(files[0]);for(const key of ['character_plans','group_plans','scene_plans'])assert.deepEqual(frozen[key],persisted.adaptation_plan[key])
 assert.ok(units[0].read_refs.includes('artifacts/full-plan.json'))
 p.adaptation_plan.character_plans[0].motivation='后改动机';assert.equal(frozen.character_plans[0].motivation,'争取支持')
 assert.match(units[0].material.instruction,/详细、完整、有观赏性/)
})

test('定稿生成与修订保留详细改编要求，审核单独使用验收规则',async()=>{
 const {actionRules}=await import('../src/node_box/shared/agent/rules.js')
 for(const action of ['generate','revise']){
  const rule=await actionRules('story_segments',action)
  assert.match(rule,/联合改编规划/);assert.match(rule,/详细、完整、有观赏性/)
  assert.match(rule,/具体行动、角色反应/);assert.match(rule,/对白/);assert.match(rule,/情感变化/);assert.match(rule,/continuity/)
 }
 const review=await actionRules('story_segments','review');assert.match(review,/联合改编规划/);assert.match(review,/完整故事剧本/);assert.match(review,/suggestions/);assert.match(review,/passed/)
})
