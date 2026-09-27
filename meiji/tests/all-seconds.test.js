import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel, episodeFixture } from './fixtures/model.js'
import { modelStore } from '../server/data/models.js'
import { runOperation } from '../server/flow/actions.js'
import { generateAllSeconds } from '../server/generate/shot-text.js'
const output = '## S01 / 5s\n0–5s 第一镜新动作\n\n## S02 / 5s\n0–5s 第二镜接续动作\n[seconds-complete]'
async function environment(t) {
 const e = await setupModel(t), models = modelStore(e.home)
 await models.write({ ...await models.read(), apiKey: 'test-only' })
 return e
}
test('whole episode generates once, reviews each shot, and replaces even previously passed shots', async t => {
 const e=await environment(t), calls=[]
 await runOperation(e.op('seconds',{generationMode:'regenerate'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async(skill,prompt)=>{
  calls.push({skill,prompt});return skill==='skill-gongyong-content-review'?'PASS':output
 }})})
 assert.equal(calls.length,3);assert.equal(calls.filter(c=>c.skill!=='skill-gongyong-content-review').length,1)
 assert.match(calls[1].prompt,/【本次待审内容】\n0–5s 第一镜新动作/)
 assert.match(calls[2].prompt,/【本次待审内容】\n0–5s 第二镜接续动作/)
 const p=await e.read()
 assert.ok(p.shots.items.every(s=>s.seconds.check.passed===true && !s.seconds.operation))
 assert.ok(p.shots.items.every(s=>s.storyboard.content===null))
 assert.equal(p.activity,null)
})
test('one failed review does not skip later shots and correction remains local', async t=>{
 const e=await environment(t), calls=[]
 await assert.rejects(runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async(skill,prompt)=>{
  calls.push({skill,prompt})
  if(skill==='skill-gongyong-content-review') return prompt.includes('仅审核或定向修订 S01')?'FAIL 第一镜问题':'PASS'
  return calls.length===1?output:'第一镜修订稿'
 }})}),/S01/)
 const p=await e.read()
 assert.equal(p.shots.items[0].seconds.status,'failed');assert.equal(p.shots.items[0].seconds.content,'第一镜修订稿')
 assert.equal(p.shots.items[1].seconds.status,'passed');assert.equal(p.shots.items[1].seconds.content,'0–5s 第二镜接续动作')
 assert.equal(calls.filter(c=>c.skill==='skill-gongyong-content-review').length,3)
})
for(const text of [output.replace('[seconds-complete]',''), '## S01 / 5s\n只有一镜\n[seconds-complete]',output.replace('S02 / 5s','S02 / 4s')]) {
 test('incomplete or mismatched result preserves original content and downstream',async t=>{
  const e=await environment(t),before=await e.read()
  await assert.rejects(runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async()=>text})}),/未覆盖/)
  const after=await e.read()
  for(let i=0;i<2;i++) {
   assert.equal(after.shots.items[i].seconds.content,before.shots.items[i].seconds.content)
   assert.deepEqual(after.shots.items[i].storyboard,before.shots.items[i].storyboard)
  }
 })
}
test('whole generation does not include old seconds or their opinions',async()=>{
 const p=episodeFixture();p.shots.items.forEach(s=>{s.seconds.content='OLD_SECRET';s.seconds.review.text='OLD_OPINION'})
 const calls=[]
 await generateAllSeconds({project:p,request:async(skill,prompt)=>{calls.push(prompt);return skill==='skill-gongyong-content-review'?'PASS':output}})
 assert.doesNotMatch(calls[0],/OLD_SECRET|OLD_OPINION/)
})
test('cancellation during review preserves all newly generated drafts and releases ownership',async t=>{
 const e=await environment(t),controller=new AbortController()
 await assert.rejects(runOperation(e.op('seconds'),{home:e.home,signal:controller.signal,generateAllSeconds:options=>generateAllSeconds({...options,request:async skill=>{
  if(skill!=='skill-gongyong-content-review')return output
  controller.abort();controller.signal.throwIfAborted()
 }})}),{name:'AbortError'})
 const p=await e.read()
 assert.ok(p.shots.items.every(s=>s.seconds.content.includes('动作') && s.seconds.operation===null))
 assert.equal(p.activity,null)
})
test('storyboard never fills missing seconds in the background',async t=>{
 const e=await environment(t)
 await e.store.save(e.id,p=>{p.episodes[0].shots.items[1].seconds.content=null;return p})
 await assert.rejects(runOperation(e.op('storyboard'),{home:e.home,generateAllSeconds:()=>assert.fail('no implicit fill'),generateShotSeconds:()=>assert.fail('no implicit fill')}),/请先生成整集每秒指令/)
})
test('review preserves new human opinions entered on a different shot',async t=>{
 const e=await environment(t);let reviews=0
 await runOperation(e.op('seconds',{generationMode:'regenerate'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async skill=>{
  if(skill!=='skill-gongyong-content-review')return output
  if(reviews++===0)await e.store.saveReviewDraft(e.id,e.episodeId,'seconds:S02','新输入意见',0)
  return 'PASS'
 }})})
 assert.equal((await e.read()).shots.items[1].seconds.review.text,'新输入意见')
})
test('unified opinion and numbered failures modify the whole episode and are consumed only on success',async t=>{
 const e=await environment(t)
 await e.store.saveReviewDraft(e.id,e.episodeId,'seconds','统一保持动作方向',0)
 await e.store.save(e.id,p=>{p.episodes[0].shots.items[1].seconds.check={passed:false,failures:['机位反了']};return p})
 const calls=[]
 await runOperation(e.op('seconds',{generationMode:'modify'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async(skill,prompt)=>{
  calls.push(prompt);return skill==='skill-gongyong-content-review'?'PASS':output
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
 await runOperation(e.op('seconds',{generationMode:'modify'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async skill=>{
  if(!entered){entered=true;await e.store.saveReviewDraft(e.id,e.episodeId,'seconds','下次意见',1)}
  return skill==='skill-gongyong-content-review'?'PASS':output
 }})})
 assert.equal((await e.read()).shots.seconds.review.text,'下次意见')
})
test('unified opinion is retained after failed review and regeneration does not submit it',async t=>{
 const e=await environment(t)
 await e.store.saveReviewDraft(e.id,e.episodeId,'seconds','保留人工意见',0)
 let generated=false
 await assert.rejects(runOperation(e.op('seconds',{generationMode:'modify'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async skill=>{
  if(skill==='skill-gongyong-content-review')return 'FAIL 不通过'
  if(!generated){generated=true;return output}return '局部修订'
 }})}),/自检未通过/)
 assert.equal((await e.read()).shots.seconds.review.text,'保留人工意见')
 await runOperation(e.op('seconds',{generationMode:'regenerate'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async(skill,prompt)=>{
  assert.doesNotMatch(prompt,/保留人工意见/);return skill==='skill-gongyong-content-review'?'PASS':output
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
