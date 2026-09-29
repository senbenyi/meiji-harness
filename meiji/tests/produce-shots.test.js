import { node } from '../shared/drama-model.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { produceShots } from '../server/flow/operations/films.js'
import { previousTail } from '../shared/tail-frame.js'

test('production completes previous video before writing next text with its tail', async t => {
 const e=await setupModel(t),calls=[]
 await e.store.save(e.id,p=>{for(const s of p.episodes[0].shots.items)s.storyboard.status='not-generated';return p})
 await produceShots(e.op('produce-all'),{home:e.home},async op=>{
  calls.push(`${op.track}:${op.action}`)
  const current=await e.read()
  if(op.track==='S02'&&op.action==='shot-storyboard')assert.equal(previousTail(current,'S02').imageUrl,'https://test/S01')
  await e.store.save(e.id,p=>{
   const s=p.episodes[0].shots.items.find(s=>s.id===op.track)
   if(op.action==='shot-storyboard')s.storyboard.status='passed'
   else {s.video.content={status:'ready',file:`${s.id}.mp4`};s.tailFrame={...node(`tailFrame:${s.id}`),status:'passed',content:{sourceVideoFile:`${s.id}.mp4`,imageUrl:`https://test/${s.id}`}}}
   return p
  });return []
 })
 assert.deepEqual(calls,['S01:shot-storyboard','S01:film','S02:shot-storyboard','S02:film'])
})

test('missing or obsolete tail is optional',async t=>{
 const e=await setupModel(t),p=await e.read()
 assert.equal(previousTail(p,'S01'),null);assert.equal(previousTail(p,'S02'),null)
 p.shots.items[0].video.content={status:'ready',file:'new.mp4'}
 p.shots.items[0].tailFrame={status:'passed',content:{sourceVideoFile:'old.mp4',imageUrl:'https://test/old'}}
 assert.equal(previousTail(p,'S02'),null)
})
