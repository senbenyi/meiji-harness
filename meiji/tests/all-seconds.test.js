import { secondsResponse, secondsContent } from './fixtures/seconds.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel, episodeFixture } from './fixtures/model.js'
import { modelStore } from '../server/data/model-settings.js'
import { runOperation } from '../server/flow/operations/run.js'
import { recordStore } from '../server/data/task-store.js'
import { generateAllSeconds } from '../server/generate/shot-text.js'
import { feedbackOf } from '../shared/feedback.js'
const output = secondsResponse()
test('invalid first seconds result keeps drafts unpublished and exposes the task failure',async t=>{
 const e=await environment(t)
 await e.store.save(e.id,p=>{for(const shot of p.episodes[0].shots.items){shot.seconds.content=null;shot.seconds.check={passed:null,failures:[]};shot.seconds.status='not-generated'}return p})
 await assert.rejects(runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({skill})=>skill==='review'?reviewPass:output.slice(0,-8)})}),/自审未通过/)
 const p=await e.read(),feedback=feedbackOf(p,'seconds')
 assert.ok(p.shots.items.every(shot=>shot.seconds.content===null))
 assert.equal(feedback.status,'failed');assert.equal(feedback.canModify,false)
 assert.match(feedback.error,/自审未通过/)
})
test('seconds feedback includes group failures once and preserves active state',()=>{
 const p=episodeFixture(),reason='S01 与 S02 动作衔接错误'
 p.shots.seconds.check={passed:false,failures:[reason,'整集事件遗漏']}
 p.shots.seconds.status='failed'
 p.shots.items[0].seconds.check={passed:false,failures:[reason,'第一镜错误']}
 const feedback=feedbackOf(p,'seconds')
 assert.deepEqual(feedback.check.failures,[reason,'整集事件遗漏','S01：第一镜错误'])
 assert.equal(feedback.status,'failed');assert.equal(feedback.check.passed,false)
 p.shots.seconds.operation={id:'running-task'};p.shots.seconds.status='generating'
 assert.equal(feedbackOf(p,'seconds').status,'generating')
 p.shots.seconds.operation=null;p.shots.seconds.status='paused'
 assert.equal(feedbackOf(p,'seconds').status,'paused')
})
async function environment(t) {
 const e = await setupModel(t), models = modelStore(e.home)
 await models.write({ ...await models.read(), apiKey: 'test-only' })
 return e
}
test('whole episode generates once, reviews the complete episode, and replaces even previously passed shots', async t => {
 const e=await environment(t), calls=[]
 await runOperation(e.op('seconds',{generationMode:'regenerate'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({ skill, user: prompt }) =>{
  calls.push({skill,prompt});return skill==='review'?reviewPass:output
 }})})
 assert.equal(calls.length,2);assert.equal(calls.filter(c=>c.skill!=='review').length,1)
 assert.match(calls[1].prompt,/第一镜新动作/)
 assert.match(calls[1].prompt,/第二镜接续动作/)
 const p=await e.read()
 assert.ok(p.shots.items.every(s=>s.seconds.check.passed===true && !s.seconds.operation))
 assert.ok(p.shots.items.every(s=>s.storyboard.content===null))
 assert.equal(p.activity,null)
})
test('whole episode failed review revises the complete version once', async t=>{
 const e=await environment(t), calls=[]
 await assert.rejects(runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({ skill, user: prompt }) =>{
  calls.push({skill,prompt})
  if(skill==='review') return reviewFail('第一镜问题')
  return calls.length===1?output:output.replace('第一镜新动作','第一镜修订稿')
 }})}),/第一镜问题/)
 const p=await e.read()
 assert.equal(p.shots.items[0].seconds.content.beats[0].action,'第一镜修订稿')
 assert.equal(p.shots.items[1].seconds.content.beats[0].action,'第二镜接续动作')
 for (const shot of p.shots.items) {
  assert.equal(shot.seconds.check.passed, false)
  assert.equal(shot.seconds.status, 'failed')
  assert.deepEqual(shot.seconds.check.failures, ['位置：本次内容；原因：第一镜问题；修正要求：修正上述问题'])
  assert.equal(shot.seconds.operation, null)
 }
 assert.equal(calls.length,4)
})
for(const text of [output.slice(0, -8), secondsResponse([['S01', 5, '只有一镜']]), secondsResponse([['S01',5,'动作'],['S02',4,'时长错']])]) {
 test('incomplete or mismatched result preserves original content and downstream',async t=>{
  const e=await environment(t),before=await e.read()
  await assert.rejects(runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({skill})=>skill==='review'?reviewPass:text})}),/自审未通过/)
  const after=await e.read()
  for(let i=0;i<2;i++) {
   assert.deepEqual(after.shots.items[i].seconds.content,before.shots.items[i].seconds.content)
   assert.deepEqual(after.shots.items[i].storyboard,before.shots.items[i].storyboard)
  }
 })
}
test('whole generation does not include old seconds or their opinions',async()=>{
 const p=episodeFixture();p.shots.items.forEach(s=>{s.seconds.content='OLD_SECRET';s.seconds.review.text='OLD_OPINION'})
 const calls=[]
 await generateAllSeconds({project:p,request:async ({ skill, user: prompt }) =>{calls.push(prompt);return skill==='review'?reviewPass:output}})
 assert.doesNotMatch(calls[0],/OLD_SECRET|OLD_OPINION/)
})
test('cancellation during review preserves all newly generated drafts and releases ownership',async t=>{
 const e=await environment(t),controller=new AbortController()
 await assert.rejects(runOperation(e.op('seconds'),{home:e.home,signal:controller.signal,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({ skill }) =>{
  if(skill!=='review')return output
  controller.abort();controller.signal.throwIfAborted()
 }})}),{name:'AbortError'})
 const p=await e.read()
 assert.ok(p.shots.items.every(s=>s.seconds.content.beats[0].action.includes('动作') && s.seconds.operation===null))
 assert.equal(p.activity,null)
})
test('storyboard never fills missing seconds in the background',async t=>{
 const e=await environment(t)
 await e.store.save(e.id,p=>{p.episodes[0].shots.items[1].seconds.content=null;return p})
 await assert.rejects(runOperation(e.op('storyboard'),{home:e.home,generateAllSeconds:()=>assert.fail('no implicit fill'),generateShotSeconds:()=>assert.fail('no implicit fill')}),/请先生成整集每秒指令/)
})
test('review preserves new human opinions entered on a different shot',async t=>{
 const e=await environment(t);let reviews=0
 await runOperation(e.op('seconds',{generationMode:'regenerate'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({ skill }) =>{
  if(skill!=='review')return output
  if(reviews++===0)await e.store.saveReviewDraft(e.id,e.episodeId,'seconds:S02','新输入意见',0)
  return reviewPass
 }})})
 assert.equal((await e.read()).shots.items[1].seconds.review.text,'新输入意见')
})
test('unified opinion and numbered failures modify the whole episode and are consumed only on success',async t=>{
 const e=await environment(t)
 await e.store.saveReviewDraft(e.id,e.episodeId,'seconds','统一保持动作方向',0)
 await e.store.save(e.id,p=>{p.episodes[0].shots.items[1].seconds.check={passed:false,failures:['机位反了']};return p})
 const calls=[]
 await runOperation(e.op('seconds',{generationMode:'modify'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({ skill, user: prompt }) =>{
  calls.push(prompt);return skill==='review'?reviewPass:output
 }})})
 assert.match(calls[0],/统一保持动作方向/);assert.match(calls[0],/S02：机位反了/);assert.match(calls[0],/修改基稿/)
 const p=await e.read()
 assert.equal(p.shots.seconds.review.text,'');assert.equal(p.shots.seconds.operation,null)
 assert.ok(p.shots.items.every(s=>s.seconds.review.text===''))
})
test('unified opinion saved while generation runs survives completion',async t=>{
 const e=await environment(t)
 await e.store.saveReviewDraft(e.id,e.episodeId,'seconds','本次意见',0)
 let entered=false
 await runOperation(e.op('seconds',{generationMode:'modify'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({ skill }) =>{
  if(!entered){entered=true;await e.store.saveReviewDraft(e.id,e.episodeId,'seconds','下次意见',1)}
  return skill==='review'?reviewPass:output
 }})})
 assert.equal((await e.read()).shots.seconds.review.text,'下次意见')
})
test('unified opinion is retained after failed review and regeneration does not submit it',async t=>{
 const e=await environment(t)
 await e.store.saveReviewDraft(e.id,e.episodeId,'seconds','保留人工意见',0)
 let generated=false
 await assert.rejects(runOperation(e.op('seconds',{generationMode:'modify'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({ skill }) =>{
  if(skill==='review')return reviewFail('不通过')
  if(!generated){generated=true;return output}return output.replace('第一镜新动作','第一镜修订稿')
 }})}),/自检未通过/)
 assert.equal((await e.read()).shots.seconds.review.text,'保留人工意见')
 await runOperation(e.op('seconds',{generationMode:'regenerate'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({ skill, user: prompt }) =>{
  assert.doesNotMatch(prompt,/保留人工意见/);return skill==='review'?reviewPass:output
 }})})
 assert.equal((await e.read()).shots.seconds.review.text,'保留人工意见')
})
test('old per-shot opinions are collected into one persistent group review',async t=>{
 const e=await environment(t)
 await e.store.save(e.id,p=>{
  const shots=p.episodes[0].shots
  delete shots.seconds
  shots.items[0].seconds.review.text='保留动作'
  shots.items[1].seconds.review.text='保持机位'
  return p
 })
 const group=(await e.read()).shots.seconds
 assert.equal(group.id,'seconds');assert.match(group.review.text,/S01：保留动作/);assert.match(group.review.text,/S02：保持机位/)
 await e.store.saveReviewDraft(e.id,e.episodeId,'seconds','统一意见',group.review.revision)
 assert.equal((await e.read()).shots.seconds.review.text,'统一意见')
})


for (const count of [1, 2, 5]) test(`initial generation covers ${count} shots in one request`, async () => {
 const project = episodeFixture(); const template = project.shots.items[0]
 project.shots.items = Array.from({length: count}, (_,i) => ({...structuredClone(template), id: `S${String(i+1).padStart(2,'0')}`, duration: i+1}))
 let generations = 0
 const result = await generateAllSeconds({project, request: async ({skill}) => {
  if(skill==='review') return reviewPass
  generations++; return secondsResponse(project.shots.items.map(s=>[s.id,s.duration,'本镜动作']))
 }})
 assert.equal(generations,1); assert.equal(result.items.length,count)
 for(const s of result.items) assert.equal(s.seconds.content.beats[0].durationMs,s.duration*1000)
})
test('missing shot is a self-review failure and revision repairs the complete episode', async t => {
 const e=await environment(t); let generations=0
 await runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({skill})=>skill==='review'?reviewPass:++generations===1?secondsResponse([['S01',5,'首镜']]):output})})
 assert.equal(generations,2); assert.equal((await e.read()).shots.items[1].seconds.content.shotId,'S02')
})
test('truncated JSON does not trigger continuation requests or publish partial shots', async t => {
 const e=await environment(t),before=await e.read();let calls=0
 await assert.rejects(runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({skill})=>{calls++;return skill==='review'?reviewPass:output.slice(0,-10)}})}),/完整JSON/)
 assert.equal(calls,4); assert.deepEqual((await e.read()).shots.items.map(s=>s.seconds.content),before.shots.items.map(s=>s.seconds.content))
})

test('targeted correction replaces only the reviewed shot and keeps all other beats verbatim',async()=>{
 const project=episodeFixture();let generation=0,review=0
 const initial=secondsResponse([['S01',5,'保留首镜原文'],['S02',5,'待修正动作']])
 const result=await generateAllSeconds({project,request:async message=>{
  if(message.skill==='review') return ++review===1?reviewFail('S02 动作方向相反'):reviewPass
  if(++generation===1)return initial
  assert.match(message.user,/只返回这些镜头的完整shots条目：S02/)
  return secondsResponse([['S02',5,'修正动作']])
 }})
 assert.deepEqual(result.items[0].seconds.content,JSON.parse(initial).shots[0])
 assert.equal(result.items[1].seconds.content.beats[0].action,'修正动作')
})
