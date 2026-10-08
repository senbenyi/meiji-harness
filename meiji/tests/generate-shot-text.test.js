import { tableResponse, singleShotResponse } from './fixtures/shot-response.js'
import { secondsResponse, secondsContent } from './fixtures/seconds.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'
import { storyboardFixture } from './fixtures/storyboard.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateShots, reviseShot } from '../server/flow/tasks/text/task-shot-table.js'
import { generateShotSeconds } from '../server/flow/tasks/text/task-shot-seconds.js'
import { generateShotStoryboard } from '../server/flow/steps/step-generate-storyboard.js'
import { episodeFixture, setupModel } from './fixtures/model.js'
import { compileVideoPrompt } from '../server/prompts/video-prompt-renderer.js'
import { checkContext } from '../server/runtime/operation-context.js'
import { clearShotDownstream } from '../shared/project-rules.js'
const ask = (text, verdict=reviewPass) => async ({ skill, user }) => skill==='review'?verdict:skill==='seconds'?secondsResponse([['S01',5,text]]):text
const table=tableResponse('## S01 / 3s\n标题：进入庭院\n旅人朝北走进庭院。\n\n## S02 / 7s\n标题：停步\n旅人停下。')
test('model can choose unequal boundaries and prose remains verbatim',async()=>{const p=episodeFixture();const out=await generateShots({project:p,request:ask(table)});assert.deepEqual(out.items.map(s=>s.duration),[3,7]);assert.equal(out.items[0].content,'标题：进入庭院\n旅人朝北走进庭院。');assert.equal(out.check.passed,true);assert.equal(out.failedOutput,'')})
// 格式错误归入程序自审，一次修订仍错误时不发布。
for(const raw of ['不是标题','{"items":[]}','## S01 / 16s\n过长'])test(`invalid boundary fails review after maxRevisions (default 2) rounds: ${raw}`,async()=>{let calls=0;await assert.rejects(generateShots({project:episodeFixture(),request:async ({ skill: s }) =>{calls++;return s==='review'?reviewPass:raw}}),/JSON|shots|S01 的编号/);assert.equal(calls,6)})
test('duration mismatch keeps generated shots',async()=>{const p=episodeFixture();p.durationSeconds=60;const out=await generateShots({project:p,request:ask(table)});assert.equal(out.items.length,2);assert.equal(out.check.passed,false)})
test('semantic review failure after one correction retains generated text',async()=>{const out=await generateShots({project:episodeFixture(),request:ask(table,reviewFail('缺少原因'))});assert.equal(out.items.length,2);assert.deepEqual(out.check.failures,['位置：本次内容；原因：缺少原因；修正要求：修正上述问题'])})
test('review network failure stops without a new verdict',async()=>{await assert.rejects(generateShots({project:episodeFixture(),request:async ({ skill: s }) =>{if(s==='review')throw new Error('network');return table}}),/network/)})
test('seconds remain free text and only target shot changes',async()=>{const p=episodeFixture();const out=await generateShotSeconds({project:p,shotId:'S01',request:ask('0–5s 保持朝向')});assert.equal(out.items[0].seconds.content.beats[0].action,'0–5s 保持朝向');assert.equal(out.items[0].seconds.check.passed,true);assert.deepEqual(out.items[1],p.shots.items[1])})
test('每秒指令可为没有摄影安排的分段剧情设计cut，并保留到保存结果',async()=>{
 const project=episodeFixture()
 project.shots.items[0].content='标题：叩门待应\n旅人走到庭院门前，抬手敲门，门没有打开。'
 const content=secondsContent('S01',5)
 const first={...content.beats[0],durationMs:2000,action:'旅人【旅人|C01】走到门前停下',endState:'旅人【旅人|C01】站在门前，尚未敲门'}
 const second={...first,id:'B02',durationMs:3000,transition:'cut',action:'旅人【旅人|C01】抬手轻敲门，收手等待',camera:'为看清敲门动作切至左后侧中景，保留门板与手部',endState:'旅人【旅人|C01】已收手，门仍关闭'}
 content.beats=[first,second]
 let persisted
 const out=await generateShotSeconds({project,shotId:'S01',persist:shots=>{persisted=shots},request:async message=>{
  if(message.skill==='review')return reviewPass
  assert.match(message.user,/没有打开/)
  assert.match(message.system,/未规定的摄影与调度由本阶段设计/)
  return JSON.stringify({shots:[content]})
 }})
 assert.equal(out.items[0].seconds.check.passed,true)
 assert.equal(persisted.items[0].seconds.content.beats[1].transition,'cut')
 assert.equal(persisted.items[0].seconds.content.beats.reduce((n,b)=>n+b.durationMs,0),5000)
 assert.deepEqual(out.items[1],project.shots.items[1])
})

for(const durations of [[12000],[7000,8000]])test(`连续动作可用长beat生成审核并保存：${durations.join('+')}ms`,async()=>{
 const project=episodeFixture(),duration=durations.reduce((sum,n)=>sum+n,0)/1000
 project.shots.items[0].duration=duration
 project.shots.items[0].content='标题：走近查看\n旅人走到庭院门前，停步查看紧闭的门。'
 const content=secondsContent('S01',duration,'旅人【旅人|C01】沿庭院【庭院|E01】石径走近门，停步查看')
 content.beats=durations.map((ms,index)=>({...content.beats[0],id:`B0${index+1}`,durationMs:ms,
  action:index===durations.length-1?'旅人【旅人|C01】沿原方向走到门前，停步查看紧闭的门':'旅人【旅人|C01】右手提灯沿石径持续走近门',
  endState:index===durations.length-1?'旅人【旅人|C01】已站在门前，右手仍持灯，门保持关闭':'旅人【旅人|C01】仍在行走，尚未到门前'}))
 let persisted,calls=0
 const result=await generateShotSeconds({project,shotId:'S01',persist:shots=>{persisted=shots},request:async message=>{
  calls++
  if(message.skill==='review'){assert.match(message.system,/不因 beat 长于 5 秒而失败/);return reviewPass}
  assert.match(message.system,/beat 可以覆盖整镜/)
  return JSON.stringify({shots:[content]})
 }})
 assert.equal(calls,2)
 assert.equal(result.items[0].seconds.check.passed,true)
 assert.deepEqual(persisted.items[0].seconds.content.beats.map(b=>b.durationMs),durations)
 assert.deepEqual(result.items[1],project.shots.items[1])
})
test('single shot revision preserves selected cast and other shots',async()=>{const p=episodeFixture();const out=await reviseShot({project:p,shotId:'S01',review:'保持方向',request:ask(singleShotResponse('标题：进入庭院\n新的内容'))});assert.equal(out.items[0].content,'标题：进入庭院\n新的内容');assert.deepEqual(out.items[0].cast,p.shots.items[0].cast);assert.deepEqual(out.items[1],p.shots.items[1])})
test('storyboard snapshot fixes the actual picture order and mode',async()=>{const p=episodeFixture();p.plot.characters.items[0].image.content={localPath:'/plugins/meiji/asset-file?category=characters&id=person'};p.plot.scenes.items[0].image.content={localPath:'/plugins/meiji/asset-file?category=scenes&id=scene'};let prompt;const out=await generateShotStoryboard({project:p,shotId:'S01',request:async ({ skill: s, user: v }) =>{if(s==='review')return reviewPass;prompt=v;return storyboardFixture(v)}});const item=out[0];assert.equal(item.video,'reference');assert.deepEqual(item.referenceSnapshot.map(r=>r.url),['/plugins/meiji/asset-file?category=characters&id=person','/plugins/meiji/asset-file?category=scenes&id=scene']);assert.equal(prompt,undefined);assert.match(item.prompt.text,/<Picture 2>/);assert.doesNotMatch(item.prompt.text,/asset-file|base64/);p.plot.characters.items[0].image.content.localPath='/new';assert.equal(item.referenceSnapshot[0].url,'/plugins/meiji/asset-file?category=characters&id=person')})
test('no picture means text mode; a confirmed local picture means reference mode',async()=>{const p=episodeFixture();assert.equal((await generateShotStoryboard({project:p,shotId:'S01',request:ask('text')}))[0].video,'text');p.plot.characters.items[0].image.content={localPath:'/plugins/meiji/asset-file?category=characters&id=person'};assert.equal((await generateShotStoryboard({project:p,shotId:'S01',request:ask('<Picture 1>')}))[0].video,'reference')})
test('correction uses original text and opinions and reviews the changed version',async()=>{const p=episodeFixture();p.shots.items[0].seconds.review.text='不要转身';const prompts=[];const next={...p,...clearShotDownstream(p,'seconds','S01')};await checkContext.run({originalProject:p,review:'不要转身'},()=>generateShotSeconds({project:next,shotId:'S01',request:async ({ skill: s, user: v }) =>{prompts.push(v);return s==='review'?reviewPass:secondsResponse([['S01',5,'新的动作']])}}));assert.match(prompts[0],/修改基稿/);assert.match(prompts[0],/不要转身/);assert.match(prompts[1],/新的动作/)})
test('entity markers are matched to current model images',async()=>{const p=episodeFixture();p.shots.items[0].cast=[];p.shots.items[0].scene='';p.plot.characters.items[0].image.content={localPath:'/plugins/meiji/asset-file?category=characters&id=person'};p.plot.scenes.items[0].image.content={localPath:'/plugins/meiji/asset-file?category=scenes&id=scene'};const out=await generateShotStoryboard({project:p,shotId:'S01',request:ask('提示词')});assert.equal(out[0].referenceSnapshot.length,2)})
test('explicit shot cast excludes names mentioned only as background',async()=>{
 const p=episodeFixture();p.shots.items[0].cast=['旅人'];p.shots.items[0].content+='；另一个人只在回忆中提及'
 p.plot.characters.items.push({...p.plot.characters.items[0],id:'C02',name:'另一个人',image:{content:{localPath:'/plugins/meiji/asset-file?category=characters&id=other'}}})
 p.plot.characters.items[0].image.content={localPath:'/plugins/meiji/asset-file?category=characters&id=main'}
 const rows=await generateShotStoryboard({project:p,shotId:'S01',request:ask('正文')})
 assert.deepEqual(rows[0].characters,['旅人']);assert.equal(rows[0].referenceSnapshot.length,1)
})


test('local duration failure joins review and automatic revision even when AI returns PASS', async () => {
 const project=episodeFixture();project.durationSeconds=30
 const calls=[]
 const replies=[tableResponse('## S01 / 5s\n过短片段'),reviewPass,tableResponse('## S01 / 15s\n第一段\n\n## S02 / 15s\n第二段'),reviewPass]
 const saved=[]
 const out=await generateShots({project,request:async message=>{calls.push(message);return replies.shift()},persist:shots=>saved.push(shots)})
 assert.equal(calls.length,4)
 assert.match(calls[2].user,/镜头总时长 5s/)
 assert.equal(out.check.passed,true)
 assert.ok(saved.some(shots=>shots.check.passed===false))
})


test('review preserves the issue evidence verbatim without stripping text',async()=>{
 const out=await generateShots({project:episodeFixture(),request:ask(table,reviewFail('S01：实际冲突\n\n整体建议（非失败项）：\n增强视觉冲击力'))})
 assert.deepEqual(out.check.failures,['位置：本次内容；原因：S01：实际冲突\n\n整体建议（非失败项）：\n增强视觉冲击力；修正要求：修正上述问题'])
})

test('镜头表时间不足进入补时修订，扩充动作与完整旁白随分段原文保存',async()=>{
 const project=episodeFixture();project.durationSeconds=30
 const short='## S01 / 5s\n标题：走近查看\n旅人【旅人|C01】走到门前。'
 const expanded='## S01 / 15s\n标题：走近查看1\n旅人【旅人|C01】沿石径走近紧闭的门，避过路面碎石，观察门上风化的旧痕。独立画外旁白：「旧友的失约，一直让他难以释怀。」\n\n## S02 / 15s\n标题：走近查看2\n旅人【旅人|C01】走到门前，借灯光辨认旧痕，停步确认门仍紧闭，犹豫后决意敲门，尚未敲下。'
 const replies=[tableResponse(short),reviewPass,tableResponse(expanded),reviewPass],saved=[]
 const result=await generateShots({project,persist:shots=>saved.push(shots),request:async message=>{
  if(replies.length===2){
   assert.match(message.user,/镜头总时长 5s/)
   assert.match(message.system,/必要时增加有作用的旁白/)
  }
  return replies.shift()
 }})
 assert.equal(result.check.passed,true);assert.equal(result.items.reduce((n,s)=>n+s.duration,0),30)
 assert.match(saved.at(-1).items[0].content,/旧友的失约，一直让他难以释怀。/)
 assert.match(saved.at(-1).items[1].content,/借灯光辨认旧痕/)
 assert.equal(replies.length,0)
})

test('镜头表旁白进入每秒生成审核并持久保存，读取后可直接编译视频提示词',async t=>{
 const e=await setupModel(t),project=await e.read(),originalOther=structuredClone(project.shots.items[1])
 const narration='旧友的失约，一直让他难以释怀。'
 project.shots.items[0].content+=`；独立画外旁白：「${narration}」`
 const content=secondsContent('S01',5)
 content.dialogues=[{id:'D01',speakerId:'NARRATOR',text:narration,language:'zh-CN',startMs:0,endMs:4000,delivery:'off',performance:'平静画外声，画内人物不对口型'}]
 content.beats[0].dialogueIds=['D01']
 let calls=0
 await generateShotSeconds({project,shotId:'S01',persist:shots=>e.store.save(e.id,current=>({episodes:current.episodes.map(episode=>episode.id===e.episodeId?{...episode,shots}:episode)})),request:async message=>{
  calls++;assert.match(message.user,/旧友的失约，一直让他难以释怀。/)
  if(message.skill==='review'){
   assert.match(message.system,/不因大纲未逐字写出而失败/)
   return reviewPass
  }
  assert.match(message.system,/speakerName 为 NARRATOR，delivery 为 off/)
  return JSON.stringify({shots:[content]})
 }})
 const stored=await e.read(),shot=stored.shots.items[0]
 assert.equal(calls,2);assert.equal(shot.seconds.check.passed,true)
 assert.deepEqual(shot.seconds.content.dialogues,content.dialogues)
 assert.equal(stored.shots.items[1].seconds.content,null);assert.equal(stored.shots.items[1].content,originalOther.content)
 assert.equal(stored.plot.characters.items.length,1)
 assert.match(compileVideoPrompt(stored,shot).prompt.text,/独立画外旁白，不对口型/)
 assert.equal(compileVideoPrompt(stored,shot).prompt.text.split(narration).length-1,1)
})
