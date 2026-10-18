import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { JSDOM } from 'jsdom';
import { PROJECT_ASPECT_RATIOS,projectFrameSize,videoSizeOf,aspectRatioOfSize } from '../shared/media-parameters.js';
import { projectFixture } from './fixtures/project.js';
import { emptyProject,validateProject } from '../shared/project_contract.js';
import { projectDialog,detailsDialog } from '../client/project-forms.js';
import { imageParameters,videoPayload } from '../server/http/llm-server/params.js';
import { ModelRepository } from '../server/data/model-repository.js';
import { dependencyHash,isNodeCurrent } from '../shared/node-dependencies.js';
import { seedQueuedTasks } from './fixtures/queued-tasks.js';

for(const ratio of PROJECT_ASPECT_RATIOS) test(`项目${ratio}贯通图片、视频和输出尺寸`,()=>{
  const p=projectFixture();p.aspect_ratio=ratio;assert.doesNotThrow(()=>validateProject(p));
  const [w,h]=projectFrameSize(ratio),[a,b]=ratio.split(':').map(Number);
  assert.equal(w*b,h*a);assert.ok(w%2===0&&h%2===0&&Math.min(w,h)>=768);
  assert.equal(aspectRatioOfSize(videoSizeOf(ratio)),ratio);
  const local={baseUrl:'http://localhost/v1',prompt:'完整场景',aspectRatio:ratio};
  const image=imageParameters({...local,model:'gpt-image'});
  assert.ok(image.body.prompt.includes(ratio));
  assert.equal(imageParameters({...local,model:'krea2 turbo V2.5'}).body.aspect,ratio);
  const input={model:'MiniMax-H3',prompt:'画面动作',duration:4,aspectRatio:ratio};
  assert.equal(videoPayload({...input,mode:'text'}).ratio,ratio);
  const ref='data:image/png;base64,AAAA';
  assert.equal(videoPayload({...input,mode:'reference',referenceImages:[ref]}).ratio,ratio);
  assert.equal(videoPayload({...input,mode:'first_frame',inputReference:ref}).ratio,'adaptive');
});

test('创建和编辑项目均展示H3六比例，默认9:16',()=>{
  const dom=new JSDOM('<main></main>'),previous=globalThis.document;
  globalThis.document=dom.window.document;
  dom.window.HTMLDialogElement.prototype.show=function(){};
  try {
    const root=document.querySelector('main');
    const dialog=projectDialog(root,()=>{}),select=dialog.querySelector('select[name=aspect]');
    assert.deepEqual([...select.options].map(o=>o.value),PROJECT_ASPECT_RATIOS);
    assert.equal(select.value,'9:16');assert.equal(emptyProject().aspect_ratio,'9:16');
    const edit=detailsDialog(root,'编辑',{aspect_ratio:'21:9'},()=>{});
    assert.deepEqual([...edit.querySelector('select').options].map(o=>o.value),PROJECT_ASPECT_RATIOS);
    assert.equal(edit.querySelector('select').value,'21:9');
  } finally {globalThis.document=previous;dom.window.close();}
});

test('旧项目尺寸只在v25迁移为比例，保留媒体、历史和有效视频指纹',async()=>{
  const home=await mkdtemp(join(tmpdir(),'meiji-aspects-'));let repo;
  try {
    repo=new ModelRepository(home);const original=projectFixture();const model=await repo.create(original);
    await seedQueuedTasks(model,[['project-summary',original.id]]);await repo.close();repo=null;
    let db=new DatabaseSync(join(home,'meiji.sqlite'));
    const p=JSON.parse(db.prepare('SELECT data_json FROM projects WHERE id=?').get(original.id).data_json);
    p.aspect_ratio='768x1344';const snapshot={project:p,tasks:[],steps:[]};
    for(const e of p.episodes){for(const s of e.shot_list.shots){
      for(const [b,node]of [['first-last-frame',s.first_last_frame_prompt],['multimodal',s.multimodal_prompt],['video',s.video],['tail',s.last_frame]])
        if(node.node_state.status==='generated')node.node_state.dependency_hash=dependencyHash(snapshot,b,s.id);
    }e.assembly.node_state.dependency_hash=dependencyHash(snapshot,'assembly',e.id);}
    db.prepare('UPDATE projects SET data_json=? WHERE id=?').run(JSON.stringify(p),p.id);
    db.exec('PRAGMA user_version=24; DELETE FROM schema_migrations WHERE version=25;');
    const oldTasks=db.prepare('SELECT * FROM tasks').all(),oldSteps=db.prepare('SELECT * FROM task_steps').all();db.close();
    repo=new ModelRepository(home);const migrated=(await repo.open(p.id)).read().project;
    assert.equal(migrated.aspect_ratio,'9:16');
    for(let i=0;i<p.episodes[0].shot_list.shots.length;i++){
      const old=p.episodes[0].shot_list.shots[i],s=migrated.episodes[0].shot_list.shots[i];
      assert.equal(s.video.address,old.video.address);assert.equal(s.last_frame.address,old.last_frame.address);
      assert.equal(s.video.node_state.status,old.video.node_state.status);
      assert.equal(isNodeCurrent({project:migrated,tasks:[],steps:[]},'video',s.id),true);
    }
    await repo.close();repo=null;
    db=new DatabaseSync(join(home,'meiji.sqlite'));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,25);
    assert.deepEqual(db.prepare('SELECT * FROM tasks').all(),oldTasks);
    assert.deepEqual(db.prepare('SELECT * FROM task_steps').all(),oldSteps);db.close();
    assert.throws(()=>validateProject({...migrated,aspect_ratio:'768x1344'}),/aspect_ratio/);
  } finally {await repo?.close();await rm(home,{recursive:true,force:true});}
});
