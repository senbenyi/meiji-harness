import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTaskPanel } from '../client/task-panel.js';
import { snapshotFixture } from './fixtures/project.js';

for (const status of ['queued','running','failed','completed','cancelled','superseded']) test(`拆分任务${status}在概要有反馈和准确详情入口`,()=>{
 const dom=new JSDOM('<main></main>'), previous=globalThis.document;
 try {
  globalThis.document=dom.window.document;const s=snapshotFixture(), root=document.querySelector('main');
  s.project.创作方式='剧本';s.project.剧集=[];s.runtime.queue_stopped=true;
  s.tasks=[{id:'old',business_type:'script-split',target_id:s.project.id,task_status:'failed',end_reason:'旧错误',queue_order:1},{id:'new',business_type:'script-split',target_id:s.project.id,task_status:status,end_reason:status==='failed'?'模型没有返回有效JSON':'',queue_order:2}];
  const view={page:'overview'}, context={session_id:'session-test',view,refresh:async()=>{},paint:()=>{},onError:()=>{}};
  renderTaskPanel(root,s,context);const feedback=root.querySelector('.split-task-feedback');assert.ok(feedback);
  assert.ok(feedback.querySelector(`.is-${status}`));assert.doesNotMatch(feedback.textContent,/旧错误/);
  assert.doesNotMatch(feedback.textContent,/队列已暂停|点击“开始”/);
  if(status==='failed')assert.match(feedback.textContent,/模型没有返回有效JSON/);
  if(status==='superseded')assert.match(feedback.textContent,/已作废/);
  feedback.querySelector('button').click();assert.equal(view.page,'history');assert.equal(view.task_id,'new');
 } finally {globalThis.document=previous;dom.window.close();}
});
