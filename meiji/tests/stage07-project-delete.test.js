import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { randomUUID } from 'node:crypto';
import { mount } from '../client/workbench.js';
import { snapshotFixture } from './fixtures/project.js';

async function until(check) {
 for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}
 assert.fail('等待面板更新超时');
}
async function fixture(work) {
 const dom=new JSDOM('<body></body>',{url:'http://localhost'}), saved={};
 for(const key of ['window','document','localStorage','EventSource','fetch'])saved[key]=globalThis[key];
 const sid=`session-${randomUUID()}`, s=snapshotFixture(), other=snapshotFixture(), streams=[];
 s.project.名称='待删除甲';other.project.名称='保留乙';
 const api={projects:[s,other],bound:s,fail:false,confirmed:true,deletes:0};let app;
 try {
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,EventSource:class{constructor(){streams.push(this);}close(){this.closed=true;}}});
  window.confirm=()=>api.confirmed;
  localStorage.setItem('dsh.sessions.current',JSON.stringify({sessionId:sid}));
  globalThis.fetch=async(url,options)=>{
   if(url.endsWith('/project-command')){
    const {command}=JSON.parse(options.body);api.deletes++;
    if(api.waitDelete)await api.waitDelete;
    if(api.fail)return {ok:false,json:async()=>({message:'项目仍有未结束任务'})};
    api.projects=api.projects.filter(p=>p.project.id!==command.project_id);
    if(api.bound?.project.id===command.project_id)api.bound=null;
    return {ok:true,json:async()=>({deleted:true})};
   }
   if(url.endsWith('/projects'))return {ok:true,json:async()=>({projects:api.projects.map(p=>({id:p.project.id,名称:p.project.名称,画幅:p.project.画幅,集数:1}))})};
   if(url.includes('/context?')){
    const snapshot=api.bound?structuredClone(api.bound):null;
    if(api.waitContext){const wait=api.waitContext;api.waitContext=null;await wait;}
    return {ok:true,json:async()=>({project_id:snapshot?.project.id||null,snapshot})};
   }
   throw Error('意外请求'+url);
  };
  app=mount();await app.refresh();
  const click=(label,scope=app.shell.root)=>{const b=[...scope.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(b,label);b.click();};
  const library=async()=>{click('片库');await until(()=>app.shell.content.textContent.includes('保留乙'));};
  await work({app,api,s,other,streams,click,library});
 } finally {app?.dispose();for(const [key,v]of Object.entries(saved)){if(v===undefined)delete globalThis[key];else globalThis[key]=v;}dom.window.close();}
}

test('片库删除当前项目立即更新列表、清上下文/订阅，晚到刷新不恢复',()=>fixture(async({app,api,s,streams,click,library})=>{
 await library();let release;api.waitContext=new Promise(r=>release=r);const late=app.refresh();
 const card=[...app.shell.content.querySelectorAll('.project-list article')].find(c=>c.textContent.includes('待删除甲'));
 click('删除项目',card);await until(()=>api.deletes===1&&!app.shell.content.textContent.includes('待删除甲'));
 assert.equal(app.context.read(),null);assert.equal(app.context.token().project_id,null);assert.ok(streams.every(s=>s.closed));
 assert.equal(app.shell.root.querySelector('.brand').textContent,'极乐世界');
 release();await late;assert.equal(app.context.read(),null);
 click('极乐世界');await until(()=>app.shell.content.textContent.includes('保留乙'));assert.doesNotMatch(app.shell.content.textContent,/待删除甲/);
}));

test('概要删除后空context自动回片库并关闭旧订阅',()=>fixture(async({app,streams,click})=>{
 click('删除项目');await until(()=>app.context.read()===null&&app.shell.content.textContent.includes('保留乙'));
 assert.equal(app.view.page,'library');assert.equal(app.shell.root.querySelector('.brand').textContent,'极乐世界');assert.ok(streams.every(s=>s.closed));
}));

test('取消与失败均保留当前项目和订阅',()=>fixture(async({app,api,s,streams,click,library})=>{
 await library();const card=()=>[...app.shell.content.querySelectorAll('.project-list article')].find(c=>c.textContent.includes('待删除甲'));
 api.confirmed=false;click('删除项目',card());assert.equal(api.deletes,0);assert.equal(app.context.read().project.id,s.project.id);
 api.confirmed=true;api.fail=true;click('删除项目',card());await until(()=>api.deletes===1);await new Promise(r=>setTimeout(r,0));
 assert.equal(app.context.read().project.id,s.project.id);assert.equal(streams.at(-1).closed,undefined);assert.match(app.shell.content.textContent,/待删除甲/);
}));

test('删除其他项目仅更新列表，不清当前项目',()=>fixture(async({app,api,s,streams,click,library})=>{
 await library();const card=[...app.shell.content.querySelectorAll('.project-list article')].find(c=>c.textContent.includes('保留乙'));
 click('删除项目',card);await until(()=>api.deletes===1&&!app.shell.content.textContent.includes('保留乙'));
 assert.equal(app.context.read().project.id,s.project.id);assert.equal(streams.at(-1).closed,undefined);assert.equal(app.view.page,'library');
}));

test('删除等待期间切换上下文，旧回调不清新项目',()=>fixture(async({app,api,other,click,library})=>{
 await library();let release;api.waitDelete=new Promise(r=>release=r);
 const card=[...app.shell.content.querySelectorAll('.project-list article')].find(c=>c.textContent.includes('待删除甲'));click('删除项目',card);await until(()=>api.deletes===1);
 app.context.select(app.context.token().session_id,other.project.id);app.context.accept(app.context.token(),other);api.bound=other;
 release();await new Promise(r=>setTimeout(r,10));assert.equal(app.context.read().project.id,other.project.id);
}));
