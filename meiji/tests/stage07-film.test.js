import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTaskPanel } from '../client/task-panel.js';
import { snapshotFixture } from './fixtures/project.js';
test('成片展示四节点且视频按钮提交单镜完整组，剧集无每秒tab',async()=>{
 const dom=new JSDOM('<main></main>',{url:'http://localhost'}), prev={document:globalThis.document,fetch:globalThis.fetch};
 try {
  globalThis.document=dom.window.document;const s=snapshotFixture(), e=s.project.episodes[0], shot=e.shot_list.shots[0], requests=[];
  globalThis.fetch=async(_url,opts)=>{requests.push(JSON.parse(opts.body));return {ok:true,json:async()=>({group_id:'group'})};};
  const root=document.querySelector('main'),view={page:'episode',episode_id:e.id,tab:'film'};
  const context={session_id:'session-test',view,refresh:async()=>{},paint:()=>renderTaskPanel(root,s,context),onError:()=>{}};
  context.paint();assert.equal(root.querySelectorAll('.stage-overview .stage').length,4);assert.doesNotMatch(root.textContent,/每秒指令/);assert.match(root.textContent,/每秒分镜：已生成/);
  view.shot_id=shot.id;shot.actual_duration_seconds=5.2;context.paint();
  assert.equal(root.querySelectorAll('.stage-overview .stage').length,0);
  for(const b of ['seconds','storyboard','video','tail'])assert.ok(root.querySelector(`[data-business=${b}]`));
  assert.match(root.textContent,/参考 5 秒 · 实际 5.2 秒/);
  [...root.querySelector('[data-business=video]').querySelectorAll('button')].find(b=>b.textContent==='重新生成').click();await new Promise(r=>setTimeout(r,0));
  assert.equal(requests[0].command.type,'submit-group');assert.equal(requests[0].command.group_type,'episode-film');assert.equal(requests[0].command.action,'regenerate');assert.equal(requests[0].command.shot_id,shot.id);assert.equal(requests[0].command.episode_id,e.id);
  shot.video.address='';shot.video.node_state.status='empty';context.paint();
  [...root.querySelector('[data-business=video]').querySelectorAll('button')].find(b=>b.textContent==='AI生成').click();await new Promise(r=>setTimeout(r,0));
  assert.equal(requests[1].command.type,'submit-group');assert.equal(requests[1].command.group_type,'episode-film');assert.equal(requests[1].command.action,'generate');assert.equal(requests[1].command.shot_id,shot.id);assert.equal(requests[1].command.episode_id,e.id);
 } finally {globalThis.document=prev.document;globalThis.fetch=prev.fetch;dom.window.close();}
});
