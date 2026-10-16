import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { projectFixture } from './fixtures/project.js';
import { seedQueuedTasks } from './fixtures/queued-tasks.js';
import { ModelRepository } from '../server/data/model-repository.js';
import { nodeRoutes } from '../server/http/nodes/index.js';
import { composeNodePrompt, validateNodeResult } from '../server/http/ai-routes.js';
import { mergeCharacters } from '../shared/collection-identity.js';
import { characterTextCatalog, shotTextInputs } from '../shared/shot-text-inputs.js';
import { dependencyHash, stampDependencyHash, expireDownstream } from '../shared/node-dependencies.js';
import { videoType, videoImages } from '../shared/video-inputs.js';
import { NODE_TYPES, validateCommand } from '../shared/task_contract.js';

function fixture() {
  const project = projectFixture();
  const person = name => ({ name, gender: '男', era: '近代', position: '', age_range: '', body_type: '', hairstyle: '', signature_props: [], immutable_traits: [], costumes: [{ name: '常服', color: name === '甲' ? '黑' : '白', material: '棉', props: [] }] });
  project.character_library.characters = mergeCharacters(project, [person('甲'), person('乙')]).characters;
  const episode = project.episodes[0], shot = episode.shot_list.shots[0], [a,b] = project.character_library.characters;
  shot.on_screen_characters = [{ character_id: a.id, costume_id: a.costumes[0].id }];
  shot.background_characters = '几名不具名社员抬手、点头，不对应角色卡';
  const fields = Object.keys(nodeRoutes.shots.actions.generate.output.structure.shots[0]);
  const value = { shots: [Object.fromEntries(fields.map(key => [key, structuredClone(shot[key])]))] };
  const input = { language: 'zh-CN', requirements: '', segments: episode.story_outline.segments, duration: episode.duration_seconds, characters: characterTextCatalog(project), content: value, opinion: '' };
  return { project, episode, shot, a, b, input, value };
}

test('镜头表三动作传完整服装目录，群演可有动作且不要求绑定；两个来源口径一致', () => {
  const { input } = fixture();
  for(const model of ['qwen3.5:27b','codex-gpt']) for(const action of ['generate','regenerate','review']) {
    const data = Object.fromEntries(Object.keys(nodeRoutes.shots.actions[action].input).map(key => [key,input[key]]));
    const prompt = composeNodePrompt('shots', action, data, model);
    assert.match(prompt.messages.map(m=>m.content).join('\n'), new RegExp(input.characters[0].costumes[0].id));
    assert.match(prompt.system, /镜头表同时确定出镜与着装/);
    assert.match(prompt.system, /不因可见动作就要求角色卡/);
    assert.match(prompt.system, /有服装目录时必须指定一套|有服装目录时必须选择一套/);
  }
  for(const action of ['generate','regenerate','review']) {
    const { project, episode, shot } = fixture();
    const data = { language:'zh-CN', requirements:'', ...shotTextInputs(project,episode,shot,'seconds'), content:shot.seconds_storyboard, opinion:'' };
    const prompt = composeNodePrompt('seconds', action, Object.fromEntries(Object.keys(nodeRoutes.seconds.actions[action].input).map(key=>[key,data[key]])), 'codex-gpt');
    assert.doesNotMatch(prompt.system, /未建卡背景群演不得加入/);
    assert.match(prompt.system, /不能因其可见或有动作而判绑定缺失/);
  }
});

test('镜头表直接校验人物/服装归属，空服装只用于无服装目录', () => {
  const { input,value,b } = fixture();
  assert.doesNotThrow(()=>validateNodeResult('shots','generate',value,input));
  const bad = structuredClone(value);
  bad.shots[0].on_screen_characters[0].costume_id = b.costumes[0].id;
  assert.throws(()=>validateNodeResult('shots','generate',bad,input),/属于/);
  bad.shots[0].on_screen_characters[0].costume_id = '';
  assert.throws(()=>validateNodeResult('shots','generate',bad,input),/服装/);
  input.characters[0].costumes = [];
  assert.doesNotThrow(()=>validateNodeResult('shots','generate',bad,input));
});

test('出镜/群演字段直接进入每秒依赖和视频参考，群演不占角色图；独立识别入口退役', () => {
  const {project,episode,shot,a} = fixture(), snapshot={project,tasks:[],steps:[]};
  assert.equal(NODE_TYPES.includes('shot-characters'),false);
  assert.equal(nodeRoutes['shot-characters'],undefined);
  assert.throws(()=>validateCommand({type:'submit',project_id:project.id,request_id:'retired',business_type:'shot-characters',target_id:shot.id,action:'generate'}),/并入镜头表/);
  assert.deepEqual(shotTextInputs(project,episode,shot,'seconds').shot.on_screen_characters,shot.on_screen_characters);
  assert.equal(videoType(episode,shot),'多模态');
  assert.equal(videoImages(project,shot)[0].id,a.costumes[0].id);
  const hash=dependencyHash(snapshot,'seconds',shot.id);
  shot.background_characters+='，望向实验场';
  assert.notEqual(dependencyHash(snapshot,'seconds',shot.id),hash);
  shot.on_screen_characters=[];
  assert.equal(videoType(episode,shot),'文生');
  stampDependencyHash(snapshot,'shots',episode.id);
  expireDownstream(snapshot,'shots',episode.id,'镜头表已变化',{compareHash:false});
  assert.equal(shot.seconds_storyboard.node_state.status,'expired');
});

test('v19→v20迁移绑定到镜头表，媒体及已完成历史保留，取消退役排队任务并只执行一次', async()=>{
  const root=await mkdtemp(join(tmpdir(),'meiji-shot-cast-'));
  try {
    const {project,shot}=fixture();
    const original=structuredClone(shot.on_screen_characters);
    let repo=new ModelRepository(root);const model=await repo.create(project);
    await seedQueuedTasks(model,[['seconds',shot.id]]);await repo.close();
    const path=join(root,'meiji.sqlite');let db=new DatabaseSync(path);
    const legacy=JSON.parse(db.prepare('select data_json from projects').get().data_json);
    for(const item of legacy.episodes[0].shot_list.shots){
      item.character_binding={node_state:{status:'generated',reason:'',fail_message:'',dependency_hash:'a'.repeat(64)},has_result:true,on_screen_characters:item.on_screen_characters};
      delete item.on_screen_characters;delete item.background_characters;
    }
    db.prepare('update projects set data_json=?').run(JSON.stringify(legacy));
    db.exec("update tasks set business_type='shot-characters'; DELETE FROM schema_migrations WHERE version>=20; PRAGMA user_version=19");
    const media=legacy.episodes[0].shot_list.shots.map(s=>[s.video.address,s.last_frame.address]);
    db.close();repo=new ModelRepository(root);const restored=(await repo.open(project.id)).read();
    const saved=restored.project.episodes[0].shot_list.shots[0];
    assert.equal(Object.hasOwn(saved,'character_binding'),false);
    assert.deepEqual(saved.on_screen_characters,original);
    assert.equal(saved.background_characters,'');
    assert.equal(restored.project.episodes[0].shot_list.node_state.status,'expired');
    assert.equal(saved.seconds_storyboard.node_state.status,'expired');
    assert.deepEqual(restored.project.episodes[0].shot_list.shots.map(s=>[s.video.address,s.last_frame.address]),media);
    assert.ok(restored.tasks.every(t=>t.task_status==='cancelled'));
    assert.ok(restored.steps.every(s=>s.step_status==='cancelled'));
    await repo.close();db=new DatabaseSync(path);
    assert.equal(db.prepare('pragma user_version').get().user_version,21);
    assert.equal(db.prepare('pragma integrity_check').get().integrity_check,'ok');
    const before=db.prepare('select data_json,revision from projects').all();db.close();
    repo=new ModelRepository(root);await repo.close();db=new DatabaseSync(path);
    assert.deepEqual(db.prepare('select data_json,revision from projects').all(),before);db.close();
  } finally {await rm(root,{recursive:true,force:true});}
});
