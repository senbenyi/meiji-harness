import { assertProgramReview } from "../shared/node-state.js";
import { seedQueuedTasks } from "./fixtures/queued-tasks.js";
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { JSDOM } from "jsdom";
import { snapshotFixture, taskFixture } from "./fixtures/project.js";
import { createId } from "../shared/task_contract.js";
import { emptyStoryboardBeatModel } from "../shared/models/storyboard_beat_model.js";
import { shotTextInputs, previousSeconds } from "../shared/shot-text-inputs.js";
import { dependencyHash, stampDependencyHash, isNodeCurrent, expireDownstream } from "../shared/node-dependencies.js";
import { taskNodeInput } from "../server/handlers/node-inputs.js";
import { composeNodePrompt, validateNodeResult } from "../server/http/ai-routes.js";
import { precheck } from "../server/flow/tasks/precheck.js";
import { ModelRepository } from "../server/data/model-repository.js";
import { migrateSecondsContinuity } from "../server/data/seconds-continuity-migration.js";
import { SQLiteStore } from "../server/data/sqlite-store.js";
import { fieldsForm, readable } from "../client/content-forms.js";
import { assertPromptDialogue } from "../shared/dialogue-integrity.js";
import route from "../server/http/nodes/storyboard.js";

describe("seconds-continuity", () => {
  function chain() {
    const s = snapshotFixture(), e = s.project.episodes[0], [first, second] = e.shot_list.shots;
    const third = structuredClone(second);
    Object.assign(third, { id: createId('shot'), number: 'S03', sequence: 3 });
    e.shot_list.shots.push(third);
    first.seconds_storyboard.storyboard = Array.from({ length: 5 }, (_, i) => ({ ...emptyStoryboardBeatModel(),
      time_range: `${i}–${i + 1}s`, action: `完整动作${i}`, audio: '雨声持续',
      dialogue: [{ speaker_id: '', speaker_name: '旁白', mode: '画外', dialogue_text: `台词${i}` }],
    }));
    Object.assign(first.seconds_storyboard, { end_state: '甲右手扶门，身体尚未跨入。', pending_actions: '尚未跨过门槛', pending_dialogue: '', continuing_audio: '屋外雨声持续' });
    for (const shot of e.shot_list.shots) for (const business of ['seconds', 'storyboard', 'first-last-frame', 'multimodal', 'video', 'tail']) stampDependencyHash(s, business, shot.id);
    stampDependencyHash(s, 'assembly', e.id);
    return { s, e, first, second, third };
  }

  test('首镜无前镜；后镜直接读取镜末字段与末尾三秒完整节拍，不二次摘要', () => {
    const { s, e, first, second } = chain();
    assert.equal(previousSeconds(e, first), null);
    const previous = shotTextInputs(s.project, e, second, 'seconds').previous;
    assert.equal(previous.shot_number, first.number);
    assert.equal(previous.end_state, first.seconds_storyboard.end_state);
    assert.deepEqual(previous.last_beats.map(beat => beat.action), ['完整动作2', '完整动作3', '完整动作4']);
    assert.equal(previous.last_beats.at(-1).dialogue[0].dialogue_text, '台词4');
    previous.last_beats[0].action = '调用方修改';
    assert.equal(first.seconds_storyboard.storyboard[2].action, '完整动作2');
    // 跨越末尾窗口的长节拍保留全文，不裁切对白或动作。
    first.seconds_storyboard.storyboard = [{ ...emptyStoryboardBeatModel(), time_range: '0–5s', action: '连续完整长动作' }];
    assert.equal(previousSeconds(e, second).last_beats[0].time_range, '0–5s');
    // 变长节拍：与末尾3秒相交的整拍进入交接，恰好止于窗口起点的节拍不进入。
    first.seconds_storyboard.storyboard = ['0–2s', '2–4s', '4–5s'].map(time_range => ({ ...emptyStoryboardBeatModel(), time_range, action: `节拍${time_range}` }));
    assert.deepEqual(previousSeconds(e, second).last_beats.map(beat => beat.time_range), ['2–4s', '4–5s']);
    first.seconds_storyboard.storyboard = ['0–1s', '1–3s', '3–5s'].map(time_range => ({ ...emptyStoryboardBeatModel(), time_range, action: `节拍${time_range}` }));
    assert.deepEqual(previousSeconds(e, second).last_beats.map(beat => beat.action), ['节拍1–3s', '节拍3–5s']);
  });

  test('生成/审核的前镜资料在user；修订assistant只含本镜候选，明确换场按本镜剧情选择继承', () => {
    const { s, e, first, second } = chain();
    second.continuity_transition = '切到次日室外，不延续前镜室内动作';
    const task = taskFixture(s.project, 'seconds', second.id, { opinion: '保持本镜开场' });
    const content = { ...second.seconds_storyboard }; delete content.node_state; delete content.rules;
    for (const action of ['generate', 'review', 'regenerate']) {
      const input = taskNodeInput(s, task, content, action);
      const prompt = composeNodePrompt('seconds', action, input, 'qwen3.5:27b');
      assert.match(prompt.messages[1].content, /甲右手扶门/);
      assert.match(prompt.messages[1].content, /切到次日室外/);
      assert.match(prompt.system, /明确换场或时间省略/);
      if (action === 'regenerate') {
        assert.deepEqual(JSON.parse(prompt.messages[2].content), content);
        assert.doesNotMatch(prompt.messages[2].content, /甲右手扶门/);
        assert.match(prompt.messages[3].content, /保持本镜开场/);
      }
      if (action === 'review') assert.match(prompt.system, /核对本镜末段与顶层结束状态/);
    }
    const downstream = shotTextInputs(s.project, e, first, 'storyboard');
    assert.equal(downstream.storyboard.end_state, first.seconds_storyboard.end_state);
    assert.equal(downstream.storyboard.continuing_audio, '屋外雨声持续');
  });

  for (const status of ['empty', 'rejected', 'expired', 'failed', 'running']) test(`前镜${status}时单独执行后镜被阻断`, () => {
    const { s, first, second } = chain();
    Object.assign(first.seconds_storyboard.node_state, { status, reason: ['rejected', 'expired'].includes(status) ? '原因' : '', fail_message: status === 'failed' ? '失败' : '' });
    assert.throws(() => precheck(s, taskFixture(s.project, 'seconds', second.id)), /前镜 S01 每秒分镜尚未有效生成/);
    assert.equal(isNodeCurrent(s, 'seconds', second.id), false);
  });

  test('前镜交接缺失或依赖不再有效时阻断；首镜正常执行', () => {
    const { s, first, second } = chain();
    assert.equal(precheck(s, taskFixture(s.project, 'seconds', first.id)).passed, true);
    first.seconds_storyboard.end_state = '';
    assert.throws(() => precheck(s, taskFixture(s.project, 'seconds', second.id)), /结束状态/);
    first.seconds_storyboard.end_state = '恢复状态';
    first.seconds_storyboard.node_state.dependency_hash = 'a'.repeat(64);
    assert.throws(() => precheck(s, taskFixture(s.project, 'seconds', second.id)), /依赖已过期/);
  });

  test('前镜非末尾改动不使后镜过期；交接改变传播到连续后镜、视频和排队快照', () => {
    const { s, first, second, third } = chain();
    const before = dependencyHash(s, 'seconds', second.id);
    first.seconds_storyboard.storyboard[0].action = '仅前半段调整';
    assert.equal(dependencyHash(s, 'seconds', second.id), before);
    expireDownstream(s, 'seconds', first.id);
    assert.equal(second.seconds_storyboard.node_state.status, 'generated');
    const queued = taskFixture(s.project, 'seconds', third.id);
    s.tasks.push(queued);
    first.seconds_storyboard.pending_actions = '右手松门后才能跨入';
    assert.notEqual(dependencyHash(s, 'seconds', second.id), before);
    expireDownstream(s, 'seconds', first.id);
    for (const shot of [second, third]) {
      assert.equal(shot.seconds_storyboard.node_state.status, 'expired');
      assert.equal(shot.text_to_video_prompt.node_state.status, 'expired');
      assert.equal(shot.video.node_state.status, 'expired');
    }
    assert.equal(queued.previous_node_state.status, 'expired');
    assert.equal(third.seconds_storyboard.storyboard[0].action, '动作');
  });

  test('节点接口拒绝空前镜资料与缺失结束状态，表单和只读展示保留完整交接字段', () => {
    const { s, second } = chain(), task = taskFixture(s.project, 'seconds', second.id);
    const input = taskNodeInput(s, task, null, 'generate');
    assert.throws(() => composeNodePrompt('seconds', 'generate', { ...input, previous: {} }, 'qwen3.5:27b'), /输入.previous/);
    const content = { ...second.seconds_storyboard }; delete content.node_state; delete content.rules;
    assert.throws(() => validateNodeResult('seconds', 'generate', { ...content, end_state: '' }, input), /结束状态不能为空/);
    const dom = new JSDOM('<main></main>'), old = globalThis.document;
    globalThis.document = dom.window.document;
    try {
      const form = fieldsForm(content);
      document.querySelector('main').append(form.box);
      assert.equal(form.box.querySelector('[aria-label="结尾状态"]').value, content.end_state);
      form.box.querySelector('[aria-label="未完成动作"]').value = '动作仍持续';
      assert.equal(form.read().pending_actions, '动作仍持续');
      assert.match(readable(content), /结尾状态/);
    } finally { globalThis.document = old; dom.window.close(); }
  });

  test('v12迁移保留正文/历史/任务终态，过期节点与排队快照且只执行一次', async () => {
    const home = await mkdtemp(join(tmpdir(), 'meiji-continuity-migrate-'));
    try {
      const repo = new ModelRepository(home), { s } = chain(), p = s.project;
      const model = await repo.create(p);
      await seedQueuedTasks(model, p.episodes[0].shot_list.shots.map(shot => ['seconds',shot.id]));
      await repo.close();
      const path = join(home, 'meiji.sqlite');
      let db = new DatabaseSync(path);
      const stored = JSON.parse(db.prepare('SELECT data_json FROM projects').get().data_json);
      for (const shot of stored.episodes[0].shot_list.shots) for (const key of ['end_state', 'pending_actions', 'pending_dialogue', 'continuing_audio']) delete shot.seconds_storyboard[key];
      db.prepare('UPDATE projects SET data_json=?').run(JSON.stringify(stored));
      db.exec('ALTER TABLE projects ADD COLUMN queue_stopped INTEGER NOT NULL DEFAULT 0 CHECK(queue_stopped IN (0,1)); DELETE FROM schema_migrations WHERE version>=13; PRAGMA user_version=12');
      const steps = db.prepare('SELECT * FROM task_steps').all();
      const tasks = db.prepare('SELECT id,task_status FROM tasks').all();
      db.close();
      let store = new SQLiteStore(path);
      const migrated = store.read(p.id); store.close();
      const shots = migrated.project.episodes[0].shot_list.shots;
      for (const [i, shot] of shots.entries()) {
        assert.deepEqual(shot.seconds_storyboard.storyboard, stored.episodes[0].shot_list.shots[i].seconds_storyboard.storyboard);
        assert.equal(shot.seconds_storyboard.end_state, '');
        assert.equal(shot.seconds_storyboard.node_state.status, 'expired');
        assert.equal(shot.video.node_state.status, 'expired');
      }
      assert.ok(migrated.tasks.filter(task => task.business_type === 'seconds').every(task => task.previous_node_state.status === 'expired'));
      db = new DatabaseSync(path);
      assert.deepEqual(db.prepare('SELECT * FROM task_steps').all(), steps);
      assert.deepEqual(db.prepare('SELECT id,task_status FROM tasks').all(), tasks);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 28);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      db.close();
      store = new SQLiteStore(path);
      assert.deepEqual(store.read(p.id), migrated); store.close();
    } finally { await rm(home, { recursive: true, force: true }); }
  });

  test('v13迁移遇到非法项目完整回滚，不提交新增字段或版本号', async () => {
    const home = await mkdtemp(join(tmpdir(), 'meiji-continuity-rollback-'));
    try {
      const repo = new ModelRepository(home); await repo.create(snapshotFixture().project); await repo.close();
      const path = join(home, 'meiji.sqlite'); let db = new DatabaseSync(path);
      const project = JSON.parse(db.prepare('SELECT data_json FROM projects').get().data_json);
      project.unknown_field = true;
      db.prepare('UPDATE projects SET data_json=?').run(JSON.stringify(project));
      db.exec('ALTER TABLE projects ADD COLUMN queue_stopped INTEGER NOT NULL DEFAULT 0 CHECK(queue_stopped IN (0,1)); DELETE FROM schema_migrations WHERE version>=13; PRAGMA user_version=12');
      const before = db.prepare('SELECT * FROM projects').all(); db.close();
      assert.throws(() => new SQLiteStore(path), /unknown_field|未知|未定义/);
      db = new DatabaseSync(path);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 12);
      assert.deepEqual(db.prepare('SELECT * FROM projects').all(), before);
      assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations WHERE version=13').get().n, 0);
      db.close();
    } finally { await rm(home, { recursive: true, force: true }); }
  });


  test('迁移只调整排队快照，不改写已结束任务的历史快照', () => {
    const { s, first } = chain();
    const task = taskFixture(s.project, 'seconds', first.id, { task_status: 'completed' });
    s.tasks.push(task);
    const before = structuredClone(task);
    migrateSecondsContinuity(s);
    assert.deepEqual(task, before);
  });


  test('下镜前置定位前镜错误待续，修正为空或真实后续则通过',()=>{
    const {s,first,second}=chain();
    first.seconds_storyboard.pending_dialogue='旁白：“台词4”已说完却标为待续。';
    assert.throws(()=>precheck(s,taskFixture(s.project,'seconds',second.id)),/前镜 S01 交接资料.pending_dialogue/);
    first.seconds_storyboard.pending_dialogue='';
    assert.doesNotThrow(()=>precheck(s,taskFixture(s.project,'seconds',second.id)));
    first.seconds_storyboard.pending_dialogue='旁白后续原话：“明日再见。”';
    assert.doesNotThrow(()=>precheck(s,taskFixture(s.project,'seconds',second.id)));
  });


  test('错误待续在本镜程序审核拒绝，不等到下镜模型重演',()=>{
    const {s,first}=chain();
    first.seconds_storyboard.pending_dialogue='旁白：“台词4”还没说完。';
    assert.throws(()=>assertProgramReview(s.project,'seconds',first.id),/pending_dialogue.*已在本镜实际对白中说出/);
    first.seconds_storyboard.pending_dialogue='';
    assert.doesNotThrow(()=>assertProgramReview(s.project,'seconds',first.id));
  });
});

describe("dialogue-sentences", () => {
  const source = (...texts) => ({ storyboard: texts.map(dialogue_text => ({ dialogue: [{ speaker_id: 'a', mode: '画内', dialogue_text }] })) });
  const rejects = (node, text) => assert.throws(() => assertPromptDialogue(node, text), error => error.validationKind === 'dialogue-preservation' && /对白完整性/.test(error.message));

  test('一句不可按节拍、逗号、省略号、换气或自然段拆成两个标签', () => {
    for (const [first, second] of [['我还有', '话说。'], ['先停，', '再走。'], ['先停……', '再走。'], ['我——', '还有话说。']]) {
      const node = source(first, second);
      rejects(node, `<d>${first}</d>\n停顿，抬手。\n<d>${second}</d>`);
      assert.doesNotThrow(() => assertPromptDialogue(node, `<d>${first}${second}</d>`));
    }
  });

  test('同一人物连续多句可整体保留，也可在完整句子之间分开', () => {
    const node = source('别走。我还', '有话说！你听见了吗？');
    for (const text of ['<d>别走。我还有话说！你听见了吗？</d>', '<d>别走。</d>抬手。<d>我还有话说！</d>停顿。<d>你听见了吗？</d>'])
      assert.doesNotThrow(() => assertPromptDialogue(node, text));
    rejects(node, '<d>别走。我还有</d><d>话说！你听见了吗？</d>');
  });

  test('句末标点与闭引号不拆开', () => {
    const node = source('他说“走！”然后关门。');
    assert.doesNotThrow(() => assertPromptDialogue(node, '<d>他说“走！”</d><d>然后关门。</d>'));
    rejects(node, '<d>他说“走！</d><d>”然后关门。</d>');
  });

  test('小数、英文称谓和首字母缩写不作为拆句边界', () => {
    for (const [first, second] of [['数值为3.', '14。'], ['Dr. ', 'Smith is here.'], ['U.S. ', 'officials arrived.']])
      rejects(source(first, second), `<d>${first}</d><d>${second}</d>`);
    assert.doesNotThrow(() => assertPromptDialogue(source('Wait. Go!'), '<d>Wait.</d><d> Go!</d>'));
  });

  test('换人可保留被打断的原话，不能把同一人的跨拍字段当换人', () => {
    const node = { storyboard: [{ dialogue: [{ speaker_id: 'a', dialogue_text: '可是我' }, { speaker_id: 'b', dialogue_text: '别说了！' }] }] };
    assert.doesNotThrow(() => assertPromptDialogue(node, '(S1)<d>可是我</d>(S2)<d>别说了！</d>'));
    rejects(source('可是我', '别说了！'), '<d>可是我</d><d>别说了！</d>');
  });

  test('镜末未结束发言必须完整保留本镜部分，不拆碎、不擅自续写', () => {
    const node = source('我老友麦思敦君乎！余实不能伴汝。', '不但弹丸狭小而已，君已颓龄，难受辛苦，');
    assert.doesNotThrow(() => assertPromptDialogue(node, '<d>我老友麦思敦君乎！</d><d>余实不能伴汝。</d><d>不但弹丸狭小而已，君已颓龄，难受辛苦，</d>'));
    rejects(node, '<d>我老友</d><d>麦思敦君乎！余实不能伴汝。不但弹丸狭小而已，君已颓龄，难受辛苦，</d>');
    rejects(node, '<d>我老友麦思敦君乎！余实不能伴汝。不但弹丸狭小而已，君已颓龄，难受辛苦。</d>');
  });

  test('空标签不合法，完整原话的逐字校验继续生效', () => {
    for (const text of ['<d></d><d>别走。</d>', '<d>别走</d>', '<d>别走。别走。</d>']) rejects(source('别走。'), text);
  });

  test('HTTP生成修订均拦截碎片并标为可修订的对白错误', () => {
    for (const action of ['generate', 'regenerate']) {
      const input = { storyboard: source('我还有话说。') };
      const sections = text => `integrated_multimodal_description:\n[Shot 1] ${text}\noverall_soundscape:\nN/A\nnon_diegetic_music:\nN/A`;
      assert.throws(() => route.validateResult(sections('<d>我还有</d><d>话说。</d>'), input, action), error => error.validationKind === 'dialogue-preservation');
      assert.doesNotThrow(() => route.validateResult(sections('<d>我还有话说。</d>'), input, action));
    }
  });
});
