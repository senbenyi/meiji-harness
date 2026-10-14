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
 paint();assert.equal([...root.querySelectorAll('button')].some(b=>b.textContent==='取消'),false);assert.equal(commands.length,0);
}));

test('步骤结果默认收起两行，手动选择在刷新后保留',()=>fixture(({s,root,state,paint})=>{
 state.task_id='t';
 s.steps=['done','failed','done'].map((status,i)=>({id:`s${i}`,task_id:'t',seq:i+1,kind:i===2?'review':'generate',step_status:status,result:i===2?{通过:false,原因:'未通过原因'}:'结果'}));
 paint();const cards=[...root.querySelectorAll('.run-step-card')];assert.deepEqual(cards.map(c=>c.classList.contains("is-expanded")),[false,false,false]);
 assert.equal(cards[2].querySelector('.task-history-status').textContent,'未通过');
 cards[1].querySelector('.run-step-toggle').click();assert.equal(cards[1].classList.contains("is-expanded"),true);paint();assert.equal(root.querySelector('[data-step-id=s1]').classList.contains('is-expanded'),true);
 root.querySelector('[data-step-id=s0] .run-step-toggle').click();assert.equal(root.querySelector('[data-step-id=s0]').classList.contains('is-expanded'),true);
 const heading=root.querySelector('.run-step-heading');assert.ok(heading.querySelector('strong'));assert.ok(heading.querySelector('.task-history-status'));assert.ok(heading.querySelector('.run-step-toggle'));
}));

test('收起仍展示起止时间、原因和入口，复制完整结果及原因，多轮提示词保持顺序',()=>fixture(({s,root,state,paint})=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator'), copies=[];
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async value=>{copies.push(value);}}}});
 try {
  state.task_id='t';
  const result={是否通过:false,原因:'第一行原因\n第二行原因\n第三行原因'}, messages=[
   {role:'system',content:'规则'}, {role:'user',content:'原始任务资料'},
   {role:'assistant',content:'上一轮结果'}, {role:'user',content:'修改意见'},
  ];
  s.steps=[{id:'s',task_id:'t',seq:1,kind:'review',step_status:'rejected',started_at:'开始时间',ended_at:'结束时间',result,prompt:{messages,system:'旧字段不应重复',user:'旧字段不应重复'}}];
  paint();
  const card=root.querySelector('.run-step-card');
  assert.equal(card.tagName,'LI');
  assert.equal(card.classList.contains('is-expanded'),false);
  assert.match(card.textContent,/开始时间 → 结束时间/);
  assert.match(card.querySelector('.run-step-error').textContent,/未通过原因：第一行原因/);
  assert.equal(card.querySelector('.run-step-result pre').textContent,JSON.stringify(result,null,2));
  card.querySelector('[aria-label="复制步骤结果"]').click();
  card.querySelector('[aria-label="复制原因"]').click();
  assert.deepEqual(copies,[JSON.stringify(result,null,2),result.原因]);
  card.querySelector('.run-step-toggle').click();
  assert.equal(card.querySelector('.run-step-toggle').getAttribute('aria-expanded'),'true');
  assert.equal(card.querySelector('.run-step-result pre').textContent,JSON.stringify(result,null,2));
  card.querySelector('.run-record-link').click();paint();
  assert.deepEqual([...root.querySelectorAll('.run-record-card h4')].map(node=>node.textContent),['1. system','2. user','3. assistant','4. user']);
  assert.deepEqual([...root.querySelectorAll('.run-record-card pre')].map(node=>node.textContent),messages.map(message=>message.content));
  root.querySelector('[aria-label="复制全部提示词"]').click();
  assert.equal(copies.at(-1),messages.map((message,index)=>`${index+1}. ${message.role}:\n${message.content}`).join('\n\n'));
 } finally {
  if(previous) Object.defineProperty(globalThis,'navigator',previous); else delete globalThis.navigator;
 }
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
 state.http_index=0;state.http_tab='request';
 s.steps[0].prompt.transfers=[{fn:'chat',method:'POST',path:'/chat',request:{body:'已发出'}}];paint();
 assert.match(root.querySelector('.run-record-page').textContent,/已发出/);
 [...root.querySelectorAll('.run-record-tabs')].at(-1).querySelectorAll('button')[1].click();paint();
 assert.match(root.querySelector('.run-record-page').textContent,/尚未返回/);
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

test('旧的作废记录显示已取消，没有单独的已作废筛选项',()=>fixture(({s,root,state,paint})=>{
 s.tasks[0].task_status='superseded';s.tasks[0].end_reason='服务重启，未完成任务已取消';
 s.steps=[{id:'s',task_id:'t',seq:1,kind:'generate',step_status:'superseded'}];paint();
 assert.equal(root.querySelector('.task-history-status').textContent,'已取消');
 assert.equal(root.querySelector('option[value=superseded]'),null);
 assert.equal(root.querySelector('option[value=cancelled]').textContent,'已取消');
 assert.ok(![...root.querySelectorAll('button')].some(b=>['开始','取消'].includes(b.textContent)));
 root.querySelector('.run-list-row').click();paint();
 assert.match(root.querySelector('.run-detail-page').textContent,/已取消.*服务重启/s);
 assert.equal(root.querySelector('.run-step-heading .task-history-status').textContent,'已取消');
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
 assert.deepEqual([...root.querySelectorAll('.run-step-card')].map(c=>c.classList.contains("is-expanded")),[false,false]);
 assert.match(root.querySelector('.run-group-head').textContent,/重要角色及图片.*失败/);
 root.querySelector('[data-step-id=s2] .run-record-link').click();paint();assert.equal(root.querySelector('pre').textContent,'角色图正文');
 [...root.querySelectorAll('button')].find(b=>b.textContent==='← 返回任务').click();paint();assert.equal(root.querySelectorAll('.run-task-head').length,2);
}));

test('组筛选把旧作废并入已取消，原组与续作组均保留',()=>fixture(({s,root,state,paint})=>{
 s.groups=[{id:'g',name:'原组',group_type:'workflow'},{id:'g2',name:'续作组',group_type:'workflow'}];
 s.tasks=[{id:'t',group_id:'g',group_seq:1,business_type:'outline',task_status:'completed',queue_order:1},
 {id:'t2',group_id:'g',group_seq:2,business_type:'outline',task_status:'superseded',queue_order:2,end_reason:'重启作废'},
 {id:'t3',group_id:'g2',group_seq:1,business_type:'outline',task_status:'queued',queue_order:3}];
 paint();assert.equal(root.querySelectorAll('.run-list-row').length,2);
 state.history_status='cancelled';paint();assert.equal(root.querySelectorAll('.run-list-row').length,1);assert.match(root.textContent,/原组.*已取消/s);
 root.querySelector('.run-list-row').click();paint();assert.equal([...root.querySelectorAll('button')].some(b=>b.textContent==='继续'),false);
}));

test('任务历史卡片和详情都不放继续',()=>fixture(({s,root,state,paint})=>{
 s.tasks[0].task_status='cancelled';s.tasks[0].end_reason='用户取消';s.tasks[0].action='generate';s.tasks[0].business_type='outline';
 s.steps=[{id:'s',task_id:'t',seq:1,kind:'generate',step_status:'cancelled',result:'结果',prompt:{system:'系统',user:'用户'}}];
 paint();
 const card=root.querySelector('.run-list-row');
 assert.equal([...card.querySelectorAll('button')].some(b=>b.textContent==='继续'),false);
 assert.match(card.textContent,/用户取消/);
 card.click();paint();
 const labels=[...root.querySelectorAll('.run-detail-page button')].map(b=>b.textContent);
 assert.equal(labels.includes('继续'),false);
 assert.equal(labels.includes('取消'),false);
 assert.ok(labels.includes('查看提示词')&&labels.includes('查看 HTTP')&&labels.includes('复制结果'));
}));
