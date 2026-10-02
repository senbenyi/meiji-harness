import { secondsResponse, secondsContent } from './fixtures/seconds.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel, episodeFixture } from './fixtures/model.js'
import { modelStore } from '../server/data/model-settings.js'
import { runOperation } from '../server/flow/operations/run.js'
import { recordStore } from '../server/data/task-store.js'
import { generateAllSeconds, generateShotSeconds } from '../server/generate/shot-text.js'
import { feedbackOf, overrideBlocker } from '../shared/feedback.js'
import { secondsText } from '../shared/seconds-content.js'
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
for(const text of [output.slice(0, -8), secondsResponse([['S01', 5, '只有一镜']])]) {
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
  if(message.skill==='review') return ++review===1?reviewFail('S02 动作方向相反','S02'):reviewPass
  if(++generation===1)return initial
  assert.match(message.system,/本轮仅返回这些镜头的完整 shots 条目：S02/)
  return secondsResponse([['S02',5,'修正动作']])
 }})
 assert.deepEqual(result.items[0].seconds.content,JSON.parse(initial).shots[0])
 assert.equal(result.items[1].seconds.content.beats[0].action,'修正动作')
})
test('automatic seconds correction does not edit a shot merely mentioned as context in the reason',async()=>{
 const project=episodeFixture(),initial=secondsResponse([['S01',5,'保留首镜'],['S02',5,'待修正末态']]);let generated=0,reviewed=0
 const result=await generateAllSeconds({project,request:async message=>{
  if(message.skill==='review')return ++reviewed===1?reviewFail('S02末态不符，S01仅作为衔接参考','S02结束状态'):reviewPass
  if(++generated===1)return initial
  assert.match(message.system,/本轮仅返回这些镜头的完整 shots 条目：S02。/)
  assert.doesNotMatch(message.system,/条目：S01/)
  return secondsResponse([['S02',5,'修正末态']])
 }})
 assert.deepEqual(result.items[0].seconds.content,JSON.parse(initial).shots[0])
 assert.equal(result.items[1].seconds.content.beats[0].action,'修正末态')
})

test('一镜程序校验失败时全部镜头保存，失败镜头带正文和原因，可提交修改但不可忽略', async t => {
 const e=await environment(t)
 const text=secondsResponse([['S01',5,'【旅人|C01】第一镜动作'],['S02',4,'时长错']])
 await assert.rejects(runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({skill})=>skill==='review'?reviewPass:text})}),/自审未通过/)
 const p=await e.read(),[first,second]=p.shots.items
 assert.equal(first.seconds.content.beats[0].action,'【旅人|C01】第一镜动作')
 assert.equal(second.seconds.content.beats[0].action,'时长错')
 assert.equal(second.seconds.status,'failed');assert.equal(second.seconds.check.passed,false)
 assert.match(second.seconds.check.failures.join(),/S02 节拍总时长4000ms，应为5000ms/)
 const feedback=feedbackOf(p,'seconds')
 assert.equal(feedback.canModify,true);assert.equal(feedback.canOverride,false)
 assert.match(feedback.check.failures.join(),/S02 节拍总时长/)
 assert.match(overrideBlocker(p,'seconds'),/格式错误/)
})

test('every failed shot and original model response is retained, with all program errors reviewed together', async t => {
 const e=await environment(t)
 const text=secondsResponse([['S01',4,'首镜失败正文'],['S02',3,'次镜失败正文']])
 await assert.rejects(runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({skill,user})=>{
  if(skill==='review') return reviewPass
  if(user.includes('【最新失败稿')) assert.match(user,/"location":"程序校验"/)
  return text
 }})}),/自检未通过/)
 const p=await e.read()
 assert.deepEqual(p.shots.items.map(s=>s.seconds.content.beats[0].action),['首镜失败正文','次镜失败正文'])
 assert.ok(p.shots.items.every(s=>s.seconds.check.passed===false && s.seconds.status==='failed'))
 assert.equal(feedbackOf(p,'seconds').canOverride,false)
 const records=recordStore(e.home,e.id), task=(await records.list('tasks'))[0]
 const originals=await Promise.all(task.artifacts.filter(a=>a.target==='seconds-response').map(a=>records.read('artifacts',a.artifactId)))
 assert.equal(originals.length,2)
 assert.ok(originals.every(a=>a.content.text===text))
 const review=task.steps.find(s=>s.kind==='review')
 assert.ok(review.reasons.some(r=>r.includes('S01')))
 assert.ok(review.reasons.some(r=>r.includes('S02')))
})

test('missing beat fields are retained and render as raw JSON rather than crashing', async t => {
 const e=await environment(t), raw=JSON.parse(output);let generated=0
 delete raw.shots[1].beats[0].dialogueIds
 const text=JSON.stringify(raw)
 await assert.rejects(runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({skill})=>skill==='review'?reviewPass:++generated===1?text:JSON.stringify({shots:[raw.shots[1]]})})}),/dialogueIds/)
 const saved=await e.read(),second=saved.shots.items[1]
 assert.deepEqual(second.seconds.content,raw.shots[1])
 assert.match(secondsText(second.seconds.content),/第二镜接续动作/)
 assert.equal(second.seconds.check.passed,false)
 assert.equal(saved.shots.items[0].seconds.check.passed,true)
 assert.ok(second.seconds.check.failures.some(reason=>reason.includes('S02') && reason.includes('dialogueIds')))
})

test('single-shot seconds keep invalid generated content and leave the other shot untouched', async t => {
 const e=await environment(t), before=await e.read()
 const text=secondsResponse([['S01',4,'单镜失败正文']])
 await runOperation(e.op('shot-seconds',{track:'S01'}),{home:e.home,generateShotSeconds:options=>generateShotSeconds({...options,request:async ({skill})=>skill==='review'?reviewPass:text})}).catch(error=>{
  assert.match(error.message,/自检|自审/)
 })
 const after=await e.read()
 assert.equal(after.shots.items[0].seconds.content.beats[0].action,'单镜失败正文')
 assert.equal(after.shots.items[0].seconds.check.passed,false)
 assert.deepEqual(after.shots.items[1].seconds.content,before.shots.items[1].seconds.content)
})

test('truncated original responses remain accessible as task artifacts', async t => {
 const e=await environment(t), text=output.slice(0,-8)
 await assert.rejects(runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({skill})=>skill==='review'?reviewPass:text})}),/完整JSON/)
 const records=recordStore(e.home,e.id), task=(await records.list('tasks'))[0]
 const responses=await Promise.all(task.artifacts.filter(a=>a.target==='seconds-response').map(a=>records.read('artifacts',a.artifactId)))
 assert.equal(responses.length,2)
 assert.ok(responses.every(a=>a.content.text===text))
})
test('部分保存后提交修改：意见含失败镜头原因，已保存镜头作基稿，修订结果整集保存', async t => {
 const e=await environment(t)
 const broken=secondsResponse([['S01',5,'【旅人|C01】第一镜动作'],['S02',4,'时长错']])
 await assert.rejects(runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({skill})=>skill==='review'?reviewPass:broken})}),/自审未通过/)
 const calls=[]
 await runOperation(e.op('seconds',{generationMode:'modify',review:''}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({skill,user})=>{calls.push({skill,user});return skill==='review'?reviewPass:secondsResponse([['S01',5,'【旅人|C01】第一镜动作'],['S02',5,'第二镜修好']])}})})
 const generation=calls.find(c=>c.skill!=='review').user
 assert.match(generation,/S02 节拍总时长4000ms，应为5000ms/); assert.match(generation,/第一镜动作/)
 const p=await e.read()
 assert.ok(p.shots.items.every(s=>s.seconds.content && s.seconds.check.passed===true))
 assert.equal(p.shots.items[1].seconds.content.beats[0].action,'第二镜修好')
})
