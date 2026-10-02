import test from 'node:test'
import assert from 'node:assert/strict'
import { shotSecondsReady } from '../shared/shot-timing.js'
import { secondsContent } from './fixtures/seconds.js'
test('only structured seconds are ready; old free text requires migration',()=>{
 const s={seconds:{content:null}};assert.equal(shotSecondsReady(s),false)
 s.seconds.content='0–5s旧文本';assert.equal(shotSecondsReady(s),false)
 s.seconds.content=secondsContent();assert.equal(shotSecondsReady(s),true)
})
