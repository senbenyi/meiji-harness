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
      if (options.step.kind === 'review') return { 是否通过: true, "类型": "", 原因: '' };
      if (options.task.business_type === 'seconds') return { end_state: "人物位于镜末位置，动作已完成。", pending_actions: "", pending_dialogue: "", continuing_audio: "", storyboard: [beat('0–5s')] };
      return text;
    } } });
    const p = fixtureProject(), model = await runtime.repository.create(p);
    const command = async (business, action = 'generate', target = p.episodes[0].shot_list.shots[0].id, extra = {}) => {
      const result = await runtime.tasks.command({ type: 'submit', project_id: p.id, request_id: crypto.randomUUID(), business_type: business, target_id: target, action, ...extra });

      await runtime.tasks.idle(p.id);
      return model.readAll().tasks.find(task => task.id === result.task_id);
    };
    await run({ runtime, p, model, command, calls });
  } finally { await runtime?.dispose(); await rm(home, { recursive: true, force: true }); }
}

test('独立识别节点退役，每秒分镜直接继承镜头表', () => withRuntime(async ({ runtime, p, command }) => {
  await assert.rejects(runtime.tasks.command({ type: 'submit', project_id: p.id, request_id: 'retired', business_type: 'shot-characters', target_id: p.episodes[0].shot_list.shots[0].id, action: 'generate' }), /并入镜头表/);
  assert.equal((await command('seconds', 'regenerate')).task_status, 'completed');
}));

test('seconds 语法错误是协议失败，空隙/倒序/重叠和总长不等交程序审核', () => {
  const p = fixtureProject(), shot = p.episodes[0].shot_list.shots[0]; shot.duration_seconds = 10;
  for (const ranges of [['0–10s'], ['0–2s', '2–5s', '5–10s'], ['0–1s', '1–2s', '2–3s', '3–4s', '4–5s', '5–6s', '6–7s', '7–8s', '8–9s', '9–10s']]) {
    shot.seconds_storyboard.storyboard = ranges.map(beat);
    assert.doesNotThrow(() => assertProgramReview(p, 'seconds', shot.id));
  }
  for (const end of [5, 9, 9.5, 11, 15]) {
    shot.seconds_storyboard.storyboard = [beat(`0–${end}s`)];
    assert.throws(() => assertProgramReview(p, 'seconds', shot.id), /需等于本镜参考 10 秒/);
  }
  for (const ranges of [['0–4.9s'], ['0–15.1s'], ['0–5s', '4–10s'], ['0–5s', '6–10s'], ['0–0s'], ['1–10s'], ['0–5s', '5–4s']]) {
    shot.seconds_storyboard.storyboard = ranges.map(beat);
    assert.doesNotThrow(() => assertOutput(p, 'seconds', shot.id));
    assert.throws(() => assertProgramReview(p, 'seconds', shot.id), /时段|需等于/);
  }
  shot.seconds_storyboard.storyboard = [beat('not-time')];
  assert.throws(() => assertOutput(p, 'seconds', shot.id), /time_range/);
  shot.seconds_storyboard.storyboard = ['0–0.5s', '0.5–1s', '1–10s'].map(beat);
  assert.doesNotThrow(() => assertProgramReview(p, 'seconds', shot.id));
});

test('程序失败再AI失败共用两次修订；修订收到最新候选与对应意见', () => withRuntime(async ({ p, model, command, calls }) => {
  const task = await command('seconds', 'regenerate');
  assert.equal(task.task_status, 'completed', task.end_reason);
  const steps = model.readAll().steps.filter(step => step.task_id === task.id);
  assert.deepEqual(steps.filter(step => step.kind === 'revise').map(step => step.round), [1, 2]);
  const generations = calls.filter(call => call.task.business_type === 'seconds' && call.step.kind !== 'review');
  assert.equal(generations.length, 3);
  assert.match(generations[1].messages.at(-1).content, /需等于本镜参考 5 秒/);
  assert.match(generations[2].messages.at(-1).content, /动作缺失/);
  assert.deepEqual(model.readAll().project.episodes[0].shot_list.shots[0].seconds_storyboard.storyboard, [beat('0–5s')]);
}, ({ task, step }) => {
  if (task.business_type !== 'seconds') return;
  if (step.kind === 'review') return { 是否通过: step.round !== 1, "类型": (step.round !== 1) ? "" : "模型问题", 原因: step.round === 1 ? '动作缺失' : '' };
  return { end_state: "人物位于镜末位置，动作已完成。", pending_actions: "", pending_dialogue: "", continuing_audio: "", storyboard: [beat(step.kind === 'generate' ? '0–11s' : '0–5s')] };
}));

test('AI拒绝后的程序拒绝不丢失业务意见，再修订仍使用最新候选', () => withRuntime(async ({ model, command, calls }) => {
  const task = await command('seconds', 'regenerate');
  assert.equal(task.task_status, 'completed', task.end_reason);
  const generations = calls.filter(call => call.task.id === task.id && call.step.kind !== 'review');
  assert.equal(generations.length, 3);
  const final = generations[2];
  assert.match(final.messages.at(-1).content, /需等于本镜参考 5 秒/);
  assert.match(final.messages.at(-1).content, /结束状态必须明确门已打开/);
  assert.match(final.messages.at(-1).content, /已解决项不重复修改/);
  assert.equal(JSON.parse(final.messages[2].content).storyboard[0].time_range, '0–11s');
  assert.equal(JSON.parse(final.messages[2].content).end_state, '门已打开。');
  const steps = model.readAll().steps.filter(step => step.task_id === task.id);
  assert.equal(steps.find(step => step.round === 1 && step.name.includes('AI审核')).step_status, 'cancelled');
  assert.equal(model.readAll().project.episodes[0].shot_list.shots[0].seconds_storyboard.end_state, '门已打开。');
}, ({ task, step }) => {
  if (task.business_type !== 'seconds') return;
  if (step.kind === 'review') return { 是否通过: step.round !== 0, "类型": (step.round !== 0) ? "" : "模型问题", 原因: step.round === 0 ? '结束状态必须明确门已打开' : '' };
  return { end_state: step.round === 0 ? '门仍关闭。' : '门已打开。', pending_actions: '', pending_dialogue: '', continuing_audio: '',
    storyboard: [beat(step.round === 1 ? '0–11s' : '0–5s')] };
}));

test('程序审核重复无进展提前结束且保留旧内容，保留旧成功hash与下游', () => withRuntime(async ({ p, model, command, calls }) => {
  const before = model.readAll().project.episodes[0].shot_list.shots[0];
  const task = await command('seconds', 'regenerate');
  assert.equal(task.task_status, 'rejected');
  const after = model.readAll().project.episodes[0].shot_list.shots[0];
  assert.deepEqual(after.seconds_storyboard.storyboard, before.seconds_storyboard.storyboard);
  assert.match(task.end_reason, /修订无进展/);
  assert.equal(after.seconds_storyboard.node_state.dependency_hash, before.seconds_storyboard.node_state.dependency_hash);
  assert.deepEqual(after.text_to_video_prompt, before.text_to_video_prompt);
  assert.equal(calls.filter(call => call.task.business_type === 'seconds').length, 2);
}, ({ task }) => task.business_type === 'seconds' ? { end_state: "人物位于镜末位置，动作已完成。", pending_actions: "", pending_dialogue: "", continuing_audio: "", storyboard: [beat('0–11s')] } : undefined));

test('episode-seconds 逐镜安排识别后每秒', () => withRuntime(async ({ runtime, p, model, calls }) => {
  const group = await runtime.tasks.command({ type: 'submit-group', project_id: p.id, request_id: 'group', group_type: 'episode-seconds', action: 'regenerate', episode_id: p.episodes[0].id });
  await runtime.tasks.idle(p.id);
  const tasks = model.readAll().tasks.filter(task => task.group_id === group.group_id);
  assert.deepEqual(tasks.map(task => task.business_type), ['seconds', 'seconds']);
  assert.ok(tasks.every(task => task.task_status === 'completed'), tasks.map(task => task.end_reason).join(';'));
  assert.equal(calls.filter(call => call.task.business_type === 'shot-characters' && call.step.kind === 'generate').length, 0);
  const seconds = calls.filter(call => call.task.business_type === 'seconds' && call.step.kind === 'generate');
  assert.equal(seconds[0].trace.input.previous, null);
  const savedFirst = model.readAll().project.episodes[0].shot_list.shots[0].seconds_storyboard;
  assert.equal(seconds[1].trace.input.previous.end_state, savedFirst.end_state);
  assert.deepEqual(seconds[1].trace.input.previous.last_beats, savedFirst.storyboard);
  const firstReview = calls.findIndex(call => call.task.business_type === 'seconds' && call.task.target_id === p.episodes[0].shot_list.shots[0].id && call.step.kind === 'review');
  assert.ok(firstReview < calls.indexOf(seconds[1]));
}));

test('每秒输入与hash共用镜头表出镜和群演，图片不影响文本', () => {
  const p = fixtureProject(), episode = p.episodes[0], shot = episode.shot_list.shots[0], person = p.character_library.characters[0];
  shot.on_screen_characters = [{ character_id: person.id, costume_id: person.costumes[0].id }];
  const snapshot = { project: p, tasks: [], steps: [] };
  const before = dependencyHash(snapshot, 'seconds', shot.id);
  person.costume_images[0].address = 'new.png';
  assert.equal(dependencyHash(snapshot, 'seconds', shot.id), before);
  const input = taskNodeInput(snapshot, { business_type: 'seconds', target_id: shot.id }, null, 'generate');
  assert.equal(input.shot.on_screen_characters[0].character_id, person.id);
  assert.doesNotMatch(JSON.stringify(input), /costume_images|new.png/);
  shot.background_characters = '几名不具名社员点头';
  assert.notEqual(dependencyHash(snapshot, 'seconds', shot.id), before);
});

test('每秒生成取消后晚到结果不覆盖；继续使用新任务', async () => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let wait = true;
  await withRuntime(async ({ runtime, p, model }) => {
    const group = await runtime.tasks.command({ type: 'submit-group', project_id: p.id, request_id: 'cancel-group', group_type: 'episode-seconds', action: 'regenerate', episode_id: p.episodes[0].id });
    await started;
    const oldId = model.readAll().tasks.find(task => task.task_status === 'running').id;
    await runtime.tasks.command({ type: 'cancel', project_id: p.id, request_id: 'cancel', task_id: oldId });
    wait = false; release(); await runtime.tasks.idle(p.id);
    assert.equal(model.readAll().tasks.find(task => task.id === oldId).task_status, 'cancelled');
    const old = model.readAll().tasks.find(task => task.id === oldId);
    const resumed = await runtime.tasks.command({ type: 'continue-group', project_id: p.id, request_id: 'resume', group_id: group.group_id });
    await runtime.tasks.idle(p.id);
    assert.deepEqual(model.readAll().tasks.find(task => task.id === oldId), old);
    assert.ok(model.readAll().tasks.filter(task => task.group_id === resumed.group_id).every(task => task.task_status === 'completed'));
  }, async ({ task, step }) => { if (wait && task.business_type === 'seconds' && step.kind === 'generate') { entered(); await gate; } });
});

test('v14 新库为空；v8 明确拒绝且不修改项目、不生成迁移备份', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meiji-fresh-'));
  try {
    const repo = new ModelRepository(root);
    await repo.list();
    const path = join(root, 'meiji.sqlite');
    let db = new DatabaseSync(path);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 25);
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
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 25);
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
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 25);
    assert.equal(Object.hasOwn(opened, 'output_language'), false);
    assert.equal(openedShot.seconds_storyboard.storyboard[0].action, body);
    assert.equal(openedShot.seconds_storyboard.node_state.status, 'expired');
    assert.equal(openedShot.seconds_storyboard.end_state, '');
    assert.equal(openedShot.seconds_storyboard.node_state.dependency_hash, dependencyHash({ project: opened, tasks: [], steps: [] }, 'seconds', shot.id));
    db.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('镜头详情只读展示镜头表出镜，无独立识别节点', () => {
  const dom = new JSDOM('<main></main>'), previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const snapshot = snapshotFixture(), episode = snapshot.project.episodes[0], shot = episode.shot_list.shots[0];
    const root = document.querySelector('main');
    const context = { session_id: 'test', view: { page: 'episode', episode_id: episode.id, shot_id: shot.id, tab: 'film' }, refresh: async () => {}, paint: () => {}, onError: () => {} };
    shot.on_screen_characters = [];
    renderTaskPanel(root, snapshot, context);
    assert.equal(root.querySelector('[data-business="shot-characters"]'), null);
    renderTaskPanel(root, snapshot, context);
    assert.match(root.textContent, /无卡内人物及群演/);
    const titles = [...root.querySelectorAll('h3')].map(node => node.textContent);
    assert.equal(titles.includes('镜头角色与服装'), false);
    assert.ok(titles.includes('每秒分镜'));
    shot.seconds_storyboard.storyboard.push({ ...shot.seconds_storyboard.storyboard[0], time_range: '5–6s', action: '下一秒', dialogue: [{ speaker_name: '武松', mode: '画内', dialogue_text: '走' }] });
    renderTaskPanel(root, snapshot, context);
    const beats = [...root.querySelectorAll('[data-business=seconds] .seconds-beat')];
    assert.equal(beats.length, 2);
    assert.deepEqual([...beats[0].querySelectorAll('p')].map(node => node.textContent), ['时段：0–5s', '动作：动作', '镜头：镜头', '空间：空间', '声音：声音', '交接：结束']);
    assert.deepEqual([...beats[1].querySelectorAll('p')].map(node => node.textContent), ['时段：5–6s', '动作：下一秒', '镜头：镜头', '空间：空间', '声音：声音', '交接：结束', '说话人：武松', '方式：画内', '原话：走']);
    assert.equal(root.querySelector('[data-business=seconds] .seconds-summary p').textContent, '结尾状态：人物站在原位，动作已结束，持物保持不变。');
  } finally { globalThis.document = previous; dom.window.close(); }
});

test('未知说话人ID反馈精确节拍、错误值及同名目录ID，拒绝而不自动纠正', async () => {
  const { prepareContent } = await import('../server/handlers/content.js');
  const p = fixtureProject(), shot = p.episodes[0].shot_list.shots[0], person = p.character_library.characters[0];
  const raw = structuredClone(shot.seconds_storyboard);
  delete raw.node_state;
  const bad = `${person.id}-wrong-costume-suffix`;
  raw.storyboard[0].dialogue = [{ speaker_id: bad, speaker_name: person.name, mode: '画内', dialogue_text: '测试对白' }];
  const saved = structuredClone(raw);
  const task = { business_type: 'seconds', target_id: shot.id };
  assert.throws(() => prepareContent({ project: p }, task, raw), error => {
    assert.equal(error.code, 'INVALID_CONTRACT');
    for (const text of ['storyboard[0].dialogue[0]', raw.storyboard[0].time_range, bad, `${person.name}=${person.id}`]) assert.ok(error.message.includes(text), text);
    return true;
  });
  assert.deepEqual(raw, saved);
  raw.storyboard[0].dialogue[0].speaker_id = person.id;
  assert.doesNotThrow(() => prepareContent({ project: p }, task, raw));
});
