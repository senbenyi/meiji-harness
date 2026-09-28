import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { interruptRunning, RESTART_CANCELLED } from '../server/flow/interrupt.js'
import { begin, modelPatch, finish } from '../shared/drama-model.js'
// 服务重启一律取消遗留任务：不续查、不自动恢复；已提交的远端视频尽力取消。
test('restart cancels orphaned operations, keeps generated content and cancels the remote video',async t=>{
 const e=await setupModel(t),cancelled=[]
 await e.store.save(e.id,p=>{begin(p.episodes[0].shots.items[0].video,{id:'orphan'});p.episodes[0].shots.items[0].video.content={status:'running',promptId:'remote'};return p})
 await interruptRunning(e.store,{cancelRemote:async id=>{cancelled.push(id)}})
 const v=(await e.read()).shots.items[0].video
 assert.deepEqual(cancelled,['remote'])
 assert.equal(v.status,'failed');assert.equal(v.error,RESTART_CANCELLED);assert.equal(v.operation,null)
 assert.equal(v.content.promptId,'remote');assert.equal(v.content.status,'error');assert.equal(v.content.terminal,true)
})
test('a failed remote cancellation is recorded honestly on the node',async t=>{
 const e=await setupModel(t)
 await e.store.save(e.id,p=>{begin(p.episodes[0].shots.items[0].video,{id:'orphan'});p.episodes[0].shots.items[0].video.content={status:'running',promptId:'remote'};return p})
 await interruptRunning(e.store,{cancelRemote:async()=>{throw new Error('HTTP 501')}})
 const v=(await e.read()).shots.items[0].video
 assert.match(v.content.error,/远端取消失败（remote）：HTTP 501，任务可能仍在运行/)
})

 test('restart cancels unfinished text work, keeps opinion and content; explicit regeneration can pass', async t => {
 const e = await setupModel(t)
 await e.store.save(e.id, p => { const n=p.episodes[0].shots.items[0].seconds; n.review.text='保留意见'; begin(n,{id:'restart'}); return p })
 await interruptRunning(e.store)
 await interruptRunning(e.store)
 const p = await e.read(), n=p.shots.items[0].seconds
 assert.equal(n.status,'failed')
 assert.equal(n.error,RESTART_CANCELLED)
 assert.equal(n.review.text,'保留意见')
 assert.ok(n.content)
 assert.equal(modelPatch(p, {}).shots.items[0].seconds.status,'failed')
 begin(n,{id:'retry'})
 assert.equal(n.status,'generating')
 finish(n,{passed:true,failures:[]})
 assert.equal(n.status,'passed')
})
