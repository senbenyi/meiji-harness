import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { modelStore } from '../server/data/models.js'
import { runOperation } from '../server/flow/actions.js'
import { generateAllSeconds, generateShotStoryboard } from '../server/generate/shot-text.js'
const output='## S01 / 5s\n新动作一\n## S02 / 5s\n新动作二\n[seconds-complete]'
// 保存时会刷新节点的上游依赖版本（dependencies），比较业务内容时忽略该字段。
const content=({dependencies,...rest})=>rest
for(const failed of [false,true]) for(const phase of ['generation','review','correction']) {
 test(`${phase} API error preserves ${failed?'failed':'passed'} original only before a draft is saved`,async t=>{
  const e=await setupModel(t),models=modelStore(e.home)
  await models.write({...await models.read(),apiKey:'test-only'})
  if(failed) await e.store.save(e.id,p=>{for(const s of p.episodes[0].shots.items){s.seconds.status='failed';s.seconds.check={passed:false,failures:['旧自审原因'],revision:s.seconds.revision}}return p})
  const before=await e.read(),calls=[]
  await assert.rejects(runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:opts=>generateAllSeconds({...opts,request:async({ skill })=>{
   calls.push(skill)
   if(phase==='generation'||phase==='review'&&calls.length===2||phase==='correction'&&calls.length===3)throw new Error('HTTP 503')
   return skill==='skill-gongyong-content-review'?'FAIL 本轮内容问题':output
  }})}),/HTTP 503/)
  assert.equal(calls.length,{generation:1,review:2,correction:3}[phase])
  const after=await e.read()
  for(let i=0;i<2;i++){
   if (phase === 'generation') {
    assert.deepEqual(content(after.shots.items[i].seconds),content(before.shots.items[i].seconds))
    assert.deepEqual(content(after.shots.items[i].storyboard),content(before.shots.items[i].storyboard))
   } else {
    assert.equal(after.shots.items[i].seconds.content, i ? '新动作二' : '新动作一')
    assert.notEqual(after.shots.items[i].seconds.check.passed, true)
    assert.equal(after.shots.items[i].seconds.operation, null)
   }
  }
  assert.equal(after.activity,null);assert.equal(after.activityError,before.activityError)
  if (phase === 'generation') assert.equal(after.shots.seconds.status,before.shots.seconds.status)
 })
}
test('storyboard API error restores cleared downstream and original status',async t=>{
 const e=await setupModel(t),models=modelStore(e.home)
 await models.write({...await models.read(),apiKey:'test-only'})
 const before=await e.read()
 await assert.rejects(runOperation(e.op('shot-storyboard',{track:'S01'}),{home:e.home,generateShotStoryboard:opts=>generateShotStoryboard({...opts,request:async()=>{throw new Error('HTTP 503')}})}),/HTTP 503/)
 const after=await e.read()
 assert.deepEqual(after.shots.items[0],before.shots.items[0])
 assert.equal(after.activityError,before.activityError)
})
test('gateway image error is logged without changing image model state',async t=>{
 const e=await setupModel(t),models=modelStore(e.home)
 await models.write({...await models.read(),apiKey:'test-only'})
 const {generateGatewayImage}=await import('../server/generate/gateway.js')
 const {runWithSessionLog}=await import('../server/host/session-log.js')
 const before=await e.read(),logs=[]
 await runWithSessionLog({append:(type,data)=>logs.push({type,data})},()=>runOperation(e.op('image',{itemId:'C01'}),{home:e.home,waitForBackground:true,submitAssetImage:()=>generateGatewayImage({baseUrl:'https://test/',apiKey:'test',model:'test',prompt:'test',aspectRatio:'1344x768',fetchImpl:async()=>new Response(JSON.stringify({error:{message:'image unavailable'}}),{status:503})})}))
 const after=await e.read()
 assert.deepEqual(after.plot.characters.items[0].image,before.plot.characters.items[0].image)
 assert.equal(after.activityError,before.activityError)
 assert.ok(JSON.stringify(logs).includes('image unavailable'))
})
// 整集每秒指令作为一个版本生成和审核：一次审核覆盖全部镜头。
test('whole-episode seconds are reviewed once as one version',async t=>{
 const e=await setupModel(t),models=modelStore(e.home)
 await models.write({...await models.read(),apiKey:'test-only'})
 let reviews=0
 await runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:opts=>generateAllSeconds({...opts,request:async ({ skill }) =>{
  if(skill!=='skill-gongyong-content-review')return output
  reviews++
  return 'PASS'
 }})})
 const after=await e.read()
 assert.equal(reviews,1)
 assert.deepEqual(after.shots.items.map(s=>[s.seconds.content,s.seconds.status]),[['新动作一','passed'],['新动作二','passed']])
 assert.ok(after.shots.items.every(s=>s.seconds.operation===null))
})
