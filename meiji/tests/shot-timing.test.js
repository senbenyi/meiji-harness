import test from 'node:test'
import assert from 'node:assert/strict'
import { shotModel } from '../client/drama-model.js'
import { shotSecondsReady } from '../client/shot-timing.js'
test('directives use free text without per-second JSON field validation',()=>{const s=shotModel({id:'S01',duration:5});assert.equal(shotSecondsReady(s),false);s.seconds.content='0–5s：动作保持连续';assert.equal(shotSecondsReady(s),true);s.seconds.content=' ';assert.equal(shotSecondsReady(s),false)})
