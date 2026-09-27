import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { interruptRunning } from '../server/flow/interrupt.js'
import { begin, modelPatch, finish } from '../client/drama-model.js'
test('restart pauses orphaned model operations and retains generated content',async t=>{const e=await setupModel(t);await e.store.save(e.id,p=>{begin(p.episodes[0].shots.items[0].video,{id:'orphan'});p.episodes[0].shots.items[0].video.content={status:'running',promptId:'remote'};return p});await interruptRunning(e.store);const p=await e.read();assert.equal(p.shots.items[0].video.status,'paused');assert.equal(p.shots.items[0].video.content.promptId,'remote');assert.equal(p.shots.items[0].video.operation,null)})

 test('paused status survives model normalization and restart; explicit regeneration can pass', async t => {
 const e = await setupModel(t)
 await e.store.save(e.id, p => { const n=p.episodes[0].shots.items[0].seconds; n.review.text='保留意见'; begin(n,{id:'restart'}); return p })
 await interruptRunning(e.store)
 await interruptRunning(e.store)
 const p = await e.read(), n=p.shots.items[0].seconds
 assert.equal(n.status,'paused')
 assert.equal(n.review.text,'保留意见')
 assert.ok(n.content)
 assert.equal(modelPatch(p, {}).shots.items[0].seconds.status,'paused')
 begin(n,{id:'retry'})
 assert.equal(n.status,'generating')
 finish(n,{passed:true,failures:[]})
 assert.equal(n.status,'passed')
})
