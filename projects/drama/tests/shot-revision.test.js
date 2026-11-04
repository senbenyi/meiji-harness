import test from 'node:test'
import assert from 'node:assert/strict'
import {mergeRevision,candidateView} from '../src/node_box/shot_design/runtime/pipeline.js'
import {parseCandidate} from '../src/node_box/shared/agent/contracts.js'
import {fixture,defaultAuthor,call,reply} from './helpers/production-fixture.js'

const assets=()=>({characters:[],clothing:[],props:[],scenes:[],character_looks:[]})
const patch=()=>({assets:assets(),shot_updates:[],shot_additions:[],shot_removals:[],shot_order:[],requirements:[]})
const shot=(id,sequence)=>({id,sequence,story_segment_id:'segment',beats:[{action:'原动作',dialogues:[{text:'有效原文'}]}]})
const candidate=()=>({assets:assets(),shots:Array.from({length:9},(_,i)=>shot('shot_'+(i+1),i+1)),requirements:[]})

test('9镜头只修第6镜头，未提及镜头和对白完整保留，输入不被修改',()=>{
 const base=candidate(),change=patch(),before=structuredClone(base)
 change.shot_updates=[structuredClone(base.shots[5])];change.shot_updates[0].beats[0].action='补齐凳脚扫击'
 const patchBefore=structuredClone(change),merged=mergeRevision({segment_id:'segment'},base,change)
 assert.equal(merged.shots.length,9)
 assert.equal(merged.shots[5].beats[0].action,'补齐凳脚扫击')
 for(let i=0;i<9;i++)if(i!==5)assert.deepEqual(merged.shots[i],before.shots[i])
 assert.deepEqual(merged.shots[5].beats[0].dialogues,before.shots[5].beats[0].dialogues)
 assert.deepEqual(base,before);assert.deepEqual(change,patchBefore)
 merged.shots[0].beats[0].action='后续改动';assert.deepEqual(base,before)
})

test('新增、明确删除、完整重排与素材需求合并',()=>{
 const base=candidate();base.requirements=[{id:'req',shot_ids:['shot_1','shot_2']},{id:'remove',shot_ids:['shot_1']}]
 const change=patch();change.shot_additions=[shot('new',1)];change.shot_removals=[{shot_id:'shot_1',reason:'重复镜头已合并'}]
 change.shot_order=['new',...base.shots.slice(1).map(s=>s.id)]
 change.assets.props=[{id:'prop',description:'新增道具'}];change.requirements=[{id:'added',shot_ids:['new']}]
 const merged=mergeRevision({segment_id:'segment'},base,change)
 assert.deepEqual(merged.shots.map(s=>s.id),change.shot_order)
 assert.deepEqual(merged.shots.map(s=>s.sequence),[1,2,3,4,5,6,7,8,9])
 assert.deepEqual(merged.requirements,[{id:'req',shot_ids:['shot_2']},{id:'added',shot_ids:['new']}])
 assert.equal(merged.assets.props[0].id,'prop')
})

test('不明ID、重复/冲突操作、跨段修改、非法重排与删除全部镜头拒绝',()=>{
 const base=candidate(),run=change=>mergeRevision({segment_id:'segment'},base,{...patch(),...change})
 assert.throws(()=>run({shot_updates:[shot('unknown',1)]}),/不存在/)
 assert.throws(()=>run({shot_additions:[shot('shot_1',1)]}),/已存在/)
 assert.throws(()=>run({shot_removals:[{shot_id:'unknown',reason:'删除'}]}),/不存在/)
 assert.throws(()=>run({shot_updates:[base.shots[0],base.shots[0]]}),/重复/)
 assert.throws(()=>run({shot_updates:[base.shots[0]],shot_removals:[{shot_id:'shot_1',reason:'删除'}]}),/冲突/)
 assert.throws(()=>run({shot_updates:[{...base.shots[0],story_segment_id:'other'}]}),/当前故事段/)
 assert.throws(()=>run({shot_order:['shot_1']}),/完整/)
 assert.throws(()=>run({shot_order:base.shots.map(()=> 'shot_1')}),/完整|重复/)
 assert.throws(()=>run({shot_removals:base.shots.map(s=>({shot_id:s.id,reason:'删除'}))}),/非空/)
})

test('修订只接受显式局部契约，拒绝把全文当补丁提交',()=>{
 assert.throws(()=>parseCandidate('shot_design',{kind:'shots'},candidate(),'revise'),/缺少字段|不允许字段/)
 const modelPatch=patch();delete modelPatch.requirements
 assert.deepEqual(parseCandidate('shot_design',{kind:'shots'},modelPatch,'revise'),modelPatch)
})

test('实际生成9镜头→局部修订1镜头→完整候选保存并独立审核9镜头',async t=>{
 let reviews=0,attempts=0,baseline,rawPatch,mergedReview,projectBeforeRevision
 const f=await fixture(t,{author:async(body,context)=>{
  const catalog=JSON.parse(body.messages[1].content)
  if(catalog.stage!=='shot_design')return defaultAuthor(body,context)
  if(catalog.action==='review'){
   if(reviews++===0){
    baseline=structuredClone(catalog.candidate)
    return reply([call('submit_review',{output:{status:'content_issue',issues:[{location:'shots[5].beats[0].action',evidence:baseline.shots[5].beats[0].action,reason:'补充动作衔接',suggestion:'补充落脚后稳住身体'}],suggestions:[]}})])
   }
   mergedReview=structuredClone(catalog.candidate)
   return reply([call('submit_review',{output:{status:'passed',issues:[],suggestions:[]}})])
  }
  if(catalog.action==='revise'){
   const change=patch();delete change.requirements
   const {shot_number,...shot}=structuredClone(catalog.candidate.shots[5]);change.shot_updates=[{shot_number,shot}]
   change.shot_updates[0].shot.beats[0].action+='，落脚后稳住身体';rawPatch=structuredClone(change)
   if(attempts++===0){
    projectBeforeRevision=await context.projects.documents.read(catalog.project_id)
    change.shot_updates[0].shot.beats[0].dialogues[0].speaker='不存在的人物'
   }else assert.deepEqual(await context.projects.documents.read(catalog.project_id),projectBeforeRevision)
   return reply([call('submit_candidate',{output:change})])
  }
  const message=await defaultAuthor(body,context),tool=message.tool_calls.find(c=>c.function.name==='submit_candidate'),args=JSON.parse(tool.function.arguments),original=args.output.shots[0]
  args.output.shots=Array.from({length:9},(_,i)=>{
   const s=structuredClone(original)
   return s
  });tool.function.arguments=JSON.stringify(args);return message
 }})
 await f.run('source_analysis');await f.run('adaptation_plan');await f.run('story_segments')
 const segment=(await f.project()).story_segments.segments[0]
 const detail=await f.run('shot_design',{unit_id:segment.id})
 assert.equal(mergedReview.shots.length,9)
 for(let i=0;i<9;i++)if(i!==5)assert.deepEqual(mergedReview.shots[i],baseline.shots[i])
 assert.match(mergedReview.shots[5].beats[0].action,/落脚后稳住身体/)
 assert.equal(attempts,2)
 assert.ok(detail.steps.some(s=>s.kind==='revise'&&s.result?.trace?.activities.some(a=>a.status==='failed'&&a.detail.includes('名称不存在'))))
 const step=detail.steps.find(s=>s.kind==='revise'&&s.result?.candidate_ref),saved=JSON.parse((await f.projects.documents.readArtifact(f.created.project_id,step.result.candidate_ref)).toString())
 assert.deepEqual(candidateView(await f.project(),saved),mergedReview);assert.equal((await f.project()).shot_design.shots.length,9)
 const trace=JSON.parse((await f.projects.documents.readArtifact(f.created.project_id,step.result.trace.file_ref)).toString())
 const submitted=trace.messages.find(m=>m.role==='assistant').tool_calls[0]
 assert.deepEqual(JSON.parse(submitted.function.arguments).output,rawPatch)
 assert.equal(rawPatch.shot_updates.length,1)
})
