import { emptyCharacterModel } from '../shared/models/character_model.js';
import { assertProgramReview, assertOverride } from '../shared/node-state.js';
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createTestTextHandler as createTextHandler } from "./fixtures/ai.js";
import { taskNodeInput } from "../server/handlers/node-inputs.js";
import { prepareContent, commitContent } from "../server/handlers/content.js";
import { snapshotFixture, taskFixture, projectFixture } from "./fixtures/project.js";
import { composeNodePrompt, validateNodeResult } from "../server/http/ai-routes.js";
import { shotCharacterContext, stampDependencyHash, dependencyHash, expireDownstream, isNodeCurrent } from "../shared/node-dependencies.js";
import { characterTextCatalog, shotTextInputs } from "../shared/shot-text-inputs.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-manager.js";
import { createHandlerRegistry } from "../server/handlers/handler-registry.js";
import shots from "../server/http/nodes/shots.js";
import { parseJsonValue } from "../server/prompts/parse-json.js";
import { DatabaseSync } from "node:sqlite";
import { seedQueuedTasks } from "./fixtures/queued-tasks.js";
import { nodeRoutes } from "../server/http/nodes/index.js";
import { mergeCharacters } from "../shared/collection-identity.js";
import { videoType, videoImages } from "../shared/video-inputs.js";
import { NODE_TYPES, validateCommand } from "../shared/task_contract.js";

describe("shot-inputs", () => {
  const fields = ['title', 'id', 'scene_id', 'scene_state', 'scene_transition', 'duration_seconds', 'shot_scale', 'hook', 'body', 'continuity_transition', 'reference_anchor', 'audio_arrangement', 'on_screen_characters', 'background_characters'];

  test('镜头表保留输出契约全部正文资料并由程序维护身份', () => {
    const snapshot = snapshotFixture(), project = snapshot.project, episode = project.episodes[0];
    const original = episode.shot_list.shots[0];
    const row = Object.fromEntries(fields.map(key => [key, original[key]]));
    row.title = '开门'; row.body = '人物推门进入。'; row.shot_scale = '中景';
    row.reference_anchor.fixed_landmark = '木门';
    const content = prepareContent(snapshot, taskFixture(project, 'shots', episode.id), { shots: [row] });
    assert.equal(content.shots[0].id, original.id);
    assert.equal(content.shots[0].sequence, 1);
    for (const key of fields) assert.deepEqual(content.shots[0][key], row[key]);
  });


  test('修订意见去重，重复的任务意见与程序审核原因仅出现一次', () => {
    const snapshot = snapshotFixture(), episode = snapshot.project.episodes[0];
    const task = taskFixture(snapshot.project, 'shots', episode.id, { opinion: '镜头总时长需等于小段合计' });
    snapshot.steps = [{ task_id: task.id, kind: 'review', seq: 2, step_status: 'rejected', result: { 原因: task.opinion } }];
    const input = taskNodeInput(snapshot, task, null, 'regenerate', { kind:'revise', seq:3 });
    assert.match(input.opinion, /本轮审核诊断/);
    assert.equal(input.opinion.split(task.opinion).length, 2);
  });

  test('修订意见只读取原因，保留其中的位置依据和建议', () => {
    const snapshot = snapshotFixture(), episode = snapshot.project.episodes[0];
    const task = taskFixture(snapshot.project, 'shots', episode.id, { opinion: '' });
    snapshot.steps = [{ task_id: task.id, kind: 'review', seq: 2, step_status: 'rejected', name: 'AI审核', result: {
      是否通过: false, "类型": "模型问题",
      原因: '有明确剧情内容被改写或遗漏。位置：镜头数组位置2；依据：坚说不能成功；建议：补入本镜正文。',
    } }];
    const input = taskNodeInput(snapshot, task, null, 'regenerate', { kind: 'revise', seq: 3 });
    assert.match(input.opinion, /有明确剧情内容被改写或遗漏/);
    assert.match(input.opinion, /位置：镜头数组位置2；依据：坚说不能成功；建议：补入本镜正文/);
  });
});

describe("shots-catalog", () => {
  const character = {
    id:'c_cast',name:'武松',gender:'男',era:'古代',position:'角色定位标记',age_range:'年龄标记',
    body_type:'体型标记',hairstyle:'发型标记',signature_props:['道具标记'],immutable_traits:['特征标记'],
    voice:'声线标记',costumes:[{id:'co_cast',name:'灰褐短打',color:'颜色标记',material:'材质标记',props:['服装道具标记']}],
  };
  for (const action of ['generate','regenerate','review']) test(`镜头表${action}目录发送ID及完整服装资料，原文身份和调用方输入不变`, () => {
    const input={language:'zh-CN',requirements:'',segments:[{sequence:1,duration_seconds:10,body:'现代消防员林峥推开燃烧的门。',causal:''}],duration:10,characters:[structuredClone(character)]};
    if(action!=='generate')Object.assign(input,{opinion:'保留原文身份',content:{shots:[]}});
    const before=structuredClone(input);
    const prompt=composeNodePrompt('shots',action,input,'qwen3.5:27b');
    const user=prompt.messages.find(m=>m.role==='user').content;
    const section=user.split('## 角色与服装目录\n')[1].split('\n\n#')[0].trim();
    assert.deepEqual(JSON.parse(section), [character]);
    assert.match(user,/现代消防员林峥推开燃烧的门/);
    assert.match(user,/颜色标记/); assert.match(user,/co_cast/);
    assert.deepEqual(input,before);
    assert.equal(prompt.messages.length,action==='regenerate'?4:2);
  });

  test('目录精简不改变依赖资料，逐镜角色资料仍保留完整文字', () => {
    const project=projectFixture();project.character_library.characters=[structuredClone(character)];
    const before=shotCharacterContext(project);
    composeNodePrompt('shots','generate',{language:'zh-CN',requirements:'',segments:project.episodes[0].story_outline.segments,duration:10,characters:before},'qwen3.5:27b');
    assert.deepEqual(shotCharacterContext(project),before);
    const full=characterTextCatalog(project)[0];
    for(const key of ['position','age_range','body_type','hairstyle','signature_props','immutable_traits'])assert.deepEqual(full[key],character[key]);
    assert.equal(full.costumes[0].color,character.costumes[0].color);
    assert.equal(full.costumes[0].material,character.costumes[0].material);
  });
});

describe("shots-duration-repair", () => {
  async function runScenario({ repairDurations, invalidShape = false, episodeDuration = 20 }) {
    const root = await mkdtemp(join(tmpdir(), "meiji-shot-duration-")), project = projectFixture(), episode = project.episodes[0];
    episode.duration_seconds = episodeDuration;
    episode.story_outline.segments[0].duration_seconds = episodeDuration;
    stampDependencyHash({ project }, "outline", episode.id);
    stampDependencyHash({project}, "episode-scenes", episode.id);
    const oldHash = "a".repeat(64);
    episode.shot_list.node_state.dependency_hash = oldHash;
    const repository = new ModelRepository(root), model = await repository.create(project), prompts = [];
    let generationCount = 0;
    const handler = createTextHandler({ chat: async ({ step, messages }) => {
      const prompt = messages.filter(message => message.role !== 'system').map(message => message.content).join('\n\n');
      if (step.kind === "review") return { 是否通过: true, "类型": "", 原因: "" };
      prompts.push({ step, prompt });
      const durations = repairDurations[generationCount++] || [15, 5];
      if (invalidShape) return { shots: [], invalid: true };
      return { ...(step.kind === "revise" ? { mode: "replace" } : {}), shots: durations.map((duration_seconds, index) => ({
        title: "测试镜头", id: "", duration_seconds,
        shot_scale: "中景", hook: "", body: index === 0 ? "超限候选事件标记" : "测试收尾", continuity_transition: "",
        reference_anchor: { fixed_landmark: "", character_positions: "", departed_characters: "", lighting: "" },
        on_screen_characters: [], background_characters: "", audio_arrangement: { narration: "", dialogue: "", sound_effects: "" },
      })) };
    } });
    const service = new TaskService({ repository, execute: createHandlerRegistry({ text: handler, media: () => { throw Error("unexpected media"); } }), commitOutput: commitContent });
    try {
      const submitted = await service.command({ type: "submit", project_id: project.basic_info.id, request_id: "duration-repair", business_type: "shots", target_id: episode.id, action: "regenerate" });
      await service.idle(project.basic_info.id);
      return { snapshot: model.readAll(), taskId: submitted.task_id, prompts, generationCount, oldHash };
    } finally { await service.dispose(); await repository.close(); await rm(root, { recursive: true, force: true }); }
  }

  for (const scenario of [
    { name: "单镜超限", repairDurations: [[16, 4], [15, 5]], total: 20 },
    { name: "总时长下界", episodeDuration: 60, repairDurations: [[15, 14], [15, 15, 15, 15]], total: 60 },
    { name: "总时长上界", repairDurations: [[15, 15, 15, 6], [15, 5]], total: 20 },
  ]) test(`${scenario.name}在独立程序审核后带原候选修订`, async () => {
    const { snapshot, taskId, prompts, generationCount } = await runScenario(scenario);
    const task = snapshot.tasks.find(item => item.id === taskId), steps = snapshot.steps.filter(step => step.task_id === taskId);
    assert.equal(task.task_status, "completed", task.end_reason);
    assert.equal(generationCount, 2);
    assert.ok(steps.filter(step => ["generate", "revise"].includes(step.kind)).every(step => step.step_status === "done"));
    const rejected = steps.find(step => step.kind === "review" && step.step_status === "rejected");
    assert.match(rejected.name, /程序审核/);
    assert.ok(rejected.error_reason);
    assert.ok(prompts[1].prompt.includes(rejected.error_reason));
    assert.match(prompts[1].prompt, /超限候选事件标记/);
    assert.equal(snapshot.project.episodes[0].shot_list.shots.reduce((sum, shot) => sum + shot.duration_seconds, 0), scenario.total);
  });

  for (const durations of [[[16, 4], [17, 4], [18, 4], [19, 4]], [[10, 10], [11, 10], [12, 10], [13, 10]]])
    test(`程序审核耗尽保存最终未通过内容和原因，hash保留 ${durations[0]}`, async () => {
      const { snapshot, taskId, generationCount, oldHash } = await runScenario({ episodeDuration: 60, repairDurations: durations });
      const task = snapshot.tasks.find(item => item.id === taskId), node = snapshot.project.episodes[0].shot_list;
      assert.equal(task.task_status, "rejected", task.end_reason);
      assert.equal(generationCount, 4);
      assert.equal(node.node_state.status, "rejected");
      assert.equal(node.node_state.reason, task.end_reason);
      assert.equal(node.node_state.dependency_hash, oldHash);
      assert.deepEqual(node.shots.map(shot => shot.duration_seconds), durations[3]);
      assert.equal(snapshot.steps.filter(step => step.task_id === taskId && step.step_status === "rejected").length, 4);
    });

  test("响应结构错误重复不变提前停止修订", async () => {
    const { snapshot, taskId, generationCount } = await runScenario({ repairDurations: [[15, 5]], invalidShape: true });
    assert.equal(snapshot.tasks.find(task => task.id === taskId).task_status, "rejected");
    assert.equal(generationCount, 2);
    assert.equal(snapshot.steps.filter(step => step.task_id === taskId && step.kind === "revise").length, 1);
  });
});

describe("shots-json-nesting", () => {
  test('正确完整嵌套及字符串转义可解析，提前闭合错误不被静默修补', () => {
    const content = structuredClone(shots.actions.generate.output.structure);
    content.shots[0].on_screen_characters = [];
    content.shots[0].body = '他说："保持联系"。\n门边有\\标记。';
    const raw = JSON.stringify(content);
    const parsed = parseJsonValue(raw);
    assert.deepEqual(parsed, content);
    assert.doesNotThrow(() => validateNodeResult('shots', 'generate', parsed, {}));
    const broken = raw.replace('"departed_characters":"离场角色","lighting":', '"departed_characters":"离场角色"},"lighting":');
    assert.throws(() => parseJsonValue(broken), error => error.code === 'INVALID_MODEL_JSON');
    const wrongLevel = structuredClone(content), shot = wrongLevel.shots[0];
    shot.lighting = shot.reference_anchor.lighting; delete shot.reference_anchor.lighting;
    assert.throws(() => validateNodeResult('shots', 'generate', wrongLevel, {}), /lighting|缺少字段|未定义/);
  });
});

describe("shot-cast", () => {
  function fixture() {
    const project = projectFixture();
    const person = name => ({ name, gender: '男', era: '近代', position: '', age_range: '', body_type: '', hairstyle: '', signature_props: [], immutable_traits: [], costumes: [{ name: '常服', color: name === '甲' ? '黑' : '白', material: '棉', props: [] }] });
    project.character_library.characters = mergeCharacters(project, [person('甲'), person('乙')]).characters;
    const episode = project.episodes[0], shot = episode.shot_list.shots[0], [a,b] = project.character_library.characters;
    shot.on_screen_characters = [{ character_id: a.id, costume_id: a.costumes[0].id }];
    shot.background_characters = '几名不具名社员抬手、点头，不对应角色卡';
    const fields = Object.keys(shots.actions.generate.output.structure.shots[0]);
    const value = { shots: [Object.fromEntries(fields.map(key => [key, structuredClone(shot[key])]))] };
    const input = { language: 'zh-CN', requirements: '', segments: episode.story_outline.segments, duration: episode.duration_seconds, characters: characterTextCatalog(project), content: value, opinion: '' };
    return { project, episode, shot, a, b, input, value };
  }

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
    assert.throws(()=>validateCommand({type:'submit',project_id:project.basic_info.id,request_id:'retired',business_type:'shot-characters',target_id:shot.id,action:'generate'}),/并入镜头表/);
    assert.deepEqual(shotTextInputs(project,episode,shot,'seconds').shot.on_screen_characters,shot.on_screen_characters);
    assert.equal(videoType(project,episode,shot),'文生');
    assert.deepEqual(videoImages(project,shot),[]);
    a.costume_images[0].address='a.png';a.costume_images[0].node_state.status='generated';
    assert.equal(videoType(project,episode,shot),'多模态');
    assert.equal(videoImages(project,shot)[0].id,a.costumes[0].id);
    const hash=dependencyHash(snapshot,'seconds',shot.id);
    shot.background_characters+='，望向实验场';
    assert.notEqual(dependencyHash(snapshot,'seconds',shot.id),hash);
    shot.on_screen_characters=[];
    assert.equal(videoType(project,episode,shot),'文生');
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
      db.close();repo=new ModelRepository(root);const restored=(await repo.open(project.basic_info.id)).read();
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
      assert.equal(db.prepare('pragma user_version').get().user_version,29);
      assert.equal(db.prepare('pragma integrity_check').get().integrity_check,'ok');
      const before=db.prepare('select data_json,revision from projects').all();db.close();
      repo=new ModelRepository(root);await repo.close();db=new DatabaseSync(path);
      assert.deepEqual(db.prepare('select data_json,revision from projects').all(),before);db.close();
    } finally {await rm(root,{recursive:true,force:true});}
  });
});

describe("shots-partial-edit", () => {
  for (const changed of [0, 1]) test(`修改镜头${changed + 1}的转场只使实际输入及后镜交接受影响的文本过期`, () => {
    const snapshot = snapshotFixture(), e = snapshot.project.episodes[0];
    const before = structuredClone(e.shot_list.shots);
    const table = structuredClone(e.shot_list);
    table.shots[changed].continuity_transition = '明确切回此前的临别场面，后续保持同一回叙。';
    const task = taskFixture(snapshot.project, 'shots', e.id, { action: 'manual_edit' });
    commitContent(snapshot, task, table, { passed: true });
    expireDownstream(snapshot, 'shots', e.id);
    assert.ok(isNodeCurrent(snapshot, 'shots', e.id));
    for (const [i, shot] of e.shot_list.shots.entries()) {
      if (i < changed) {
        assert.ok(isNodeCurrent(snapshot, 'seconds', shot.id));
        assert.ok(isNodeCurrent(snapshot, 'storyboard', shot.id));
        assert.deepEqual(shot.seconds_storyboard, before[i].seconds_storyboard);
        assert.deepEqual(shot.text_to_video_prompt, before[i].text_to_video_prompt);
      } else {
        assert.equal(shot.seconds_storyboard.node_state.status, 'expired');
        assert.equal(shot.text_to_video_prompt.node_state.status, 'expired');
        assert.equal(isNodeCurrent(snapshot, 'seconds', shot.id), false);
      }
    }
  });
});


test('出镜重要人物三人可用、四人拒绝；群演不计数且人工放行不能绕过', () => {
  const project = projectFixture(), episode = project.episodes[0], shot = episode.shot_list.shots[0];
  const people = ['甲', '乙', '丙', '丁'].map(name => emptyCharacterModel({ name, gender: '男' }));
  project.character_library.characters = people;
  shot.background_characters = '数名不具名军士在远处站立。';
  const fields = Object.keys(shots.actions.generate.output.structure.shots[0]);
  const candidate = () => ({ shots: episode.shot_list.shots.map(row => Object.fromEntries(fields.map(key => [key, row[key]]))) });
  const input = { characters: characterTextCatalog(project), scenes: [] };
  shot.on_screen_characters = people.slice(0, 3).map(person => ({ character_id: person.id, costume_id: '' }));
  assert.doesNotThrow(() => validateNodeResult('shots', 'generate', candidate(), input));
  assert.doesNotThrow(() => assertProgramReview(project, 'shots', episode.id));
  shot.on_screen_characters.push({ character_id: people[3].id, costume_id: '' });
  assert.throws(() => validateNodeResult('shots', 'generate', candidate(), input), /最多3人/);
  assert.throws(() => assertProgramReview(project, 'shots', episode.id), /最多3人/);
  assert.throws(() => assertOverride(project, 'shots', episode.id), /最多3人/);
});
