import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { JSDOM } from 'jsdom';
import { createAppRuntime } from '../server/runtime/app-runtime.js';
import { ModelRepository } from '../server/data/model-repository.js';
import { projectFixture, snapshotFixture } from './fixtures/project.js';
import { mergeCharacters } from '../shared/collection-identity.js';
import { emptyCharacterBindingModel } from '../shared/models/character_binding_model.js';
import { stampDependencyHash, dependencyHash, expireDownstream } from '../shared/node-dependencies.js';
import { assertOutput, assertProgramReview, hasNodeContent } from '../shared/node-state.js';
import { nodeOf } from '../shared/task_contract.js';
import { taskNodeInput } from '../server/handlers/node-inputs.js';
import { prepareContent } from '../server/handlers/content.js';
import { renderTaskPanel } from '../client/task-panel.js';
import { SQLiteStore } from '../server/data/sqlite-store.js';

const beat = time_range => ({ time_range, action: '开门', camera: '固定', space: '门口', audio: '风声', handoff: '门已打开', dialogue: [] });
const text = 'integrated_multimodal_description:\nA woman opens the door.\noverall_soundscape:\nWind.\nnon_diegetic_music:\nNone.';
function fixtureProject() {
  const p = projectFixture();
  p.character_library.characters = mergeCharacters(p, [{ name: '甲', gender: '女', era: '现代', position: '', age_range: '', body_type: '', hairstyle: '', signature_props: [], immutable_traits: [], costumes: [{ name: '白衣', color: '白', material: '棉', props: [] }] }]).characters;
  const s = { project: p, tasks: [], steps: [] };
  stampDependencyHash(s, 'project-characters', p.id);
  stampDependencyHash(s, 'shots', p.episodes[0].id);
  for (const shot of p.episodes[0].shot_list.shots) shot.character_binding = emptyCharacterBindingModel();
  return p;
}
async function withRuntime(run, respond = () => undefined) {
  const home = await mkdtemp(join(tmpdir(), 'meiji-text-chain-'));
  let runtime;
  const calls = [];
  try {
    runtime = await createAppRuntime({ home, gateway: { chat: async options => {
      calls.push(options);
      const result = await respond(options, calls);
      if (result !== undefined) return result;
      if (options.step.kind === 'review') return { 是否通过: true, 原因: '' };
      if (options.task.business_type === 'shot-characters') return { on_screen_characters: [] };
      if (options.task.business_type === 'seconds') return { end_state: "人物位于镜末位置，动作已完成。", pending_actions: "", pending_dialogue: "", continuing_audio: "", storyboard: [beat('0–5s')] };
      return text;
    } } });
    const p = fixtureProject(), model = await runtime.repository.create(p);
    const command = async (business, action = 'generate', target = p.episodes[0].shot_list.shots[0].id, extra = {}) => {
      const result = await runtime.tasks.command({ type: 'submit', project_id: p.id, request_id: crypto.randomUUID(), business_type: business, target_id: target, action, ...extra });

      await runtime.tasks.idle(p.id);
      return model.read().tasks.find(task => task.id === result.task_id);
    };
    await run({ runtime, p, model, command, calls });
  } finally { await runtime?.dispose(); await rm(home, { recursive: true, force: true }); }
}

test('识别合法空结果有独立状态；缺定妆照可完成识别→每秒→文本，人工编辑编号映射ID', () => withRuntime(async ({ runtime, p, model, command }) => {
  const shot = p.episodes[0].shot_list.shots[0];
  assert.equal(hasNodeContent(p, 'shot-characters', shot.id), false);
  const blocked = await command('seconds', 'regenerate');
  assert.equal(blocked.task_status, 'failed'); assert.match(blocked.end_reason, /shot-characters/);
  assert.equal((await command('shot-characters')).task_status, 'completed');
  let binding = model.read().project.episodes[0].shot_list.shots[0].character_binding;
  assert.equal(binding.has_result, true); assert.deepEqual(binding.on_screen_characters, []);
  assert.equal(hasNodeContent(model.read().project, 'shot-characters', shot.id), true);
  assert.equal((await command('seconds', 'regenerate')).task_status, 'completed');
  assert.equal((await command('storyboard', 'regenerate')).task_status, 'completed');
  const person = p.character_library.characters[0], costume = person.costumes[0];
  const edit = await runtime.tasks.command({ type: 'manual-edit', project_id: p.id, request_id: 'manual', business_type: 'shot-characters', target_id: shot.id,
    content: { on_screen_characters: [{ character_number: person.number, costume_number: costume.number }] } });
  await runtime.tasks.idle(p.id);
  assert.equal(model.read().tasks.find(task => task.id === edit.task_id).task_status, 'completed');
  binding = model.read().project.episodes[0].shot_list.shots[0].character_binding;
  assert.deepEqual(binding.on_screen_characters, [{ character_id: person.id, costume_id: costume.id }]);
  assert.equal(model.read().project.episodes[0].shot_list.shots[0].seconds_storyboard.node_state.status, 'expired');
  assert.equal(person.costume_images[0].address, '');
}));

test('缺有效角色库阻断识别且不调用模型；错编号不能覆盖原绑定', () => withRuntime(async ({ p, model, command, calls }) => {
  await model.update('test', {}, snapshot => { snapshot.project.character_library.node_state.status = 'empty'; });
  const task = await command('shot-characters');
  assert.equal(task.task_status, 'failed'); assert.match(task.end_reason, /project-characters/); assert.equal(calls.length, 0);
  const source = { project: p, tasks: [], steps: [] };
  assert.throws(() => prepareContent(source, { business_type: 'shot-characters', target_id: p.episodes[0].shot_list.shots[0].id }, { on_screen_characters: [{ character_number: 'missing', costume_number: '' }] }), /未知/);
  assert.equal(p.episodes[0].shot_list.shots[0].character_binding.has_result, false);
}));

test('seconds 语法错误是协议失败，空隙/倒序/重叠和±5边界交程序审核', () => {
  const p = fixtureProject(), shot = p.episodes[0].shot_list.shots[0]; shot.duration_seconds = 10;
  for (const end of [5, 15]) { shot.seconds_storyboard.storyboard = [beat(`0–${end}s`)]; assert.doesNotThrow(() => assertProgramReview(p, 'seconds', shot.id)); }
  for (const ranges of [['0–4.9s'], ['0–15.1s'], ['0–5s', '4–10s'], ['0–5s', '6–10s'], ['0–0s'], ['1–10s'], ['0–5s', '5–4s']]) {
    shot.seconds_storyboard.storyboard = ranges.map(beat);
    assert.doesNotThrow(() => assertOutput(p, 'seconds', shot.id));
    assert.throws(() => assertProgramReview(p, 'seconds', shot.id), /时段|误差/);
  }
  shot.seconds_storyboard.storyboard = [beat('not-time')];
  assert.throws(() => assertOutput(p, 'seconds', shot.id), /time_range/);
  shot.seconds_storyboard.storyboard = ['0–0.5s', '0.5–1s', '1–10s'].map(beat);
  assert.doesNotThrow(() => assertProgramReview(p, 'seconds', shot.id));
});

test('程序失败再AI失败共用两次修订；修订收到最新候选与对应意见', () => withRuntime(async ({ p, model, command, calls }) => {
  await command('shot-characters');
  const task = await command('seconds', 'regenerate');
  assert.equal(task.task_status, 'completed', task.end_reason);
  const steps = model.read().steps.filter(step => step.task_id === task.id);
  assert.deepEqual(steps.filter(step => step.kind === 'revise').map(step => step.round), [1, 2]);
  const generations = calls.filter(call => call.task.business_type === 'seconds' && call.step.kind !== 'review');
  assert.equal(generations.length, 3);
  assert.match(generations[1].messages.at(-1).content, /允许误差±5秒/);
  assert.match(generations[2].messages.at(-1).content, /动作缺失/);
  assert.deepEqual(model.read().project.episodes[0].shot_list.shots[0].seconds_storyboard.storyboard, [beat('0–5s')]);
}, ({ task, step }) => {
  if (task.business_type !== 'seconds') return;
  if (step.kind === 'review') return { 是否通过: step.round !== 1, 原因: step.round === 1 ? '动作缺失' : '' };
  return { end_state: "人物位于镜末位置，动作已完成。", pending_actions: "", pending_dialogue: "", continuing_audio: "", storyboard: [beat(step.kind === 'generate' ? '0–11s' : '0–5s')] };
}));

test('程序审核耗尽保存最后候选为rejected，保留旧成功hash与下游', () => withRuntime(async ({ p, model, command, calls }) => {
  await command('shot-characters');
  const before = model.read().project.episodes[0].shot_list.shots[0];
  const task = await command('seconds', 'regenerate');
  assert.equal(task.task_status, 'rejected');
  const after = model.read().project.episodes[0].shot_list.shots[0];
  assert.deepEqual(after.seconds_storyboard.storyboard, [beat('0–11s')]);
  assert.equal(after.seconds_storyboard.node_state.dependency_hash, before.seconds_storyboard.node_state.dependency_hash);
  assert.deepEqual(after.text_to_video_prompt, before.text_to_video_prompt);
  assert.equal(calls.filter(call => call.task.business_type === 'seconds').length, 3);
}, ({ task }) => task.business_type === 'seconds' ? { end_state: "人物位于镜末位置，动作已完成。", pending_actions: "", pending_dialogue: "", continuing_audio: "", storyboard: [beat('0–11s')] } : undefined));

test('episode-seconds 逐镜安排识别后每秒', () => withRuntime(async ({ runtime, p, model, calls }) => {
  const group = await runtime.tasks.command({ type: 'submit-group', project_id: p.id, request_id: 'group', group_type: 'episode-seconds', action: 'regenerate', episode_id: p.episodes[0].id });
  await runtime.tasks.idle(p.id);
  const tasks = model.read().tasks.filter(task => task.group_id === group.group_id);
  assert.deepEqual(tasks.map(task => task.business_type), ['shot-characters', 'seconds', 'shot-characters', 'seconds']);
  assert.ok(tasks.every(task => task.task_status === 'completed'), tasks.map(task => task.end_reason).join(';'));
  assert.equal(calls.filter(call => call.task.business_type === 'shot-characters' && call.step.kind === 'generate').length, 2);
  const seconds = calls.filter(call => call.task.business_type === 'seconds' && call.step.kind === 'generate');
  assert.equal(seconds[0].trace.input.previous, null);
  const savedFirst = model.read().project.episodes[0].shot_list.shots[0].seconds_storyboard;
  assert.equal(seconds[1].trace.input.previous.end_state, savedFirst.end_state);
  assert.deepEqual(seconds[1].trace.input.previous.last_beats, savedFirst.storyboard);
  const firstReview = calls.findIndex(call => call.task.business_type === 'seconds' && call.task.target_id === p.episodes[0].shot_list.shots[0].id && call.step.kind === 'review');
  assert.ok(firstReview < calls.indexOf(seconds[1]));
}));

test('输入和hash共用文本投影：图片不影响文本，声线和有效前镜穿着会影响', () => {
  const p = fixtureProject(), episode = p.episodes[0], [first, second] = episode.shot_list.shots, person = p.character_library.characters[0];
  const snapshot = { project: p, tasks: [], steps: [] };
  first.character_binding = { ...emptyCharacterBindingModel(), has_result: true, on_screen_characters: [{ character_id: person.id, costume_id: person.costumes[0].id }] };
  first.character_binding.node_state.status = 'generated';
  second.character_binding.has_result = true; second.character_binding.node_state.status = 'generated';
  for (const shot of [first, second]) for (const business of ['shot-characters', 'seconds', 'storyboard', 'video', 'tail']) stampDependencyHash(snapshot, business, shot.id);
  const before = ['shot-characters', 'seconds', 'storyboard'].map(b => dependencyHash(snapshot, b, first.id));
  person.costume_images[0].address = 'new.png'; person.costume_images[0].node_state.status = 'generated';
  assert.deepEqual(['shot-characters', 'seconds', 'storyboard'].map(b => dependencyHash(snapshot, b, first.id)), before);
  const input = taskNodeInput(snapshot, { business_type: 'seconds', target_id: first.id }, null, 'generate');
  assert.doesNotMatch(JSON.stringify(input), /has_image|costume_images|new.png/);
  assert.equal(input.previous, null);
  assert.equal(input.bindings[0].character_number, person.number);
  person.voice = '低沉';
  assert.notEqual(dependencyHash(snapshot, 'seconds', first.id), before[1]);
  assert.notEqual(dependencyHash(snapshot, 'storyboard', first.id), before[2]);
  const prior = dependencyHash(snapshot, 'shot-characters', second.id);
  first.character_binding.on_screen_characters = [];
  assert.notEqual(dependencyHash(snapshot, 'shot-characters', second.id), prior);
  expireDownstream(snapshot, 'shot-characters', first.id);
  assert.equal(second.character_binding.node_state.status, 'expired');
});

test('镜头识别取消后晚到结果不覆盖；继续使用新任务', async () => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let wait = true;
  await withRuntime(async ({ runtime, p, model }) => {
    const group = await runtime.tasks.command({ type: 'submit-group', project_id: p.id, request_id: 'cancel-group', group_type: 'episode-seconds', action: 'regenerate', episode_id: p.episodes[0].id });
    await started;
    const oldId = model.read().tasks.find(task => task.task_status === 'running').id;
    await runtime.tasks.command({ type: 'cancel', project_id: p.id, request_id: 'cancel', task_id: oldId });
    wait = false; release(); await runtime.tasks.idle(p.id);
    assert.equal(model.read().project.episodes[0].shot_list.shots[0].character_binding.has_result, false);
    const old = model.read().tasks.find(task => task.id === oldId);
    const resumed = await runtime.tasks.command({ type: 'continue-group', project_id: p.id, request_id: 'resume', group_id: group.group_id });
    await runtime.tasks.idle(p.id);
    assert.deepEqual(model.read().tasks.find(task => task.id === oldId), old);
    assert.ok(model.read().tasks.filter(task => task.group_id === resumed.group_id).every(task => task.task_status === 'completed'));
  }, async ({ task, step }) => { if (wait && task.business_type === 'shot-characters' && step.kind === 'generate') { entered(); await gate; } });
});

test('v14 新库为空；v8 明确拒绝且不修改项目、不生成迁移备份', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meiji-fresh-'));
  try {
    const repo = new ModelRepository(root);
    await repo.list();
    const path = join(root, 'meiji.sqlite');
    let db = new DatabaseSync(path);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 15);
    for (const table of ['projects', 'task_groups', 'tasks', 'task_steps']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
    db.close();
    await repo.create(fixtureProject()); await repo.close();
    db = new DatabaseSync(path);
    const before = db.prepare('SELECT * FROM projects').all();
    db.exec('PRAGMA user_version=8'); db.close();
    assert.throws(() => new SQLiteStore(path), /不支持的数据库版本：8/);
    db = new DatabaseSync(path);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 8);
    assert.deepEqual(db.prepare('SELECT * FROM projects').all(), before);
    db.close();
    assert.equal((await readdir(root)).some(name => name.includes('before-v')), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('v9 删除项目规则并重写已生成镜头文本指纹', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meiji-v9-'));
  try {
    const repo = new ModelRepository(root);
    const project = fixtureProject();
    const shot = project.episodes[0].shot_list.shots[0];
    shot.seconds_storyboard.node_state = { status: 'generated', reason: '', fail_message: '', dependency_hash: 'a'.repeat(64) };
    await repo.create(project);
    await repo.close();
    const path = join(root, 'meiji.sqlite');
    let db = new DatabaseSync(path);
    const row = db.prepare('SELECT data_json FROM projects').get();
    const stored = JSON.parse(row.data_json);
    stored.rules = [{ id: 'r_old', scope: 'project', applicable_business_types: ['seconds'], node_id: '', category: '动作', constraint: '必须', content: '保持事实' }];
    db.prepare('UPDATE projects SET data_json=?').run(JSON.stringify(stored));
    db.exec("ALTER TABLE projects ADD COLUMN queue_stopped INTEGER NOT NULL DEFAULT 0; DELETE FROM schema_migrations WHERE version>=10; PRAGMA user_version=9");
    db.close();
    const store = new SQLiteStore(path);
    store.close();
    db = new DatabaseSync(path);
    const opened = JSON.parse(db.prepare('SELECT data_json FROM projects').get().data_json);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 15);
    assert.equal(Object.hasOwn(opened, 'rules'), false);
    assert.equal(Object.hasOwn(opened, 'output_language'), false);
    assert.equal(opened.episodes[0].shot_list.shots[0].seconds_storyboard.node_state.dependency_hash, dependencyHash({ project: opened, tasks: [], steps: [] }, 'seconds', shot.id));
    db.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('v10 删除项目语言并重写已生成镜头文本指纹，正文保持不变', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meiji-v10-'));
  try {
    const repo = new ModelRepository(root);
    const project = fixtureProject();
    const shot = project.episodes[0].shot_list.shots[0];
    const body = shot.seconds_storyboard.storyboard[0].action;
    shot.seconds_storyboard.node_state = { status: 'generated', reason: '', fail_message: '', dependency_hash: 'b'.repeat(64) };
    await repo.create(project);
    await repo.close();
    const path = join(root, 'meiji.sqlite');
    let db = new DatabaseSync(path);
    const stored = JSON.parse(db.prepare('SELECT data_json FROM projects').get().data_json);
    stored.output_language = 'en';
    db.prepare('UPDATE projects SET data_json=?').run(JSON.stringify(stored));
    db.exec('ALTER TABLE projects ADD COLUMN queue_stopped INTEGER NOT NULL DEFAULT 0; DELETE FROM schema_migrations WHERE version>=11; PRAGMA user_version=10');
    db.close();
    const store = new SQLiteStore(path);
    store.close();
    db = new DatabaseSync(path);
    const opened = JSON.parse(db.prepare('SELECT data_json FROM projects').get().data_json);
    const openedShot = opened.episodes[0].shot_list.shots[0];
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 15);
    assert.equal(Object.hasOwn(opened, 'output_language'), false);
    assert.equal(openedShot.seconds_storyboard.storyboard[0].action, body);
    assert.equal(openedShot.seconds_storyboard.node_state.status, 'expired');
    assert.equal(openedShot.seconds_storyboard.end_state, '');
    assert.equal(openedShot.seconds_storyboard.node_state.dependency_hash, dependencyHash({ project: opened, tasks: [], steps: [] }, 'seconds', shot.id));
    db.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('镜头详情在每秒分镜之前展示角色识别，区分未识别与已确认无人', () => {
  const dom = new JSDOM('<main></main>'), previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const snapshot = snapshotFixture(), episode = snapshot.project.episodes[0], shot = episode.shot_list.shots[0];
    const root = document.querySelector('main');
    const context = { session_id: 'test', view: { page: 'episode', episode_id: episode.id, shot_id: shot.id, tab: 'film' }, refresh: async () => {}, paint: () => {}, onError: () => {} };
    shot.character_binding = emptyCharacterBindingModel();
    renderTaskPanel(root, snapshot, context);
    assert.match(root.textContent, /尚未识别/);
    shot.character_binding.has_result = true; shot.character_binding.node_state.status = 'generated';
    renderTaskPanel(root, snapshot, context);
    assert.match(root.textContent, /已确认无人出镜/);
    const titles = [...root.querySelectorAll('h3')].map(node => node.textContent);
    assert.ok(titles.indexOf('镜头角色与服装') >= 0);
    assert.ok(titles.indexOf('镜头角色与服装') < titles.indexOf('每秒分镜'));
  } finally { globalThis.document = previous; dom.window.close(); }
});
