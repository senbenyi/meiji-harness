import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { previousTail } from '../shared/tail-frame.js'

test('missing or obsolete tail is optional',async t=>{
 const e=await setupModel(t),p=await e.read()
 assert.equal(previousTail(p,'S01'),null);assert.equal(previousTail(p,'S02'),null)
 p.shots.items[0].video.content={status:'ready',file:'new.mp4'}
 p.shots.items[0].tailFrame={status:'passed',content:{sourceVideoFile:'old.mp4',localPath:'/films/old-last.png'}}
 assert.equal(previousTail(p,'S02'),null)
})
