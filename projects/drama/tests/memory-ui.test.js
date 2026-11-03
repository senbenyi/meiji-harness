import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {createMemoryPanel} from '../src/client/memory-panel.js'
const tick=()=>new Promise(r=>setImmediate(r))
function setup(t,request){const dom=new JSDOM('<main class="production-workspace"/>'),previous=globalThis.document;dom.window.HTMLDialogElement.prototype.show=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))};globalThis.document=dom.window.document;const root=document.querySelector('main'),panel=createMemoryPanel(root,{request});t.after(()=>{panel.dispose();globalThis.document=previous;dom.window.close()});return {root,panel,click:label=>[...root.querySelectorAll('button')].find(b=>b.textContent===label).click()}}

test('记忆面板按工程范围保存并保留冲突输入，不混入其他类型',async t=>{
 let submitted,conflict=true;const {root,panel,click}=setup(t,async(path,options)=>{assert.match(path,/scope=engineering/);if(options){submitted=JSON.parse(options.body);if(conflict)throw new Error('记忆已被修改');return {saved:true}}return {revision:7,total:0,entries:[]}})
 await panel.open('engineering');assert.match(root.textContent,/仅在Drama短剧之间共享视频制作偏好/);click('新增记忆');await tick();root.querySelector('[aria-label="主题key（相同主题保持一致）"]').value='voice';root.querySelector('[aria-label="记忆标题"]').value='声线偏好';root.querySelector('[aria-label="记忆正文"]').value='优先低沉男声';assert.equal(root.querySelector('[aria-label="记忆类型"]').options.length,1)
 click('保存记忆');await tick();assert.match(root.querySelector('.production-memory-editor').textContent,/记忆已被修改/);assert.equal(root.querySelector('[aria-label="记忆正文"]').value,'优先低沉男声');assert.equal(submitted.expected_revision,7);assert.equal(submitted.kind,'preference');assert.equal(submitted.user_quote,'优先低沉男声')
 conflict=false;click('保存记忆');await tick();assert.equal(root.querySelector('.production-memory-editor'),null)
})

test('短剧记忆提供正文读取、修改历史、归档和删除，销毁清理全部dialog/遮罩',async t=>{
 const entry={id:'mem_test',scope:'project',key:'tone',title:'张飞表达',kind:'decision',stages:['shot_design'],status:'active',revision:1,content:'整体沉稳',source:{origin:'conversation',user_quote:'张飞整体沉稳'}},commands=[]
 const {root,panel,click}=setup(t,async(path,options)=>{if(options){commands.push(JSON.parse(options.body));return {saved:true}}if(path.includes('history=1'))return {revision:1,total:1,entries:[{action:'upsert',entry}]};if(path.includes('id='))return {revision:1,entry};return {revision:1,total:1,entries:[entry]}})
 await panel.open('project');click('查看/编辑');await tick();assert.equal(root.querySelector('[aria-label="记忆正文"]').value,'整体沉稳');click('取消');click('修改历史');await tick();assert.match(root.querySelector('textarea').value,/张飞整体沉稳/);click('关闭历史');click('归档');await tick();assert.equal(commands[0].action,'archive');click('删除');await tick();assert.equal(commands[1].action,'delete');panel.dispose();assert.equal(root.querySelectorAll('dialog,.panel-dialog-overlay').length,0)
})

test('面板支持原话提炼、整理记录分页、摘要和历史入口，关闭停止轮询',async t=>{
 const calls=[];const {root,panel,click}=setup(t,async(path,options)=>{calls.push({path,options});if(options){const input=JSON.parse(options.body);assert.equal(input.turns[0].text,'记住张飞沉稳');return {group_id:'job'}}if(path.includes('summary=1'))return {digest:{summary:'张飞沉稳',source_ids:['mem'],created_at:'now'}};if(path.includes('file='))return {body:'用户原话记录',end:6,characters:6};if(path.includes('id=job'))return {status:'completed',tasks:[{metadata:{input_ref:'input.json'}}],steps:[{kind:'finish',name:'保存记忆结果',step_status:'done',result:{saved:true}}]};if(path.startsWith('production-memory-maintenance'))return {entries:[{id:'job',action:'extract',status:'completed'}]};return {revision:1,total:0,entries:[]}})
 await panel.open('project');click('从对话提炼');root.querySelector('[aria-label="待整理用户原话"]').value='记住张飞沉稳';click('开始提炼');await tick();await tick();assert.match(root.querySelector('[aria-label="记忆整理记录"]').textContent,/completed/);click('查看本次原始输入');await tick();assert.equal(root.querySelector('textarea').value,'用户原话记录');click('关闭详情');click('查看压缩摘要');await tick();assert.match(root.querySelector('textarea').value,/张飞沉稳/);click('关闭详情');click('整理历史');await tick();assert.match(root.textContent,/extract · completed/);panel.dispose();assert.equal(root.querySelectorAll('dialog,.panel-dialog-overlay').length,0)
})
