import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mount } from '../src/client/workbench.js'
import { createProject } from '../src/project/create_project.js'
const tick = () => new Promise(resolve => setImmediate(resolve))
const poll = async check => { for(let n=0;n<80&&!check();n++)await new Promise(r=>setTimeout(r,10));assert.ok(check()) }

test('全局/节点历史读取前释放SSE，后台不占连接、返回前台恢复、销毁不重连', async t => {
  const dom=new JSDOM('<main></main>'), previous=globalThis.document, root=dom.window.document.querySelector('main')
  globalThis.document=dom.window.document
  let visibility='visible', session='a'
  Object.defineProperty(dom.window.document,'visibilityState',{get:()=>visibility})
  const connections=new Set(),project=await createProject({name:'连接测试'}),reads=[]
  class Events { constructor(){connections.add(this)} close(){connections.delete(this)} }
  const ui=mount(root,{getSessionId:()=>session,Events,fetcher:async url=>{
    if(url.includes('/task-history')||url.includes('/http-records')){
      assert.equal(connections.size,0,'读取历史前必须释放自己的实时连接')
      reads.push(url)
      return {ok:true,json:async()=>url.includes('/task-history')?{groups:[],total:0,offset:0,limit:20,nodeTypes:[{type:'script_revision',label:'剧本优化'}]}:{records:[]}}
    }
    return {ok:true,json:async()=>({project})}
  }})
  t.after(()=>{ui.dispose();globalThis.document=previous;dom.window.close()})
  await ui.refresh();assert.equal(connections.size,1)
  for(const selector of ['header .task-records','header .http-records','[aria-label="查看剧本优化任务记录"]']){
    root.querySelector(selector).click();await tick()
    const host=[...root.querySelector('main').children].find(node=>node.shadowRoot), shadow=host.shadowRoot
    assert.doesNotMatch(shadow.querySelector('section').textContent,/正在读取/)
    assert.equal(connections.size,0)
    await new Promise(r=>setTimeout(r,550));assert.equal(connections.size,0,'历史页不能重新占用连接')
    shadow.querySelector('button[aria-label="返回"]').click()
    await poll(()=>connections.size===1)
  }
  assert.equal(reads.length,3)
  visibility='hidden';await poll(()=>connections.size===0)
  visibility='visible';await poll(()=>connections.size===1)
  session='b';await poll(()=>connections.size===1&&root.querySelector('.project-overview'))
  ui.dispose();assert.equal(connections.size,0)
  await new Promise(r=>setTimeout(r,550));assert.equal(connections.size,0)
})
