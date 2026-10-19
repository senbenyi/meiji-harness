import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createAppRuntime } from "../server/runtime/app-runtime.js";
import { renderTaskPanel } from "../client/task-panel.js";
import { snapshotFixture, projectFixture } from "./fixtures/project.js";
import { apply } from "../session.js";
import { emptyShot } from '../shared/project_contract.js';

describe("button-regressions", () => {
  test('本集4镜仅2镜完成时，即使最近组已通过也显示继续，提交整集补齐请求', async () => {
    const dom = new JSDOM('<main></main>'), previous = { document: globalThis.document, fetch: globalThis.fetch };
    globalThis.document = dom.window.document;
    try {
      const snapshot = snapshotFixture(), episode = snapshot.project.episodes[0], requests = [], root = document.querySelector('main');
      episode.shot_list.shots.push(emptyShot({ sequence: 3, number: 'S03' }), emptyShot({ sequence: 4, number: 'S04' }));
      snapshot.groups = [{ id: 'done', group_type: 'episode-film', episode_id: episode.id, shot_ids: episode.shot_list.shots.slice(0, 2).map(shot => shot.id) }];
      snapshot.tasks = episode.shot_list.shots.slice(0, 2).map((shot, index) => ({ id: `done-${index}`, group_id: 'done', business_type: 'video', target_id: shot.id, episode_id: episode.id, task_status: 'completed', queue_order: index + 1 }));
      globalThis.fetch = async (_url, options) => { requests.push(JSON.parse(options.body).command); return { ok: true, json: async () => ({}) }; };
      const context = { session_id: 'session-test', view: { page: 'episode', episode_id: episode.id, tab: 'film' }, refresh: async () => {}, paint: () => {}, onError: message => assert.fail(message) };
      const groupCard = () => [...root.querySelectorAll('.session-project')].find(card => card.querySelector('h3')?.textContent === '逐镜头成片');
      renderTaskPanel(root, snapshot, context);
      let card = groupCard();
      assert.equal(card.querySelector('.node-ui-status').textContent, '未完成');
      const resume = [...card.querySelectorAll('button')].find(button => button.textContent === '继续');
      assert.ok(resume);
      resume.click(); await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(requests.length, 1);
      assert.equal(requests[0].type, 'submit-group'); assert.equal(requests[0].group_type, 'episode-film');
      assert.equal(requests[0].action, 'generate'); assert.equal(requests[0].episode_id, episode.id);
      assert.equal(requests[0].shot_id, undefined); assert.equal(requests[0].group_id, undefined);

      snapshot.tasks.push({ id: 'running', group_id: 'active', business_type: 'video', target_id: episode.shot_list.shots[2].id, episode_id: episode.id, task_status: 'running', queue_order: 3 });
      renderTaskPanel(root, snapshot, context); card = groupCard();
      assert.equal(card.querySelector('.node-ui-status').textContent, '生成中');
      assert.equal([...card.querySelectorAll('button')].some(button => button.textContent === '继续'), false);
      assert.ok([...card.querySelectorAll('button')].some(button => button.textContent === '取消'));

      snapshot.tasks.pop(); episode.shot_list.shots.splice(2);
      renderTaskPanel(root, snapshot, context); card = groupCard();
      assert.equal(card.querySelector('.node-ui-status').textContent, '已通过');
      assert.equal([...card.querySelectorAll('button')].some(button => button.textContent === '继续'), false);
      for (const missing of ['expired-video', 'missing-tail']) {
        const shot = episode.shot_list.shots[1];
        shot.video.node_state.status = missing === 'expired-video' ? 'expired' : 'generated';
        shot.last_frame.address = missing === 'missing-tail' ? '' : 'tail.png';
        renderTaskPanel(root, snapshot, context); card = groupCard();
        assert.ok([...card.querySelectorAll('button')].some(button => button.textContent === '继续'), missing);
      }
    } finally { globalThis.document = previous.document; globalThis.fetch = previous.fetch; dom.window.close(); }
  });

  test('整集成片按现有视频选择生成或重新生成，合片按钮独立提交合片节点', async () => {
   const dom=new JSDOM('<main></main>'), previous={document:globalThis.document,fetch:globalThis.fetch};
   globalThis.document=dom.window.document;
   try {
    const snapshot=snapshotFixture(), episode=snapshot.project.episodes[0], requests=[], root=document.querySelector('main');
    globalThis.fetch=async (_url,options)=>{requests.push(JSON.parse(options.body).command);return {ok:true,json:async()=>({})};};
    const context={session_id:'session-test',view:{page:'episode',episode_id:episode.id,tab:'film'},refresh:async()=>{},paint:()=>{},onError:()=>{}};
    const click=async label=>{const button=[...root.querySelectorAll('button')].find(button=>button.textContent===label);assert.ok(button,label);button.click();await new Promise(resolve=>setTimeout(resolve,0));};
    renderTaskPanel(root,snapshot,context);
    assert.equal([...root.querySelectorAll('button')].filter(button=>button.textContent==='一键生成').length,0);
    await click('重新生成');
    assert.equal(requests[0].type,'submit-group');assert.equal(requests[0].group_type,'episode-film');assert.equal(requests[0].action,'regenerate');assert.equal(requests[0].episode_id,episode.id);assert.equal(requests[0].shot_id,undefined);
    for(const shot of episode.shot_list.shots){shot.video.address='';shot.video.node_state.status='empty';}
    renderTaskPanel(root,snapshot,context);
    assert.equal([...root.querySelectorAll('button')].filter(button=>button.textContent==='重新生成').length,0);
    await click('一键生成');
    assert.equal(requests[1].type,'submit-group');assert.equal(requests[1].group_type,'episode-film');assert.equal(requests[1].action,'generate');assert.equal(requests[1].episode_id,episode.id);
    context.view.tab='assembly';episode.assembly.address='';episode.assembly.node_state.status='empty';
    renderTaskPanel(root,snapshot,context);
    assert.equal([...root.querySelectorAll('button')].filter(button=>button.textContent==='AI生成').length,0);
    assert.equal(root.querySelector('[data-business=assembly] input'), null);
    assert.deepEqual([...root.querySelector('[data-business=assembly]').querySelectorAll('button')].map(button=>button.textContent), ['生成合片','任务历史']);
    await click('生成合片');
    assert.equal(requests[2].type,'submit');assert.equal(requests[2].business_type,'assembly');assert.equal(requests[2].action,'generate');assert.equal(requests[2].target_id,episode.id);
   } finally {globalThis.document=previous.document;globalThis.fetch=previous.fetch;dom.window.close();}
  });

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
    view.page='episode';view.episode_id=s.project.episodes[0].id;view.tab='script';view.task_id='old-task';
    renderTaskPanel(root,s,context);
    click('任务历史');
    assert.equal(view.page,'history');assert.equal(view.task_id,null);assert.equal(view.group_id,null);
    assert.equal(view.history_business,'outline');assert.equal(view.target_id,s.project.episodes[0].id);
   } finally {globalThis.document=previous;dom.window.close();}
  });

  for (const latestStatus of ['running', 'completed', 'failed']) test(`恢复组合${latestStatus}时旧失败组不再提示继续`, () => {
    const dom = new JSDOM('<main></main>'), previous = globalThis.document;
    globalThis.document = dom.window.document;
    try {
      const s = snapshotFixture(), e = s.project.episodes[0], shot = e.shot_list.shots[0];
      s.groups = [{id:'old',episode_id:e.id,group_type:'episode-film',shot_ids:[shot.id]}, {id:'new',episode_id:e.id,group_type:'episode-film',shot_ids:[shot.id]}];
      s.tasks = [{id:'old-task',group_id:'old',target_id:shot.id,episode_id:e.id,business_type:'video',task_status:'failed',end_reason:'旧错误',queue_order:1}, {id:'new-task',group_id:'new',target_id:shot.id,episode_id:e.id,business_type:'video',task_status:latestStatus,end_reason:latestStatus==='failed'?'新错误':'',queue_order:2}];
      const root = document.querySelector('main'), view = {page:'history'};
      renderTaskPanel(root,s,{session_id:'session-test',view,refresh:async()=>{},paint:()=>{},onError:()=>{}});
      const rows = [...root.querySelectorAll('.run-list-row')];
      assert.equal(rows.length, 2);
      const rowFor = id => rows.find(row => row.querySelector('[data-record-id]')?.dataset.recordId === id);
      const oldRow = rowFor('old'), newRow = rowFor('new');
      assert.ok(oldRow); assert.ok(newRow);
      assert.match(oldRow.textContent, /旧错误/); // 不抹除历史失败
      assert.doesNotMatch(oldRow.textContent, /新错误/);
      assert.equal(newRow.querySelector('.task-history-status').textContent, {running:'生成中',completed:'已完成',failed:'失败'}[latestStatus]);
      if (latestStatus === 'failed') assert.match(newRow.textContent, /新错误/);
      else assert.doesNotMatch(newRow.textContent, /新错误/);
      assert.doesNotMatch(newRow.textContent, /旧错误/);
      assert.equal([...root.querySelectorAll('button')].some(button => button.textContent === '继续'), false);
      view.history_business='project-summary';
      renderTaskPanel(root,s,{session_id:'session-test',view,refresh:async()=>{},paint:()=>{},onError:()=>{}});
      assert.equal(root.querySelector('.run-list-row'),null);
      assert.doesNotMatch(root.textContent, /旧错误|新错误/);
    } finally {globalThis.document=previous;dom.window.close();}
  });

  test('项目面板打开/创建使用各自会话，旧绑定不改写，回到旧项目复用会话', async () => {
   const home=await mkdtemp(join(tmpdir(),'meiji-binding-regression-')); let runtime;
   try {
    const oldSid=`session-${randomUUID()}`, created=[];
    runtime=await createAppRuntime({home,sessionController:{create:async opts=>{const sid=`session-${randomUUID()}`;created.push({sid,...opts});return {sessionId:sid};}}});
    const a=projectFixture();await runtime.repository.create(a);await runtime.bindings.bind(oldSid,a.id);
    const b=await runtime.projectCommand({type:'create',fields:{name:'乙',creation_mode: "自由创作", creative_direction:'乙方向'}},oldSid,'panel');
    assert.notEqual(b.session_id,oldSid);assert.equal(await runtime.bindings.projectForSession(oldSid),a.id);
    assert.equal(await runtime.bindings.projectForSession(b.session_id),b.project_id);
    assert.equal(created[0].agentPreset,'meiji');
    const opened=await runtime.projectCommand({type:'open',project_id:a.id},b.session_id,'panel');
    assert.equal(opened.session_id,oldSid);assert.equal(created.length,1);
    await assert.rejects(runtime.bindings.bind(oldSid,b.project_id),/其他项目/);
    await assert.rejects(runtime.projectCommand({type:'open',project_id:b.project_id},oldSid,'session'),/新会话/);
    const unbound=`session-${randomUUID()}`;
    const c=await runtime.projectCommand({type:'create',fields:{name:'丙',creation_mode: "自由创作", creative_direction:'丙方向'}},unbound,'session');
    assert.equal(c.session_id,unbound);
   } finally {await runtime?.dispose();await rm(home,{recursive:true,force:true});}
  });

  test('workflow技能path为宿主可读取的本地字符串', async()=>{
   let skill;
   await apply({meiji:{ready:Promise.resolve()},tools:{register:()=>()=>{}},skills:{register:s=>{skill=s;return ()=>{};}},effect:fn=>fn()});
   assert.equal(typeof skill.path,'string');assert.ok(skill.path.endsWith('/skills/session/panel.md'));
  });
});

describe("film", () => {
  test('成片展示四节点且视频按钮提交单镜完整组，剧集无每秒tab',async()=>{
   const dom=new JSDOM('<main></main>',{url:'http://localhost'}), prev={document:globalThis.document,fetch:globalThis.fetch};
   try {
    globalThis.document=dom.window.document;const s=snapshotFixture(), e=s.project.episodes[0], shot=e.shot_list.shots[0], requests=[];
    dom.window.HTMLDialogElement.prototype.show = function () { this.open = true; };
    dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
    globalThis.fetch=async(_url,opts)=>{requests.push(JSON.parse(opts.body));return {ok:true,json:async()=>({group_id:'group'})};};
    const root=document.querySelector('main'),view={page:'episode',episode_id:e.id,tab:'film'};
    const context={session_id:'session-test',view,refresh:async()=>{},paint:()=>renderTaskPanel(root,s,context),onError:()=>{}};
    context.paint();assert.equal(root.querySelectorAll('.stage-overview .stage').length,4);assert.doesNotMatch(root.textContent,/每秒指令/);
    const nameOf=node=>node.querySelector('.shot-step-name').textContent;
    const steps=[...root.querySelectorAll('.shot-card .shot-step')];
    assert.equal(steps.find(node=>nameOf(node)==='每秒分镜').classList.contains('is-done'),true);
    assert.equal(steps.some(node=>nameOf(node)==='角色识别'),false);
    const listed=[...root.querySelectorAll('.shot-card')];
    assert.deepEqual([...listed[0].querySelectorAll('.shot-step-name')].map(node=>node.textContent),['每秒分镜','文本提示词','文生','视频']);
    assert.deepEqual([...listed[1].querySelectorAll('.shot-step-name')].map(node=>node.textContent),['每秒分镜','文本提示词','首尾帧','视频']);
    assert.equal(listed[0].querySelectorAll('.shot-result').length,4);
    assert.equal(listed[1].querySelectorAll('.shot-result').length,4);
    shot.text_to_video_prompt.node_state.status='rejected';
    shot.video.node_state.status='empty';
    context.paint();
    const repainted=[...root.querySelector('.shot-card').querySelectorAll('.shot-step')];
    assert.equal(repainted.find(node=>node.querySelector('.shot-step-name').textContent==='文本提示词').classList.contains('is-failed'),true);
    assert.equal(repainted.find(node=>node.querySelector('.shot-step-name').textContent==='视频').classList.contains('is-empty'),true);
    shot.text_to_video_prompt.node_state.status='generated';
    shot.video.node_state.status='generated';
    const filmCard=root.querySelector('.shot-card');
    assert.equal(filmCard.querySelector('.outline-head').nextElementSibling.classList.contains('task-group-ui'),true);
    assert.equal(filmCard.querySelector('.task-group-ui .node-ui-status').textContent,'未生成');
    assert.equal(filmCard.querySelector('.node-ui-opinion'),null);
    filmCard.querySelector('.task-group-ui button').click();await new Promise(r=>setTimeout(r,0));
    assert.equal(requests[0].command.type,'submit-group');assert.equal(requests[0].command.group_type,'episode-film');assert.equal(requests[0].command.action,'regenerate');assert.equal(requests[0].command.shot_id,shot.id);assert.equal(requests[0].command.episode_id,e.id);
    assert.equal(filmCard.querySelector('.shot-body h4').textContent,'本镜内容');
    assert.equal(filmCard.querySelector('.shot-body').nextElementSibling.classList.contains('shot-results'),true);
    assert.equal(filmCard.querySelectorAll('.shot-result').length,4);
    shot.video.address = 'clip.mp4';
    context.paint();
    const preview = root.querySelector('.shot-card .shot-result video');
    assert.equal(preview.getAttribute('aria-label'), `${shot.number} 视频预览`);
    preview.click();
    const player = root.querySelector('dialog.video-preview video');
    assert.ok(player);
    assert.equal(player.controls, true);
    assert.match(player.getAttribute('src'), /clip\.mp4/);
    root.querySelector('dialog.video-preview button').click();
    assert.equal(root.querySelector('dialog.video-preview'), null);
    assert.equal([...root.querySelectorAll('button')].some(button=>button.textContent==='查看详情'),true);
    assert.equal([...root.querySelectorAll('button')].some(button=>button.textContent==='打开镜头'),false);
    view.shot_id=shot.id;shot.actual_duration_seconds=5.2;context.paint();
    assert.equal(root.querySelectorAll('.stage-overview .stage').length,0);
    for(const b of ['seconds','storyboard','video','tail'])assert.ok(root.querySelector(`[data-business=${b}]`));
    assert.match(root.textContent,/参考 5 秒 · 实际 5.2 秒/);
    [...root.querySelector('[data-business=video]').querySelectorAll('button')].find(b=>b.textContent==='重新生成').click();await new Promise(r=>setTimeout(r,0));
    assert.equal(requests[1].command.type,'submit-group');assert.equal(requests[1].command.group_type,'episode-film');assert.equal(requests[1].command.action,'regenerate');assert.equal(requests[1].command.shot_id,shot.id);assert.equal(requests[1].command.episode_id,e.id);
    shot.video.address='';shot.video.node_state.status='empty';context.paint();
    [...root.querySelector('[data-business=video]').querySelectorAll('button')].find(b=>b.textContent==='AI生成').click();await new Promise(r=>setTimeout(r,0));
    assert.equal(requests[2].command.type,'submit-group');assert.equal(requests[2].command.group_type,'episode-film');assert.equal(requests[2].command.action,'generate');assert.equal(requests[2].command.shot_id,shot.id);assert.equal(requests[2].command.episode_id,e.id);
    shot.video_generation_type='';shot.scene_id='scene-1';shot.scene_transition='换场';shot.on_screen_characters=[];
    view.shot_id=null;context.paint();
    assert.deepEqual([...root.querySelector('.shot-card').querySelectorAll('.shot-step-name')].map(node=>node.textContent),['每秒分镜','文本提示词','文生','视频']);
    view.shot_id=shot.id;context.paint();
    assert.match(root.textContent,/视频类型：文生/);
    assert.equal(root.querySelector('[data-business=multimodal]'),null);
    assert.equal(root.querySelector('[data-business=first-last-frame]'),null);
   } finally {globalThis.document=prev.document;globalThis.fetch=prev.fetch;dom.window.close();}
  });
  test('成片组停在旧审核时，节点已通过则不再展示该未通过原因',async()=>{
   const dom=new JSDOM('<main></main>',{url:'http://localhost'}), prev={document:globalThis.document};
   try {
    globalThis.document=dom.window.document;
    const s=snapshotFixture(), e=s.project.episodes[0], shot=e.shot_list.shots[0], reason='节拍或对白｜旧审核意见';
    s.groups=[{id:'film',group_type:'episode-film',episode_id:e.id,shot_ids:e.shot_list.shots.map(item=>item.id)}];
    s.tasks=[{id:'seconds-old',group_id:'film',group_seq:1,queue_order:1,business_type:'seconds',target_id:shot.id,task_status:'rejected',end_reason:reason}];
    s.project.latest_groups={[`episode-film:${e.id}`]:'film'};
    shot.seconds_storyboard.node_state.status='generated';shot.seconds_storyboard.node_state.reason='';
    const root=document.querySelector('main');
    const paint=()=>renderTaskPanel(root,s,{session_id:'session-test',view:{page:'episode',episode_id:e.id,tab:'film'},refresh:async()=>{},paint:()=>{},onError:()=>{}});
    const film=()=>[...root.querySelectorAll('section')].find(item=>item.querySelector('h3')?.textContent==='逐镜头成片');
    paint();
    assert.equal(film().querySelector('.node-ui-status').textContent,'未通过');
    assert.equal(film().textContent.includes(reason),false);
    shot.seconds_storyboard.node_state.status='rejected';shot.seconds_storyboard.node_state.reason=reason;
    paint();
    assert.equal(film().textContent.includes(reason),true);
   } finally {globalThis.document=prev.document;dom.window.close();}
  });
});
