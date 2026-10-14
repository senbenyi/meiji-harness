import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderHistory } from '../client/history-ui.js';
import { snapshotFixture } from './fixtures/project.js';

function fixture(work) {
 const dom=new JSDOM('<main></main>'), previous=globalThis.document;
 globalThis.document=dom.window.document;
 try {
  const s=snapshotFixture(), root=document.querySelector('main'), state={page:'history'}, commands=[];
  s.tasks=[{id:'t',group_id:'g',group_seq:1,business_type:'outline',task_status:'queued',queue_order:1,source:'panel'}];s.steps=[];s.groups=[{id:'g',group_type:'single',source:'panel'}];
  const env={p:s.project,state,names:{outline:'故事大纲'},go:(page,v)=>Object.assign(state,{page},v),act:c=>commands.push(c),button:(label,fn)=>{const b=document.createElement('button');b.textContent=label;b.onclick=()=>fn();return b;}};
  const paint=()=>{root.replaceChildren();renderHistory(root,env,s);};
  work({dom,s,root,state,commands,paint});
 } finally {globalThis.document=previous;dom.window.close();}
}

test('任务整行正文/空白及键盘进入详情，操作按钮不会进入',()=>fixture(({dom,root,state,commands,paint})=>{
 for(const target of ['.run-list-row','.run-list-row p','progress']) {paint();root.querySelector(target).click();assert.equal(state.task_id,'t');state.task_id=null;state.group_id=null;}
 for(const key of ['Enter',' ']) {paint();root.querySelector('.run-list-row').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));assert.equal(state.task_id,'t');state.task_id=null;state.group_id=null;}
 paint();[...root.querySelectorAll('button')].find(b=>b.textContent==='取消').click();assert.equal(state.task_id,null);assert.equal(commands[0].type,'cancel');
}));

test('失败与未通过默认展示，正常done收起，手动选择在刷新后保留',()=>fixture(({s,root,state,paint})=>{
 state.task_id='t';
 s.steps=['done','failed','done'].map((status,i)=>({id:`s${i}`,task_id:'t',seq:i+1,kind:i===2?'review':'generate',step_status:status,result:i===2?{通过:false,原因:'未通过原因'}:'结果'}));
 paint();const cards=[...root.querySelectorAll('.run-step-card')];assert.deepEqual(cards.map(c=>c.open),[false,true,true]);
 assert.equal(cards[2].querySelector('.task-history-status').textContent,'未通过');
 cards[1].querySelector('.run-step-toggle').click();assert.equal(cards[1].open,false);paint();assert.equal(root.querySelector('[data-step-id=s1]').open,false);
 root.querySelector('[data-step-id=s0] .run-step-toggle').click();assert.equal(root.querySelector('[data-step-id=s0]').open,true);
 const heading=root.querySelector('.run-step-heading');assert.ok(heading.querySelector('strong'));assert.ok(heading.querySelector('.task-history-status'));assert.ok(heading.querySelector('.run-step-toggle'));
}));

test('提示词和HTTP跳转详情页：提示词完整分段，HTTP按次数和请求/返回分标签，复制按钮与标题同行',()=>fixture(({s,root,state,paint})=>{
 const long='完整资料'.repeat(10000)+'结束标记';state.task_id='t';
 const request={method:'POST',path:'/chat',headers:{Authorization:'[REDACTED]'},body:{messages:[{content:long}]}};
 const transfers=[{fn:'chat',method:'POST',path:'/chat',request,body:{choices:[{text:long}]},status:200,extra:'额外返回字段'},{request:{body:'第二次'},status:null,error:'网络失败'}];
 s.steps=[{id:'s',task_id:'t',seq:1,kind:'generate',step_status:'done',prompt:{system:long,user:long,body:'重复正文',output:{structure:{答案:'string'}},parameters:{reference_count:1},transfers},result:{完整结果:long}}];paint();
 assert.equal(root.querySelector('.run-record-disclosure'),null);
 const link=(t)=>[...root.querySelectorAll('.run-record-link')].find(b=>b.textContent===t);
 assert.ok(link('查看提示词')&&link('查看 HTTP'));
 const result=root.querySelector('.run-step-detail .run-record-card');assert.ok(result.querySelector('.run-record-head h4+.meiji-log-copy'));
 link('查看提示词').click();paint();
 assert.equal(root.querySelector('.run-step-card'),null);
 const cards=[...root.querySelectorAll('.run-record-page .run-record-card')];
 assert.deepEqual(cards.map(c=>c.querySelector('h4').textContent),['system','user']);
 assert.equal(cards[0].querySelector('pre').textContent,long);
 assert.equal(cards[1].querySelector('pre').textContent,long);
 assert.doesNotMatch(root.querySelector('.run-record-page').textContent,/重复正文|output|reference_count|transfers/);
 assert.equal(root.querySelectorAll('.run-record-page .meiji-log-copy').length,1);
 assert.ok(root.querySelector('.run-record-actions .meiji-log-copy'));
 assert.ok(cards.every(c=>!c.querySelector('.meiji-log-copy')));
 [...root.querySelectorAll('button')].find(b=>b.textContent==='← 返回任务').click();paint();
 assert.ok(root.querySelector('.run-step-card'));
 link('查看 HTTP').click();paint();
 const tablists=[...root.querySelectorAll('.run-record-tabs')];assert.equal(tablists.length,2);
 assert.equal(JSON.stringify(JSON.parse(root.querySelector('.run-record-page pre').textContent)),JSON.stringify(request));
 [...tablists[1].querySelectorAll('button')].find(b=>b.textContent==='返回').click();paint();
 const response=root.querySelector('.run-record-page pre').textContent;assert.equal(JSON.parse(response).body.choices[0].text,long);assert.match(response,/额外返回字段/);assert.doesNotMatch(response,/Authorization/);
 [...root.querySelectorAll('.run-record-tabs')[0].querySelectorAll('button')][1].click();paint();
 assert.match(root.querySelector('.run-record-page pre').textContent,/网络失败/);
}));

test('仅正文和字符串提示词完整展示，无正文的记录不展示输出元数据',()=>fixture(({s,root,state,paint})=>{
 state.task_id='t';state.step_id='s';state.step_view='prompt';
 for(const prompt of [{body:'媒体提示词正文',output:{type:'图片'},parameters:{reference_count:1}},'原始提示词正文']) {
  s.steps=[{id:'s',task_id:'t',seq:1,kind:'generate',prompt}];paint();
  assert.equal(root.querySelector('.run-record-page pre').textContent,typeof prompt==='string'?prompt:prompt.body);
  assert.equal(root.querySelectorAll('.run-record-page .run-record-card').length,1);
 }
 for(const prompt of [null,{output:{type:'JSON'},transfers:[]}]) {
  s.steps=[{id:'s',task_id:'t',seq:1,kind:'generate',prompt}];paint();
  assert.equal(root.querySelector('.run-record-page').textContent,'此步骤没有提示词');
 }
}));

test('作废任务列表、筛选与步骤标签显示已作废，旧任务没有开始/取消操作',()=>fixture(({s,root,state,paint})=>{
 s.tasks[0].task_status='superseded';s.tasks[0].end_reason='服务重启，未完成任务已作废';
 s.steps=[{id:'s',task_id:'t',seq:1,kind:'generate',step_status:'superseded'}];paint();
 assert.equal(root.querySelector('.task-history-status').textContent,'已作废');
 assert.equal(root.querySelector('option[value=superseded]').textContent,'已作废');
 assert.ok(![...root.querySelectorAll('button')].some(b=>['开始','取消'].includes(b.textContent)));
 root.querySelector('.run-list-row').click();paint();
 assert.match(root.querySelector('.run-detail-page').textContent,/已作废.*服务重启/s);
 assert.equal(root.querySelector('.run-step-heading .task-history-status').textContent,'已作废');
 assert.ok(![...root.querySelectorAll('button')].some(b=>['开始','取消'].includes(b.textContent)));
}));

test('组列表只显示一张卡片，详情排列全部任务步骤，二级任务HTTP能返回整组',()=>fixture(({s,root,state,paint})=>{
 s.groups=[{id:'g',name:'重要角色及图片',group_type:'workflow',source:'panel',created_at:'时间'}];
 s.tasks=[{id:'t',name:'提取角色',group_id:'g',group_seq:1,business_type:'outline',task_status:'completed',queue_order:1,source:'panel'},
 {id:'t2',name:'生成武大郎角色图',group_id:'g',group_seq:2,business_type:'character-image',task_status:'failed',queue_order:2,source:'panel',target_id:'c2',end_reason:'生成失败'}];
 s.steps=[{id:'s1',name:'提取角色资料',task_id:'t',seq:1,kind:'generate',step_status:'done'},
 {id:'s2',name:'生成角色图',task_id:'t2',seq:1,kind:'generate',step_status:'failed',error_reason:'生成失败',prompt:{user:'角色图正文',transfers:[{request:{body:'请求全文'},body:'返回全文'}]}}];
 paint();assert.equal(root.querySelectorAll('.run-list-row').length,1);assert.match(root.textContent,/重要角色及图片/);
 const typeSelect=root.querySelector('[aria-label=按节点类型筛选]');
 assert.deepEqual([...typeSelect.options].map(o=>[o.value,o.textContent]),[
  ['','全部对象'],['project-summary','项目摘要'],['project-characters','剧本重要角色'],
  ['character-image','角色图片'],['costume-image','角色定妆照'],['episode-summary','展示摘要'],
  ['outline','故事大纲'],['shots','镜头表'],
  ['shot-characters','镜头角色与服装'],['seconds','每秒分镜'],['storyboard','文本提示词'],['first-last-frame','首尾帧参数编排'],['multimodal','多模态参数编排'],['video','视频'],['tail','尾帧'],['assembly','合片']]);
 state.history_business='character-image';paint();assert.equal(root.querySelectorAll('.run-list-row').length,1);
 state.history_business='shots';paint();assert.equal(root.querySelectorAll('.run-list-row').length,0);
 state.history_business='';paint();
 root.querySelector('.run-list-row').click();paint();
 assert.equal(root.querySelectorAll('.run-task-head').length,2);assert.equal(root.querySelectorAll('.run-step-card').length,2);
 assert.deepEqual([...root.querySelectorAll('.run-step-card')].map(c=>c.open),[false,true]);
 assert.match(root.querySelector('.run-group-head').textContent,/重要角色及图片.*失败/);
 root.querySelector('[data-step-id=s2] .run-record-link').click();paint();assert.equal(root.querySelector('pre').textContent,'角色图正文');
 [...root.querySelectorAll('button')].find(b=>b.textContent==='← 返回任务').click();paint();assert.equal(root.querySelectorAll('.run-task-head').length,2);
}));

test('组筛选按聚合状态，部分完成加作废显示作废，原组与续作组均保留',()=>fixture(({s,root,state,paint})=>{
 s.groups=[{id:'g',name:'原组',group_type:'workflow'},{id:'g2',name:'续作组',group_type:'workflow'}];
 s.tasks=[{id:'t',group_id:'g',group_seq:1,business_type:'outline',task_status:'completed',queue_order:1},
 {id:'t2',group_id:'g',group_seq:2,business_type:'outline',task_status:'superseded',queue_order:2,end_reason:'重启作废'},
 {id:'t3',group_id:'g2',group_seq:1,business_type:'outline',task_status:'queued',queue_order:3}];
 paint();assert.equal(root.querySelectorAll('.run-list-row').length,2);
 state.history_status='superseded';paint();assert.equal(root.querySelectorAll('.run-list-row').length,1);assert.match(root.textContent,/原组.*已作废/s);
 root.querySelector('.run-list-row').click();paint();assert.equal([...root.querySelectorAll('button')].some(b=>b.textContent==='继续'),false);
}));
