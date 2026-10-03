import { secondsForRequest } from './fixtures/seconds.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { modelStore } from '../server/data/model-settings.js'
import { runOperation } from '../server/flow/operations/run-operation.js'
import { generateAllSeconds, generateShotStoryboard } from '../server/flow/operations/shot-operations.js'
// 保存时会刷新节点的上游依赖版本（dependencies），比较业务内容时忽略该字段。
const content=({dependencies,...rest})=>rest
for(const failed of [false,true]) for(const phase of ['generation','review','correction']) {
 test(`${phase} API error preserves ${failed?'failed':'passed'} original only before a draft is saved`,async t=>{
  const e=await setupModel(t),models=modelStore(e.home)
  await models.write({...await models.read(),apiKey:'test-only'})
  if(failed) await e.store.save(e.id,p=>{for(const s of p.episodes[0].shots.items){s.seconds.status='failed';s.seconds.check={passed:false,failures:['旧自审原因'],revision:s.seconds.revision}}return p})
  const before=await e.read(),calls=[]
  await assert.rejects(runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:opts=>generateAllSeconds({...opts,request:async({ skill, user })=>{
   calls.push(skill)
   if(phase==='generation'||phase==='review'&&calls.length===2||phase==='correction'&&calls.length===3)throw new Error('HTTP 503')
   return skill==='review'?reviewFail('本轮内容问题'):secondsForRequest({user},[['S01',5,'新动作一'],['S02',5,'新动作二']])
  }})}),/HTTP 503/)
  assert.equal(calls.length,{generation:1,review:2,correction:3}[phase])
  const after=await e.read()
  for(let i=0;i<2;i++){
   if (phase === 'generation') {
    assert.deepEqual(content(after.shots.items[i].seconds),content(before.shots.items[i].seconds))
    assert.deepEqual(content(after.shots.items[i].storyboard),content(before.shots.items[i].storyboard))
   } else {
    assert.equal(after.shots.items[i].seconds.content.beats[0].action, i ? before.shots.items[i].seconds.content.beats[0].action : '新动作一')
    assert.notEqual(after.shots.items[i].seconds.check.passed, true)
    assert.equal(after.shots.items[i].seconds.operation, null)
   }
  }
  assert.ok(!('activity' in after) && !('activityError' in after))
  if (phase === 'generation') assert.equal(after.shots.seconds.status,before.shots.seconds.status)
 })
}
test('program storyboard needs no API and works without model access', async t => {
 const e=await setupModel(t)
 await runOperation(e.op('shot-storyboard',{track:'S01'}),{home:e.home,generateShotStoryboard:opts=>generateShotStoryboard({...opts,request:()=>assert.fail('no model call')})})
 assert.equal((await e.read()).shots.items[0].storyboard.check.passed,true)
})
test('gateway image error is logged without changing image model state',async t=>{
 const e=await setupModel(t),models=modelStore(e.home)
 await models.write({...await models.read(),apiKey:'test-only'})
 const { generateGatewayImage } = await import('../server/gateway/model-gateway.js')
 const { runWithSessionLog } = await import('../server/host/session-log.js')
 const before=await e.read(),logs=[]
 await runWithSessionLog({append:(type,data)=>logs.push({type,data})},()=>runOperation(e.op('image',{itemId:'C01'}),{home:e.home,waitForBackground:true,submitAssetImage:args=>generateGatewayImage({stepTarget:args.stepTarget,baseUrl:'https://test/',apiKey:'test',model:'test',prompt:'test',aspectRatio:'1344x768',fetchImpl:async()=>new Response(JSON.stringify({error:{message:'image unavailable'}}),{status:503})})}))
 const after=await e.read()
 assert.deepEqual(after.plot.characters.items[0].image,before.plot.characters.items[0].image)
 assert.equal('activityError' in after, false)
 assert.ok(JSON.stringify(logs).includes('image unavailable'))
})
for(const mode of ['error','stop','draft']) test(`image ${mode} only changes the image node, never the episode story state`,async t=>{
 const e=await setupModel(t),models=modelStore(e.home)
 await models.write({...await models.read(),apiKey:'test-only'})
 const before=await e.read(),stop=new AbortController()
 await runOperation(e.op('image',{itemId:'C01'}),{home:e.home,waitForBackground:true,signal:stop.signal,submitAssetImage:async args=>{
  if(mode==='stop'){stop.abort(new Error('用户停止'));throw new Error('任务已停止')}
  if(mode==='draft')return args.onSaved({...args.assets,items:args.assets.items.map(item=>item.id===args.itemId?{...item,pendingImage:{draftId:'d1',previewUrl:'/d1.png'}}:item)})
  throw new Error('HTTP 500 image fail')
 }})
 const after=await e.read(),root=await e.store.read(e.id),image=after.plot.characters.items[0].image
 assert.ok(!('activityError' in after) && !('activityError' in root))
 for(const key of ['outline','characters','scenes','props']){assert.equal(after.plot[key].status,before.plot[key].status);assert.equal(after.plot[key].error,before.plot[key].error)}
 if(mode==='draft')assert.ok(after.pendingImages.d1)
 else{assert.equal(image.status,'failed');assert.equal(image.error,mode==='stop'?'任务已停止':'HTTP 500 image fail')}
})
test('restart cancel of an interrupted image only fails the image node',async t=>{
 const e=await setupModel(t)
 const { interruptRunning, RESTART_CANCELLED } = await import('../server/flow/tasks/task-interrupt.js')
 await e.store.save(e.id,p=>{const image=p.episodes[0].plot.characters.items[0].image;image.status='generating';image.operation={id:'old',action:'image',phase:'generating'};return p})
 const before=await e.read()
 await interruptRunning(e.store)
 const after=await e.read()
 assert.equal(after.plot.characters.items[0].image.error,RESTART_CANCELLED)
 assert.equal(after.plot.characters.items[0].image.operation,null)
 for(const key of ['outline','characters','scenes','props']) assert.equal(after.plot[key].status,before.plot[key].status)
 assert.ok(!('activity' in after) && !('activityError' in after))
})
// 每镜独立生成与审核。
test('seconds are reviewed one shot at a time',async t=>{
 const e=await setupModel(t),models=modelStore(e.home)
 await models.write({...await models.read(),apiKey:'test-only'})
 let reviews=0
 await runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:opts=>generateAllSeconds({...opts,request:async ({ skill, user }) =>{
  if(skill!=='review')return secondsForRequest({user},[['S01',5,'新动作一'],['S02',5,'新动作二']])
  reviews++
  return reviewPass
 }})})
 const after=await e.read()
 assert.equal(reviews,2)
 assert.deepEqual(after.shots.items.map(s=>[s.seconds.content.beats[0].action,s.seconds.status]),[['新动作一','passed'],['新动作二','passed']])
 assert.ok(after.shots.items.every(s=>s.seconds.operation===null))
})
