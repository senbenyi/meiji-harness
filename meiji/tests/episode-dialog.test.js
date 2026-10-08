import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { episodeDialog } from '../client/project-overview-view.js'
function setup(t,save) {
 const dom=new JSDOM('<main></main>',{url:'http://localhost'}),before={document:globalThis.document,window:globalThis.window}
 globalThis.document=dom.window.document;globalThis.window=dom.window
 t.after(()=>{Object.assign(globalThis,before);dom.window.close()})
 dom.window.HTMLDialogElement.prototype.show=function(){this.open=true}
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))}
 const root=document.querySelector('main'),open=episodeDialog(root,save)
 return {root,open,form:root.querySelector('form'),dialog:root.querySelector('dialog')}
}
test('新建剧集只输入时长及要求，不提供摘要输入或AI草稿按钮', async t=>{
 const calls=[],ui=setup(t,async(project,input)=>calls.push(input));ui.open({id:'p'})
 assert.equal(ui.form.elements.namedItem('summary'),null);assert.equal(ui.root.querySelector('.ai-summary'),null)
 ui.form.elements.duration.value='38';ui.form.elements.requirements.value='码头调查'
 await ui.form.onsubmit({preventDefault(){}})
 assert.deepEqual(calls,[{episodeId:'',durationSeconds:38,requirements:'码头调查'}]);assert.equal(ui.dialog.open,false)
})
test('保存错误保留时长与要求，便于重试',async t=>{
 const ui=setup(t,async()=>{throw Error('保存失败')});ui.open({id:'p'})
 ui.form.elements.duration.value='45';ui.form.elements.requirements.value='保留动作'
 await ui.form.onsubmit({preventDefault(){}})
 assert.equal(ui.dialog.open,true);assert.equal(ui.form.elements.duration.value,'45');assert.equal(ui.form.elements.requirements.value,'保留动作');assert.match(ui.root.querySelector('.error').textContent,/保存失败/)
})
test('编辑剧集回填时长和要求，不回填展示摘要',t=>{
 const ui=setup(t,async()=>{});ui.open({id:'p'},{id:'e',durationSeconds:60,storyRequirements:'明确结尾',summary:{content:'仅展示'}})
 assert.equal(ui.form.elements.duration.value,'60');assert.equal(ui.form.elements.requirements.value,'明确结尾');assert.doesNotMatch(ui.root.textContent,/仅展示/)
})
