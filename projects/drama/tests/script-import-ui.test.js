import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { scriptImport } from '../src/node_box/project/ui/panel/script-import.js'
const tick=()=>new Promise(r=>setImmediate(r))

test('项目内文件导入与素材库导入、失败保留旧文、销毁后拒绝迟到读取', async t => {
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
