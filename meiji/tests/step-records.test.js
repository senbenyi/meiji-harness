import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JSDOM } from "jsdom";
import { ModelRepository } from "../server/data/model-repository.js";
import { groupDetailRecords, activityGroups, lightStep } from "../server/data/task-store.js";
import { stepExecutor } from "../shared/task-plan.js";
import { renderHistory } from "../client/history-ui.js";
import { projectFixture, snapshotFixture } from "./fixtures/project.js";
import { seedQueuedTasks } from "./fixtures/queued-tasks.js";

describe("step-records", () => {
  const image = 'data:image/png;base64,' + 'A'.repeat(400);

  test('步骤按类型与节点确定执行方式：调用模型为AI，其余为程序', () => {
    const text = { business_type: 'outline' }, media = { business_type: 'video' }, program = { business_type: 'multimodal' };
    assert.equal(stepExecutor(text, 'precheck'), 'program');
    assert.equal(stepExecutor(text, 'generate'), 'ai');
    assert.equal(stepExecutor(text, 'revise'), 'ai');
    assert.equal(stepExecutor(text, 'review', 'program'), 'program');
    assert.equal(stepExecutor(text, 'review', 'ai'), 'ai');
    assert.equal(stepExecutor(media, 'generate'), 'ai');
    assert.equal(stepExecutor(media, 'apply'), 'program');
    assert.equal(stepExecutor(program, 'generate'), 'program');
    assert.equal(stepExecutor({ business_type: 'assembly' }, 'generate'), 'program');
    assert.equal(stepExecutor(text, 'manual_edit'), 'program');
  });

  test('v22迁移：旧记录拆出HTTP、去掉重复提示词、脱敏参考图并补执行方式', async () => {
    const home = await mkdtemp(join(tmpdir(), 'meiji-steps-'));
    try {
      let repo = new ModelRepository(home); const p = projectFixture(); const model = await repo.create(p);
      await seedQueuedTasks(model, [['project-summary', p.id]]);
      const steps = model.read().steps, generate = steps.find(step => step.kind === 'generate'), precheck = steps.find(step => step.kind === 'precheck');
      await repo.close();
      const legacy = { node: 'project-summary', action: 'generate', model: 'qwen3.5:27b', system: '系统规则', user: '用户任务', body: '系统规则\n\n用户任务',
        messages: [{ role: 'system', content: '系统规则' }, { role: 'user', content: '用户任务' }], input: { references: [image] },
        transfers: [{ fn: 'chat', request: { body: '请求' }, status: 200 }] };
      let db = new DatabaseSync(join(home, 'meiji.sqlite'));
      db.prepare("UPDATE task_steps SET prompt_json=?, executor='program', http_json='[]' WHERE id=?").run(JSON.stringify(legacy), generate.id);
      db.prepare("UPDATE task_steps SET prompt_json='{}' WHERE id=?").run(precheck.id);
      db.exec('DELETE FROM schema_migrations WHERE version=22; PRAGMA user_version=21'); db.close();
      repo = new ModelRepository(home);
      await repo.open(p.id); const migrated = repo.history(p.id).group(model.read().groups[0].id, { records: true }).steps, g = migrated.find(step => step.id === generate.id), c = migrated.find(step => step.id === precheck.id);
      assert.equal(g.executor, 'ai'); assert.equal(c.executor, 'program');
      assert.deepEqual(g.http, legacy.transfers);
      assert.deepEqual(g.prompt.messages, legacy.messages);
      for (const key of ['system', 'user', 'body', 'transfers']) assert.equal(Object.hasOwn(g.prompt, key), false, key);
      assert.doesNotMatch(JSON.stringify(g.prompt.input), /AAAA/); assert.match(JSON.stringify(g.prompt.input), /base64 数据/);
      assert.equal(c.prompt, null); assert.deepEqual(c.http, []);
      await repo.close();
      db = new DatabaseSync(join(home, 'meiji.sqlite'));
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 25); db.close();
    } finally { await rm(home, { recursive: true, force: true }); }
  });

  test('按组读取只返回本组步骤记录；面板步骤与推送只带标记；记录走独立事件', async () => {
    const home = await mkdtemp(join(tmpdir(), 'meiji-records-'));
    try {
      const repo = new ModelRepository(home); const p = projectFixture(); const model = await repo.create(p);
      await seedQueuedTasks(model, [['project-summary', p.id], ['episode-summary', p.episodes[0].id]]);
      const s = model.read(), [first, second] = s.tasks, step = s.steps.find(row => row.task_id === first.id && row.kind === 'generate');
      await model.update(crypto.randomUUID(), {}, x => { Object.assign(x.tasks.find(row=>row.id===first.id), {task_status:'running',started_at:new Date().toISOString()}); Object.assign(x.steps.find(row => row.id === step.id), { step_status: 'running' }); });
      await repo.writeStepRecord(p.id,{step_id:step.id,task_id:first.id,group_id:first.group_id},{prompt:{node:'project-summary',messages:[{role:'user',content:'提示'}]},http:[]});
      const records = groupDetailRecords(repo.history(p.id), new Map(), first.group_id, p, model.read().runtime.revision);
      assert.equal(records.group.id, first.group_id);
      assert.deepEqual(records.steps.map(row => row.id).sort(), s.steps.filter(row => row.task_id === first.id).map(row => row.id).sort());
      assert.ok(!records.steps.some(row => s.steps.find(x => x.id === row.id).task_id === second.id));
      assert.equal(records.steps.find(row => row.id === step.id).prompt.messages[0].content, '提示');
      assert.equal(groupDetailRecords(repo.history(p.id), new Map(), 'tg_missing', p, 0), null);
      const light = lightStep({ ...step, prompt: { messages: [] }, http: [{}] });
      assert.equal(Object.hasOwn(light, 'prompt'), false); assert.equal(Object.hasOwn(light, 'http'), false);
      assert.equal(light.has_prompt, true); assert.equal(light.has_http, true);
      const before = model.read(), events = [];
      repo.on('change', event => events.push(event));
      await repo.writeStepRecord(p.id,{step_id:step.id,task_id:first.id,group_id:first.group_id},{http:[{fn:'chat',request:{}}]});
      assert.deepEqual(model.read(), before, '记录不改工作快照、版本与幂等结果');
      assert.equal(events.at(-1).record.group_id,first.group_id);
      assert.equal(events.at(-1).record.has_http,true);
      assert.deepEqual(activityGroups(before, structuredClone(before)), []);
      await repo.close();
    } finally { await rm(home, { recursive: true, force: true }); }
  });

  test('任务组详情打开时按组读取一次；运行中版本前进时重新读取；切换查看不再请求', async () => {
    const dom = new JSDOM('<main></main>'), previous = { document: globalThis.document, fetch: globalThis.fetch };
    globalThis.document = dom.window.document;
    const calls = [];
    globalThis.fetch = async url => { calls.push(String(url)); return { ok: true, json: async () => ({ group: {id:'g',group_type:'single',source:'panel'}, tasks:[{id:'t',group_id:'g',group_seq:1,business_type:'outline',task_status:'running',queue_order:1,source:'panel'}], revision: 5, steps: [{ id: 's',task_id:'t',seq:1,kind:'generate',executor:'ai',step_status:'running', prompt: { messages: [{ role: 'user', content: '提示正文' }] }, http: [{ method: 'POST', path: '/chat', request: { body: '请求' } }] }] }) }; };
    try {
      const s = snapshotFixture(), root = document.querySelector('main'), state = { page: 'history', task_id: 't' };
      s.runtime = { ...(s.runtime || {}), revision: 5 };
      s.tasks = [{ id: 't', group_id: 'g', group_seq: 1, business_type: 'outline', task_status: 'running', queue_order: 1, source: 'panel' }];
      s.groups = [{ id: 'g', group_type: 'single', source: 'panel' }];
      s.steps = [{ id: 's', task_id: 't', seq: 1, kind: 'generate', step_status: 'running', executor: 'ai', has_prompt: true, has_http: true, result: null }];
      const env = { p: s.project, state, session_id: 'sid', names: { outline: '分集改编' }, go: (page, v) => { Object.assign(state, { page }, v); paint(); }, act: () => {},
        button: (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => fn(); return b; } };
      const paint = () => { root.replaceChildren(); renderHistory(root, env, s); };
      paint();
      assert.equal(calls.length, 1); assert.match(calls[0], /group\?session_id=sid&group_id=g/);
      await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(root.querySelector('.run-step-executor').textContent, 'AI');
      root.querySelector('.run-record-link').click();
      assert.equal(state.step_view, 'prompt'); assert.match(root.textContent, /提示正文/);
      state.step_view = 'http'; paint(); assert.match(root.querySelector('.run-record-page').textContent, /"body": "请求"/);
      assert.equal(calls.length, 1, '切换查看使用已读取的组记录');
      s.runtime.revision = 6; paint();
      assert.equal(calls.length, 2, '运行中版本前进后重新读取');
      await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(calls.length, 2, '读取完成后版本一致，不重复读取');
    } finally { globalThis.document = previous.document; globalThis.fetch = previous.fetch; dom.window.close(); }
  });

  test('v24迁移按列名复制旧追加列顺序，保留步骤内容与位置', async () => {
    const home=await mkdtemp(join(tmpdir(),'meiji-v24-columns-'));
    let repo;
    try {
      repo=new ModelRepository(home);const p=projectFixture();const model=await repo.create(p);
      await seedQueuedTasks(model,[['project-summary',p.id]]);
      await repo.close();repo=null;
      const db=new DatabaseSync(join(home,'meiji.sqlite'));
      const before=db.prepare('SELECT * FROM task_steps ORDER BY position').all();
      const names=db.prepare('PRAGMA table_info(task_steps)').all().map(c=>c.name);
      const legacy=[...names.filter(n=>!['executor','http_json'].includes(n)),'executor','http_json'].join(',');
      db.exec(`CREATE TABLE legacy_steps AS SELECT ${legacy} FROM task_steps; DROP TABLE task_steps; ALTER TABLE legacy_steps RENAME TO task_steps; PRAGMA user_version=23;`);
      db.close();
      repo=new ModelRepository(home);await repo.open(p.id);await repo.close();repo=null;
      const migrated=new DatabaseSync(join(home,'meiji.sqlite'));
      assert.equal(migrated.prepare('PRAGMA user_version').get().user_version,25);
      const after=migrated.prepare('SELECT * FROM task_steps ORDER BY position').all();
      assert.deepEqual(after,before);
      migrated.close();
    } finally {await repo?.close();await rm(home,{recursive:true,force:true});}
  });
});
