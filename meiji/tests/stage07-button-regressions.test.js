import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAppRuntime } from '../server/runtime/app-runtime.js';
import { renderTaskPanel } from '../client/task-panel.js';
import { snapshotFixture, projectFixture } from './fixtures/project.js';
import { apply } from '../session.js';

test('从其他节点或项目重新进入历史清空旧详情', () => {
 const dom=new JSDOM('<main></main>'), previous=globalThis.document;
 globalThis.document=dom.window.document;
 try {
  const s=snapshotFixture(), root=document.querySelector('main');
  const view={page:'overview',task_id:'old-task',group_id:'old-group'};
  const context={session_id:'session-test',view,refresh:async()=>{},paint:()=>{},onError:()=>{}};
  const click=(label)=>{const b=[...root.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(b,label);b.click();};
  renderTaskPanel(root,s,context);
  click('查看任务历史 →');
  assert.equal(view.page,'history');assert.equal(view.task_id,null);assert.equal(view.group_id,null);
  view.page='episode';view.episode_id=s.project.剧集[0].id;view.tab='script';view.task_id='old-task';
  renderTaskPanel(root,s,context);
  click('任务历史');
  assert.equal(view.page,'history');assert.equal(view.task_id,null);assert.equal(view.group_id,null);
  assert.equal(view.history_business,'outline');assert.equal(view.target_id,null);
 } finally {globalThis.document=previous;dom.window.close();}
});

for (const latestStatus of ['running', 'completed', 'failed']) test(`恢复组合${latestStatus}时旧失败组不再提示继续`, () => {
  const dom = new JSDOM('<main></main>'), previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const s = snapshotFixture(), e = s.project.剧集[0], shot = e.镜头表.镜头[0];
    s.groups = [{id:'old',episode_id:e.id,group_type:'episode-film',shot_ids:[shot.id]}, {id:'new',episode_id:e.id,group_type:'episode-film',shot_ids:[shot.id],continued_from_group_id:'old'}];
    s.tasks = [{id:'old-task',group_id:'old',target_id:shot.id,episode_id:e.id,business_type:'video',task_status:'failed',end_reason:'旧错误',queue_order:1}, {id:'new-task',group_id:'new',target_id:shot.id,episode_id:e.id,business_type:'video',task_status:latestStatus,end_reason:latestStatus==='failed'?'新错误':'',queue_order:2}];
    const root = document.querySelector('main'), view = {page:'history'};
    renderTaskPanel(root,s,{session_id:'session-test',view,refresh:async()=>{},paint:()=>{},onError:()=>{}});
    const notices = [...root.querySelectorAll('.notice')];
    assert.equal(notices.length, latestStatus==='failed'?1:0);
    if (notices.length) assert.match(notices[0].textContent,/新错误/);
    assert.match(root.textContent,/旧错误/); // 不抹除历史失败
    view.history_business='project-summary';
    renderTaskPanel(root,s,{session_id:'session-test',view,refresh:async()=>{},paint:()=>{},onError:()=>{}});
    assert.equal(root.querySelector('.notice'),null);
  } finally {globalThis.document=previous;dom.window.close();}
});

test('项目面板打开/创建使用各自会话，旧绑定不改写，回到旧项目复用会话', async () => {
 const home=await mkdtemp(join(tmpdir(),'meiji-binding-regression-')); let runtime;
 try {
  const oldSid=`session-${randomUUID()}`, created=[];
  runtime=await createAppRuntime({home,sessionController:{create:async opts=>{const sid=`session-${randomUUID()}`;created.push({sid,...opts});return {sessionId:sid};}}});
  const a=projectFixture();await runtime.repository.create(a);await runtime.bindings.bind(oldSid,a.id);
  const b=await runtime.projectCommand({type:'create',fields:{名称:'乙',创作方向:'乙方向'}},oldSid,'panel');
  assert.notEqual(b.session_id,oldSid);assert.equal(await runtime.bindings.projectForSession(oldSid),a.id);
  assert.equal(await runtime.bindings.projectForSession(b.session_id),b.project_id);
  assert.equal(created[0].agentPreset,'meiji');
  const opened=await runtime.projectCommand({type:'open',project_id:a.id},b.session_id,'panel');
  assert.equal(opened.session_id,oldSid);assert.equal(created.length,1);
  await assert.rejects(runtime.bindings.bind(oldSid,b.project_id),/其他项目/);
  await assert.rejects(runtime.projectCommand({type:'open',project_id:b.project_id},oldSid,'session'),/新会话/);
  const unbound=`session-${randomUUID()}`;
  const c=await runtime.projectCommand({type:'create',fields:{名称:'丙',创作方向:'丙方向'}},unbound,'session');
  assert.equal(c.session_id,unbound);
 } finally {await runtime?.dispose();await rm(home,{recursive:true,force:true});}
});

test('workflow技能path为宿主可读取的本地字符串', async()=>{
 let skill;
 await apply({meiji:{ready:Promise.resolve()},tools:{register:()=>()=>{}},skills:{register:s=>{skill=s;return ()=>{};}},effect:fn=>fn()});
 assert.equal(typeof skill.path,'string');assert.ok(skill.path.endsWith('/skills/session/panel.md'));
});
