import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { showToast } from '../index.js'

test('toast安全展示原文、自动消失且不改页面正文', async t => {
  const dom = new JSDOM('<main>业务页面</main>'); t.after(() => dom.window.close())
  showToast('<img src=x> 已复制', { document: dom.window.document, duration: 20 })
  const host = dom.window.document.querySelector('.agent-ui-toast')
  assert.equal(host.shadowRoot.querySelector('[role=status]').textContent, '<img src=x> 已复制')
  assert.equal(host.shadowRoot.querySelector('img'), null)
  assert.equal(dom.window.document.querySelector('main').textContent, '业务页面')
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(dom.window.document.querySelector('.agent-ui-toast'), null)
})

test('连续反馈替换、旧关闭句柄不影响新toast，不同document互相隔离', t => {
  const a=new JSDOM(),b=new JSDOM();t.after(()=>{a.window.close();b.window.close()})
  const closeOld=showToast('旧消息',{document:a.window.document})
  const closeNew=showToast('重试失败',{document:a.window.document,kind:'error'})
  showToast('另一个页面',{document:b.window.document})
  closeOld()
  assert.equal(a.window.document.querySelectorAll('.agent-ui-toast').length,1)
  assert.equal(a.window.document.querySelector('.agent-ui-toast').shadowRoot.querySelector('.error').textContent,'重试失败')
  closeNew();assert.equal(a.window.document.querySelector('.agent-ui-toast'),null)
  assert.ok(b.window.document.querySelector('.agent-ui-toast'))
})
