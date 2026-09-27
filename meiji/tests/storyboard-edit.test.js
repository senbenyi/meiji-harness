import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeFixture, setupModel } from './fixtures/model.js'
import { storyboardTextPatch } from '../server/data/storyboard-edit.js'
import { runOperation } from '../server/flow/actions.js'
test('manual text save runs self-review and preserves other shot content',async t=>{const e=await setupModel(t);const p=await e.read();await runOperation(e.op('storyboard-text',{track:'S01',originalText:p.shots.items[0].storyboard.content.prompt.text,text:'新文本'}),{home:e.home,reviewContent:async()=>({passed:false,failures:['缺少朝向']})});const after=await e.read();assert.equal(after.shots.items[0].storyboard.content.prompt.text,'新文本');assert.equal(after.shots.items[0].storyboard.status,'failed');assert.deepEqual(after.shots.items[1],p.shots.items[1])})
test('empty and stale manual edits cannot replace current text',()=>{const p=episodeFixture(),originalText=p.shots.items[0].storyboard.content.prompt.text;assert.throws(()=>storyboardTextPatch(p,{track:'S01',originalText,text:' '}),/不能为空|1–100000/);assert.throws(()=>storyboardTextPatch(p,{track:'S01',originalText:'旧文',text:'新版'}),/已更新/);assert.deepEqual(storyboardTextPatch(p,{track:'S01',originalText,text:originalText}),{})})
