import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { scriptImport } from '../src/node_box/project/ui/panel/script-import.js'
const tick=()=>new Promise(r=>setImmediate(r))

test('短剧内文件导入与素材库导入、失败保留旧文、销毁后拒绝迟到读取', async t => {
  const dom=new JSDOM('<main></main>'),previous=globalThis.document
  globalThis.document=dom.window.document;t.after(()=>{globalThis.document=previous;dom.window.close()})
  const root=document.querySelector('main'),received=[]
  const dispose=scriptImport(root,{importScript:async (body,originalName)=>{received.push({body,originalName})},listScripts:async()=>[{id:'a',category:'scripts',originalName:'素材剧本'}],readScript:async()=> '素材正文'})
  const file=root.querySelector('input[type=file]')
  const pick=value=>Object.defineProperty(file,'files',{value:[value],configurable:true})
  pick({name:'剧本.txt',size:20,text:async()=> '文件正文\n第二行'});await file.onchange()
  assert.deepEqual(received,[{body:'文件正文\n第二行',originalName:'剧本.txt'}])
  pick({name:'空文.md',size:0,text:async()=>''});await file.onchange();assert.match(root.textContent,/不能为空/);assert.equal(received.length,1)
  pick({name:'超限.txt',size:2*1024*1024,text:async()=> '不可读取'});await file.onchange();assert.match(root.textContent,/1MB/)
  await root.querySelector('.script-choose').onclick()
  const select=root.querySelector('select');select.value='a';await select.onchange();assert.deepEqual(received.at(-1),{body:'素材正文',originalName:'素材剧本'})
  let release;pick({name:'晚到.md',size:10,text:()=>new Promise(resolve=>{release=resolve})})
  const reading=file.onchange();dispose();release('不保存');await reading;await tick();assert.equal(received.length,2)
  assert.equal(root.querySelector('textarea'),null)
})

test('V2双入口允许大于1MiB原稿，素材库超配置上限或空稿不能提交',async t=>{
 const dom=new JSDOM('<main/>'),previous=globalThis.document;globalThis.document=dom.window.document;t.after(()=>{globalThis.document=previous;dom.window.close()});const root=document.querySelector('main'),received=[];let body='x'.repeat(2*1024*1024);const dispose=scriptImport(root,{maxScriptBytes:24*1024*1024,importScript:async text=>received.push(text),listScripts:async()=>[{id:'s',category:'scripts',originalName:'大稿.txt'}],readScript:async()=>body});t.after(dispose)
 const file=root.querySelector('input[type=file]');Object.defineProperty(file,'files',{value:[{name:'大稿.txt',size:body.length,text:async()=>body}],configurable:true});await file.onchange();assert.equal(received[0].length,body.length)
 await root.querySelector('.script-choose').onclick();const picker=root.querySelector('.script-picker');picker.value='s';body='';await picker.onchange();assert.match(root.textContent,/不能为空/);assert.equal(received.length,1);body='x'.repeat(25*1024*1024);await picker.onchange();assert.match(root.textContent,/24MB/);assert.equal(received.length,1)
})
