import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { interruptRunning } from '../server/flow/interrupt.js'
import { begin } from '../client/drama-model.js'
test('restart terminates orphaned model operations and retains generated content',async t=>{const e=await setupModel(t);await e.store.save(e.id,p=>{begin(p.episodes[0].shots.items[0].video,{id:'orphan'});p.episodes[0].shots.items[0].video.content={status:'running',promptId:'remote'};return p});await interruptRunning(e.store);const p=await e.read();assert.equal(p.shots.items[0].video.status,'failed');assert.equal(p.shots.items[0].video.content.promptId,'remote');assert.equal(p.shots.items[0].video.operation,null)})
