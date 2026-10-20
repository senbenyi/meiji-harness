import test, { describe } from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRepository } from "../server/data/model-repository.js";
import { taskDetail, groupDetail, historyContext } from "../server/data/task-store.js";
import { createId } from "../shared/task_contract.js";
import { emptyProject, emptyEpisode, emptyShot } from "../shared/project_contract.js";
import { createServer } from "node:http";
import { JSDOM } from "jsdom";
import { TaskService } from "../server/flow/tasks/task-manager.js";
import { taskNodeInput } from "../server/handlers/node-inputs.js";
import { commitContent } from "../server/handlers/content.js";
import { createTaskHttpHandler, panelSnapshot } from "../server/http/task-routes.js";
import { dependencyHash } from "../shared/node-dependencies.js";
import { newStep } from "../shared/task-plan.js";
import { createTaskGroupModel } from "../shared/models/task_group_model.js";
import { projectFixture, taskFixture } from "./fixtures/project.js";
import { PanelContext } from "../client/task-client.js";
import { loadLatestRecords } from "../client/task-records.js";
import { renderHistory } from "../client/history-ui.js";

describe("storage", () => {
  // 已结束的任务组只在数据库：测试经 readAll 合并历史后查询。
  const full = model => ({ read: () => model.readAll() });

  function fixture() {
    const p = emptyProject({ basic_info: { name: "存储测试" } }),
      e = emptyEpisode();
    e.shot_list.shots = [emptyShot()];
    p.episodes = [e];
    return p;
  }
  function task(p, fields = {}) {
    return {
      id: createId("task"),
      project_id: p.basic_info.id,
      episode_id: p.episodes[0].id,
      business_type: "seconds",
      target_id: p.episodes[0].shot_list.shots[0].id,
      action: "generate",
      group_id: null,
      group_seq: null,
      task_status: "queued",
      source: "panel",
      queue_order: 1,
      end_reason: "",
      created_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
      opinion: "",
      previous_node_state: { status: "empty", reason: "" },
      ...fields,
    };
  }
  function step(t, seq = 1) {
    return {
      id: createId("step"),
      task_id: t.id,
      seq,
      kind: seq === 1 ? "precheck" : "generate",
      round: 0,
      step_status: "ready",
      executor: seq === 1 ? "program" : "ai",
      error_reason: "",
      prompt: null,
      http: [],
      result: null,
      started_at: null,
      ended_at: null,
    };
  }
  async function withStore(work) {
    const root = await mkdtemp(join(tmpdir(), "meiji-storage-"));
    try {
      await work(root, new ModelRepository(root));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  test("项目、独立 task/step/group 重载一致，查询按顺序，组状态不落盘", () =>
    withStore(async (root, repo) => {
      const p = fixture(),
        model = await repo.create(p);
      assert.equal(await repo.open(p.basic_info.id), model);
      assert.equal(model.publish, undefined);
      const g = {
        id: createId("group"),
        project_id: p.basic_info.id,
        episode_id: p.episodes[0].id,
        group_type: "episode-seconds",
        source: "panel",
        created_at: new Date().toISOString(),
        shot_ids: [p.episodes[0].shot_list.shots[0].id],
        action: "generate",
      };
      const a = task(p, { group_id: g.id, group_seq: 1 }),
        b = task(p, { group_id: g.id, group_seq: 2, queue_order: 2 });

      await model.update("create-group", { group: g.id }, (s) => {
        s.tasks = [b, a];
        s.steps = [step(a, 2), step(a, 1)];
        s.groups = [g];
        return { group_id: g.id };
      });
      assert.deepEqual(
        groupDetail(full(model), g.id).tasks.map((t) => t.id),
        [a.id, b.id],
      );
      assert.deepEqual(
        taskDetail(full(model), a.id).steps.map((s) => s.seq),
        [1, 2],
      );
      assert.equal(groupDetail(full(model), g.id).status, "queued");
      const restored = await new ModelRepository(root).open(p.basic_info.id);
      assert.deepEqual(restored.readAll(), model.readAll());
      assert.ok(!("steps" in restored.readAll().tasks[0]));
      assert.ok(!("status" in restored.readAll().groups[0]));
      const db = new DatabaseSync(join(root, "meiji.sqlite"));
      assert.equal(db.prepare("SELECT revision FROM projects WHERE id=?").get(p.basic_info.id).revision, 2);
      assert.equal(db.prepare("SELECT count(*) AS n FROM task_groups").get().n, 1);
      db.close();
      const view = restored.readAll();
      view.project.basic_info.name = "外部修改";
      assert.equal(restored.readAll().project.basic_info.name, "存储测试");
    }));

  test("并发、幂等和不同项目隔离，无覆盖丢失；同键不同输入拒绝", () =>
    withStore(async (root, repo) => {
      const p = fixture(),
        q = fixture(),
        model = await repo.create(p),
        other = await repo.create(q);
      let calls = 0;
      const same = () =>
        model.update("same", { n: 1 }, (s) => {
          calls++;
          s.project.basic_info.reference_episode_duration_seconds++;
          return { value: s.project.basic_info.reference_episode_duration_seconds };
        });
      const [a, b] = await Promise.all([same(), same()]);
      assert.deepEqual(a, b);
      assert.equal(calls, 1);
      await assert.rejects(
        model.update("same", { n: 2 }, () => {}),
        { code: "IDEMPOTENCY_CONFLICT" },
      );
      await Promise.all(
        Array.from({ length: 8 }, (_, n) =>
          model.update(`add-${n}`, { n }, (s) => {
            s.project.basic_info.reference_episode_duration_seconds++;
            return {};
          }),
        ).concat(
          other.update("other", {}, (s) => {
            s.project.basic_info.name = "独立项目";
            return {};
          }),
        ),
      );
      assert.equal(model.readAll().project.basic_info.reference_episode_duration_seconds, 159);
      assert.equal(other.readAll().project.basic_info.reference_episode_duration_seconds, 150);
      assert.equal(other.readAll().project.basic_info.name, "独立项目");
      const fresh = await new ModelRepository(root).open(p.basic_info.id);
      assert.equal(fresh.readAll().project.basic_info.reference_episode_duration_seconds, 159);
    }));

  test("非法路径、符号链接、跨项目步骤及旧格式拒绝，不改合法数据", () =>
    withStore(async (root, repo) => {
      const p = fixture(),
        model = await repo.create(p),
        before = model.readAll();
      await assert.rejects(repo.open("../escape"), /UUID/);
      await assert.rejects(
        model.update("bad-step", {}, (s) => {
          s.steps = [step(task(fixture()))];
          return {};
        }),
        /任务不存在/,
      );
      assert.deepEqual(model.readAll(), before);
      const legacy = createId("project");
      await mkdir(join(root, legacy));
      await assert.rejects(repo.open(legacy), { code: "UNSUPPORTED_PROJECT" });
      const linked = createId("project");
      await symlink(join(root, p.basic_info.id), join(root, linked));
      await assert.rejects(repo.open(linked), { code: "INVALID_STORAGE" });
    }));

  test("Model 写入后事件与重载一致，订阅错误不影响提交", () =>
    withStore(async (root, repo) => {
      const model = await repo.create(fixture()),
        events = [];
      repo.on("change", () => {
        throw new Error("UI 错误");
      });
      repo.on("change", (event) =>
        events.push({ event, project: model.readAll().project }),
      );
      const result = await model.update("edit", {}, (s) => {
        s.project.basic_info.name = "已保存";
        return {};
      });
      assert.equal(result.accepted, true);
      assert.equal(events.length, 1);
      assert.equal(events[0].project.basic_info.name, "已保存");
      assert.equal(events[0].event.revision, result.revision);
      assert.deepEqual(
        (await new ModelRepository(root).open(model.id)).readAll(),
        model.readAll(),
      );
    }));

  test("历史终态 task/step/group 不可改写或删除", () =>
    withStore(async (root, repo) => {
      const p = fixture(),
        model = await repo.create(p),
        t = task(p, {
          task_status: "completed",
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
        }),
        st = { ...step(t), step_status: "done" };
      // 同组还有排队任务时，整组留在工作快照，组内终态任务不可改写或删除。
      const queued = task(p, { task_status: "queued", queue_order: 2 });
      await model.update("history", {}, (s) => {
        t.group_id = createId("group"); t.group_seq = 1;
        Object.assign(queued, { group_id: t.group_id, group_seq: 2 });
        s.groups = [{ id: t.group_id, project_id: p.basic_info.id, episode_id: t.episode_id, group_type: "single", source: t.source, shot_ids: [], action: t.action, created_at: t.created_at }];
        s.tasks = [t, queued];
        s.steps = [st];
        return {};
      });
      await assert.rejects(
        model.update("revive", {}, (s) => {
          s.tasks.find(row => row.id === t.id).task_status = "queued";
          return {};
        }),
        /终态/,
      );
      await assert.rejects(
        model.update("erase", {}, (s) => {
          s.tasks = [];
          s.steps = [];
          s.groups = [];
          return {};
        }),
        /历史/,
      );
      // 整组结束后移出工作快照，数据库保留；不能以同 ID 重新写回覆盖历史。
      await model.update("finish", {}, (s) => {
        Object.assign(s.tasks.find(row => row.id === queued.id), { task_status: "cancelled", end_reason: "测试取消", ended_at: new Date().toISOString() });
        return {};
      });
      assert.deepEqual(model.read().tasks, []);
      assert.deepEqual(model.read().groups, []);
      await assert.rejects(
        model.update("resurrect", {}, (s) => {
          s.groups = model.readAll().groups;
          s.tasks = [{ ...t, task_status: "queued" }, model.readAll().tasks.find(row => row.id === queued.id)];
          return {};
        }),
        /历史记录不可改写/,
      );
      assert.equal(model.readAll().tasks.find(row => row.id === t.id).task_status, "completed");
    }));
});

describe("task-history", () => {
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const deferred = () => { let resolve; return { promise: new Promise(r => { resolve = r; }), resolve: value => resolve(value) }; };
  async function fixture(work) {
    const home = await mkdtemp(join(tmpdir(), 'meiji-history-id-'));
    const repository = new ModelRepository(home), p = projectFixture(), model = await repository.create(p);
    try { await work({ home, repository, p, model }); }
    finally { await repository.close(); await rm(home, { recursive: true, force: true }); }
  }
  const command = (p, fields = {}) => ({ type: 'submit', project_id: p.basic_info.id, request_id: crypto.randomUUID(), business_type: 'project-summary', target_id: p.basic_info.id, action: 'regenerate', ...fields });

  // The completed first member stays available until the entire group ends, then only SQLite owns it.
  test('未结束组保留完整序号，整组结束移出工作快照，重启与按ID查询保留全部历史', () => fixture(async ({ home, repository, p, model }) => {
    let group, first, second;
    await model.update('seed', {}, s => {
      group = createTaskGroupModel({ project_id: p.basic_info.id, group_type: 'workflow', source: 'panel' });
      first = taskFixture(p, 'project-summary', p.basic_info.id, { episode_id: null, group_id: group.id, group_seq: 1 });
      second = taskFixture(p, 'episode-summary', p.episodes[0].id, { group_id: group.id, group_seq: 2, queue_order: 2 });
      s.groups.push(group); s.tasks.push(first, second); s.steps.push(newStep(first, 1, 'generate'), newStep(second, 1, 'generate'));
    });
    await model.update('first-end', {}, s => {
      Object.assign(s.tasks[0], { task_status: 'completed', ended_at: new Date().toISOString() });
      Object.assign(s.steps[0], { step_status: 'done', result: '第一项', ended_at: new Date().toISOString() });
    });
    assert.equal(model.read().tasks.length, 2);
    const partial = new ModelRepository(home);
    try { assert.deepEqual((await partial.open(p.basic_info.id)).read().tasks.map(t => t.task_status), ['completed', 'queued']); }
    finally { await partial.close(); }
    await model.update('all-end', {}, s => {
      Object.assign(s.tasks[1], { task_status: 'completed', ended_at: new Date().toISOString() });
      Object.assign(s.steps[1], { step_status: 'done', result: '第二项', ended_at: new Date().toISOString() });
    });
    for (const key of ['tasks', 'groups', 'steps']) assert.deepEqual(model.read()[key], []);
    assert.deepEqual(Object.keys(panelSnapshot(model).runtime), ['revision']);
    assert.doesNotMatch(JSON.stringify(panelSnapshot(model)), new RegExp(first.id), '面板不从幂等结果间接携带历史');
    assert.equal(repository.history(p.basic_info.id).group(group.id).tasks.length, 2);
    assert.deepEqual(repository.history(p.basic_info.id).group(group.id).steps.map(s => s.task_id), [first.id, second.id]);
    await assert.rejects(model.update('overwrite', {}, s => { s.groups.push(group); s.tasks.push({ ...first, task_status: 'queued' }); }), /历史记录不可改写/);
    const restored = new ModelRepository(home);
    try {
      const reloaded = await restored.open(p.basic_info.id);
      assert.deepEqual(reloaded.read().tasks, []);
      assert.equal(restored.history(p.basic_info.id).task(first.id).task_status, 'completed');
    } finally { await restored.close(); }
  }));

  test('记录直写不增加revision/幂等，运行中可查；终态后迟到写入拒绝且执行记录释放', () => fixture(async ({ home, repository, p, model }) => {
    const entered = deferred(), gate = deferred(); let activeStep;
    const events = []; repository.on('change', event => events.push(event));
    const service = new TaskService({ repository, commitOutput: commitContent, execute: async ({ step, record }) => {
      if (step.kind === 'review') return { result: { 是否通过: true, "类型": "", 原因: '' } };
      activeStep = step;
      const before = model.read();
      await record({ prompt: { messages: [{ role: 'user', content: '运行提示' }] }, http: [{ request: { body: '正在请求' } }] });
      assert.deepEqual(model.read(), before);
      entered.resolve(); await gate.promise;
      return { content: { body: '摘要完成' } };
    } });
    try {
      const hash = dependencyHash(model.read(), 'project-summary', p.basic_info.id);
      const submitted = await service.command(command(p)); await entered.promise;
      assert.equal(dependencyHash(model.read(), 'project-summary', p.basic_info.id), hash, '最近任务ID不进入节点依赖');
      assert.equal(model.read().project.latest_tasks[`project-summary:${p.basic_info.id}`], submitted.task_id);
      const query = await service.command({ type: 'query', project_id: p.basic_info.id, task_id: submitted.task_id });
      assert.equal(query.steps.find(s => s.id === activeStep.id).prompt.messages[0].content, '运行提示');
      const panel = panelSnapshot(model, service.liveRecords(p.basic_info.id));
      assert.deepEqual(Object.keys(panel.runtime), ['revision']);
      assert.ok(model.read().runtime.requests.length > 0, '幂等记录仍在服务端');
      assert.equal(panel.steps.find(s => s.id === activeStep.id).has_http, true);
      assert.ok(panel.steps.every(s => !('prompt' in s) && !('http' in s)));
      assert.equal(events.find(e => e.record)?.record.has_http, true);
      gate.resolve(); await service.idle(p.basic_info.id);
      assert.equal(service.liveRecords(p.basic_info.id).size, 0);
      assert.deepEqual(model.read().tasks, []);
      const history = repository.history(p.basic_info.id), task = history.task(submitted.task_id);
      const before = history.group(task.group_id, { records: true });
      assert.equal(await repository.writeStepRecord(p.basic_info.id, { step_id: activeStep.id, task_id: task.id, group_id: task.group_id }, { http: [{ body: '迟到' }] }), false);
      assert.deepEqual(history.group(task.group_id, { records: true }), before);
      const finished = await service.command({ type: 'query', project_id: p.basic_info.id, group_id: task.group_id });
      assert.equal(finished.steps.find(s => s.id === activeStep.id).http[0].request.body, '正在请求');
      assert.equal((await service.command({type:'cancel',project_id:p.basic_info.id,request_id:crypto.randomUUID(),task_id:task.id})).already_terminal, true);
      const mirror = JSON.parse(await readFile(join(home, p.basic_info.id, 'project.json'), 'utf8'));
      assert.equal(mirror.latest_tasks[`project-summary:${p.basic_info.id}`], task.id);
      assert.equal('tasks' in mirror, false);
    } finally { gate.resolve(); await service.dispose(); }
  }));

  test('v22升v23按队列回填最近任务与成片组，保留节点指纹、原步骤记录且迁移只执行一次', () => fixture(async ({ home, p, model }) => {
    const group = createTaskGroupModel({ project_id: p.basic_info.id, episode_id: p.episodes[0].id, group_type: 'episode-film', shot_ids: [p.episodes[0].shot_list.shots[0].id], source: 'panel' });
    const task = taskFixture(p, 'seconds', group.shot_ids[0], { group_id: group.id, group_seq: 1, task_status: 'completed', ended_at: new Date().toISOString() });
    await model.update('old-history', {}, s => {
      s.groups.push(group); s.tasks.push(task); s.steps.push({ ...newStep(task, 1, 'generate'), step_status: 'done' });
    });
    const before = model.read();
    let db = new DatabaseSync(join(home, 'meiji.sqlite'));
    const old = structuredClone(before.project); delete old.latest_tasks; delete old.latest_groups;
    db.prepare('UPDATE projects SET data_json=? WHERE id=?').run(JSON.stringify(old), p.basic_info.id);
    db.exec('DELETE FROM schema_migrations WHERE version=23; PRAGMA user_version=22'); db.close();
    const upgraded = new ModelRepository(home);
    try {
      const current = (await upgraded.open(p.basic_info.id)).read();
      assert.deepEqual(current.tasks, []);
      assert.equal(current.project.latest_tasks[`seconds:${task.target_id}`], task.id);
      assert.equal(current.project.latest_groups[`episode-film:${group.episode_id}`], group.id);
      assert.equal(current.project.latest_groups[`shot-film:${task.target_id}`], group.id);
      assert.equal(dependencyHash(current, 'seconds', task.target_id), dependencyHash(before, 'seconds', task.target_id));
      assert.equal(upgraded.history(p.basic_info.id).task(task.id).task_status, 'completed');
      db = new DatabaseSync(join(home, 'meiji.sqlite'));
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 29); db.close();
      const again = new ModelRepository(home);
      try { assert.deepEqual((await again.open(p.basic_info.id)).read(), current); } finally { await again.close(); }
    } finally { await upgraded.close(); }
  }));

  test('批量ID/详情/历史接口隔离项目，筛选和分页不携带步骤记录', () => fixture(async ({ repository, p, model }) => {
    const service = new TaskService({ repository, commitOutput: commitContent, execute: async ({ step }) => step.kind === 'review' ? { result: { 是否通过: true, "类型": "", 原因: '' } } : { content: { body: '摘要' } } });
    const other = projectFixture(); await repository.create(other);
    let server;
    try {
      const first = await service.command(command(p)); await service.idle(p.basic_info.id);
      await service.command(command(p, { business_type: 'episode-summary', target_id: p.episodes[0].id })); await service.idle(p.basic_info.id);
      const hidden = await service.command(command(other)); await service.idle(other.basic_info.id);
      const hiddenGroup = repository.history(other.basic_info.id).task(hidden.task_id).group_id;
      const runtime = { repository, tasks: service, bindings: { projectForSession: async sid => sid === 'allowed' ? p.basic_info.id : other.basic_info.id } };
      server = createServer(createTaskHttpHandler(runtime, { authorize: req => req.headers['x-test'] === '1' ? null : 401 }));
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const get = async path => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api/meiji/${path}`, { headers: { 'x-test': '1' } }); return { status: response.status, value: await response.json() }; };
      const records = (await get(`records?session_id=allowed&task_ids=${first.task_id},${hidden.task_id}&group_ids=${hiddenGroup}`)).value;
      assert.equal(records.groups.length, 1); assert.equal(records.groups[0].tasks[0].id, first.task_id);
      assert.ok(records.groups[0].steps.every(s => !('prompt' in s) && !('http' in s)));
      assert.equal((await get(`group?session_id=allowed&group_id=${hiddenGroup}`)).status, 404);
      const page = (await get('history?session_id=allowed&offset=1&limit=1')).value;
      assert.equal(page.total, 2); assert.equal(page.groups.length, 1); assert.equal(page.groups[0].tasks[0].id, first.task_id);
      assert.equal('steps' in page.groups[0], false);
      assert.equal((await get(`history?session_id=allowed&business=episode-summary&episode=${p.episodes[0].id}&status=completed`)).value.total, 1);
      assert.equal((await get('history?session_id=allowed&status=failed')).value.total, 0);
      assert.deepEqual(model.read().tasks, []);
    } finally { server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve)); await service.dispose(); }
  }));

  function panelFixture() {
    const context = new PanelContext(), p = projectFixture();
    context.select('session', p.basic_info.id);
    const group = { id: 'group', group_type: 'single', project_id: p.basic_info.id };
    const task = { id: 'task', group_id: group.id, group_seq: 1, business_type: 'project-summary', target_id: p.basic_info.id, task_status: 'completed', queue_order: 1 };
    p.latest_tasks[`project-summary:${p.basic_info.id}`] = task.id;
    context.accept(context.token(), { project: p, tasks: [], groups: [], steps: [], runtime: { revision: 5 } });
    return { context, p, group, task };
  }

  test('最近任务批量缓存不会推进项目版本；终态推送保留节点状态，切项目与旧版本响应被拒绝', async () => {
    const { context, p, group, task } = panelFixture(), token = context.token();
    const ids = context.neededRecords();
    assert.deepEqual(ids.task_ids, ['task']);
    assert.equal(context.acceptRecords(token, { revision: 4, groups: [{ group, tasks: [task], steps: [] }] }, ids), false);
    assert.equal(context.acceptRecords(token, { revision: 6, groups: [{ group, tasks: [task], steps: [] }] }, ids), true);
    assert.equal(context.read().runtime.revision, 5);
    assert.deepEqual(context.neededRecords().task_ids, []);
    const next = { ...task, id: 'next', task_status: 'running' }, nextGroup = { ...group, id: 'next-group' }; next.group_id = nextGroup.id;
    const links = { latest_tasks: { [`project-summary:${p.basic_info.id}`]: next.id } };
    context.mergeGroups([{ group: nextGroup, tasks: [next], steps: [] }], 6, links);
    assert.equal(context.read().project.latest_tasks[`project-summary:${p.basic_info.id}`], 'next');
    context.mergeGroups([{ group: nextGroup, tasks: [{ ...next, task_status: 'failed', end_reason: '断线' }], steps: [] }], 7);
    assert.equal(context.read().tasks.find(t => t.id === next.id).end_reason, '断线');
    context.accept(context.token(), { project: context.read().project, tasks: [], groups: [], steps: [], runtime: { revision: 7 } });
    assert.equal(context.read().tasks.find(t => t.id === next.id).task_status, 'failed');
    context.select('another', 'another-project');
    assert.equal(context.acceptRecords(token, { revision: 99, groups: [{ group, tasks: [task] }] }, ids), false);
    assert.equal(context.read(), null);
  });

  test('批量读取晚到结果不写入另一项目，重复刷新不重复读取已缓存终态', async () => {
    const previous = globalThis.fetch, gate = deferred(), { context, group, task } = panelFixture(); let calls = 0;
    globalThis.fetch = async () => { calls++; await gate.promise; return { ok: true, json: async () => ({ revision: 5, groups: [{ group, tasks: [task], steps: [] }] }) }; };
    try {
      const pending = loadLatestRecords(context); context.select('other', 'other'); gate.resolve();
      assert.equal(await pending, false); assert.equal(context.read(), null);
      const next = panelFixture();
      globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ revision: 5, groups: [{ group: next.group, tasks: [next.task], steps: [] }] }) }; };
      await loadLatestRecords(next.context); await loadLatestRecords(next.context);
      assert.equal(calls, 2);
    } finally { gate.resolve(); globalThis.fetch = previous; }
  });

  test('历史页从空快照分页筛选；任务ID直达详情；同revision记录事件刷新HTTP且离开页面不被拉回', async () => {
    const dom = new JSDOM('<main></main>'), previous = { document: globalThis.document, fetch: globalThis.fetch };
    globalThis.document = dom.window.document;
    const root = document.querySelector('main'), p = projectFixture(), requests = [], state = { page: 'history' };
    const snapshot = { project: p, tasks: [], steps: [], groups: [], runtime: { revision: 5 } };
    let httpVersion = 1, groupGate = null;
    const task = { id: 't', group_id: 'g', group_seq: 1, business_type: 'outline', episode_id: p.episodes[0].id, target_id: p.episodes[0].id, task_status: 'running', queue_order: 1 };
    const group = { id: 'g', project_id: p.basic_info.id, group_type: 'single', source: 'panel' };
    const row = { group, tasks: [task], status: 'running', name: '大纲任务' };
    globalThis.fetch = async url => {
      requests.push(String(url));
      const parsed = new URL(url, 'http://localhost');
      if (parsed.pathname.endsWith('/history')) return { ok: true, json: async () => ({ revision: 5, total: 51, limit: 50, offset: Number(parsed.searchParams.get('offset') || 0), groups: [row] }) };
      if (parsed.pathname.endsWith('/records')) return { ok: true, json: async () => ({ revision: 5, groups: [row] }) };
      if (groupGate) await groupGate.promise;
      return { ok: true, json: async () => ({ ...row, revision: 5, steps: [{ id: 's', task_id: 't', seq: 1, kind: 'generate', executor: 'ai', step_status: 'running', prompt: { messages: [{ role: 'user', content: '原始提示' }] }, http: [{ request: { body: `请求${httpVersion}` } }] }] }) };
    };
    const paint = () => { root.replaceChildren(); renderHistory(root, env, snapshot); };
    const env = { p, state, session_id: 'sid', paint, go: (page, values) => { Object.assign(state, { page }, values); paint(); }, button: (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; return b; } };
    try {
      paint(); await tick(); await tick();
      assert.match(root.textContent, /51 个任务组/);
      [...root.querySelectorAll('button')].find(b => b.textContent === '下一页').click(); await tick(); await tick();
      assert.ok(requests.some(url => url.includes('offset=50')));
      const filter = root.querySelector('[aria-label="按任务状态筛选"]'); filter.value = 'failed'; filter.onchange(); await tick(); await tick();
      assert.ok(requests.some(url => url.includes('status=failed') && url.includes('offset=0')));
      Object.assign(state, { task_id: 't', group_id: null, step_id: 's', step_view: 'http' }); paint(); await tick(); await tick();
      assert.match(root.textContent, /请求1/);
      assert.equal(requests.filter(url => url.startsWith('/api/meiji/group?')).length, 1);
      state.step_view = 'prompt'; paint(); assert.match(root.textContent, /原始提示/);
      assert.equal(requests.filter(url => url.startsWith('/api/meiji/group?')).length, 1);
      httpVersion = 2; state.step_view = 'http'; state.recordVersions = { g: 1 }; paint(); await tick(); await tick();
      assert.match(root.textContent, /请求2/);
      assert.equal(snapshot.runtime.revision, 5);
      groupGate = deferred(); state.recordVersions.g++; paint(); state.page = 'overview'; root.textContent = '已返回概要'; groupGate.resolve(); await tick(); await tick();
      assert.equal(root.textContent, '已返回概要'); assert.equal(state.page, 'overview');
    } finally { groupGate?.resolve(); globalThis.document = previous.document; globalThis.fetch = previous.fetch; dom.window.close(); }
  });

  test('真实面板挂载处理同版本record推送：只刷新详情，不整份刷新项目；完成后节点状态仍可见', async () => {
    const { mount } = await import('../client/workbench.js');
    const dom = new JSDOM('<main></main>', { url: 'http://localhost', pretendToBeVisual: true });
    const keys = ['document', 'window', 'localStorage', 'fetch', 'EventSource'];
    const saved = Object.fromEntries(keys.map(k => [k, globalThis[k]]));
    Object.assign(globalThis, { document: dom.window.document, window: dom.window, localStorage: dom.window.localStorage });
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-' + crypto.randomUUID() }));
    const p = projectFixture(), streams = [], urls = [];
    const group = { id: 'g', project_id: p.basic_info.id, group_type: 'single', source: 'panel' };
    let task = { id: 't', group_id: 'g', group_seq: 1, business_type: 'project-summary', target_id: p.basic_info.id, task_status: 'completed', queue_order: 1 };
    let revision = 5, httpBody = '请求初始';
    p.latest_tasks[`project-summary:${p.basic_info.id}`] = task.id;
    const steps = () => [{ id: 's', task_id: 't', seq: 1, kind: 'generate', executor: 'ai', step_status: task.task_status === 'running' ? 'running' : 'done', has_prompt: true, has_http: true }];
    const detail = () => ({ group, tasks: [task], steps: steps(), revision, status: task.task_status, name: '摘要任务' });
    globalThis.EventSource = class { constructor() { streams.push(this); } close() {} };
    globalThis.fetch = async url => {
      urls.push(String(url)); let data;
      if (url.includes('context?')) data = { project_id: p.basic_info.id, snapshot: { project: p, tasks: [], groups: [], steps: [], runtime: { revision } } };
      else if (url.includes('records?')) data = { revision, groups: [detail()] };
      else if (url.includes('group?')) data = { ...detail(), steps: steps().map(step => ({ ...step, prompt: { messages: [{ role: 'user', content: '提示' }] }, http: [{ request: { body: httpBody } }] })) };
      else if (url.endsWith('models')) data = { settings: { output_language: 'zh-CN' } };
      else if (url.endsWith('gpu')) data = { utilization: 0 };
      else throw new Error('意外请求：' + url);
      return { ok: true, json: async () => structuredClone(data) };
    };
    let app;
    try {
      app = mount(); await app.refresh(); await tick();
      task = { ...task, task_status: 'running' }; revision = 6;
      streams[0].onmessage({ data: JSON.stringify({ project_id: p.basic_info.id, revision, groups: [detail()], content: false }) });
      Object.assign(app.view, { page: 'history', group_id: 'g', task_id: 't', step_id: 's', step_view: 'http' });
      await app.refresh(); await tick(); await tick();
      const contexts = urls.filter(url => url.includes('context?')).length;
      const groupCalls = urls.filter(url => url.includes('group?')).length;
      httpBody = '请求已返回';
      streams[0].onmessage({ data: JSON.stringify({ project_id: p.basic_info.id, revision, record: { group_id: 'g', task_id: 't', step_id: 's', has_http: true } }) });
      await tick(); await tick();
      assert.match(app.shell.content.textContent, /请求已返回/);
      assert.equal(urls.filter(url => url.includes('group?')).length, groupCalls + 1);
      assert.equal(urls.filter(url => url.includes('context?')).length, contexts);
      task = { ...task, task_status: 'completed' }; revision = 7;
      streams[0].onmessage({ data: JSON.stringify({ project_id: p.basic_info.id, revision, groups: [detail()], content: false }) });
      assert.equal(app.context.read().tasks.find(t => t.id === 't').task_status, 'completed');
      assert.equal(urls.filter(url => url.includes('context?')).length, contexts);
    } finally { app?.dispose(); Object.assign(globalThis, saved); dom.window.close(); }
  });

  test('同组前一终态镜头任务只保留状态时，修复仍按ID读到prompt中的完整失败基稿', () => fixture(async ({ repository, p, model }) => {
    const group = createTaskGroupModel({ project_id: p.basic_info.id, group_type: 'workflow', source: 'panel' });
    const previous = taskFixture(p, 'shots', p.episodes[0].id, { group_id: group.id, group_seq: 1, task_status: 'rejected', end_reason: '镜头候选未通过', ended_at: new Date().toISOString() });
    const pending = taskFixture(p, 'episode-summary', p.episodes[0].id, { group_id: group.id, group_seq: 2, queue_order: 2 });
    const base = { shots: structuredClone(p.episodes[0].shot_list.shots) }; base.shots[0].body = '失败候选正文，不是正式旧表';
    await model.update('candidate-history', {}, s => {
      s.project.episodes[0].shot_list.node_state.status = 'rejected'; s.project.episodes[0].shot_list.node_state.reason = '候选结构错误';
      s.groups.push(group); s.tasks.push(previous, pending);
      s.steps.push({ ...newStep(previous, 1, 'generate'), step_status: 'done', result: { shots: [] }, prompt: { input: { content: base } } }, newStep(pending, 1, 'precheck'));
    });
    const snapshot = model.read(); assert.ok(snapshot.steps.every(s => !('prompt' in s)));
    Object.defineProperty(snapshot, 'history', { value: repository.history(p.basic_info.id) });
    const current = taskFixture(p, 'shots', p.episodes[0].id, { action: 'revise', opinion: '修复', queue_order: 3 });
    assert.equal(taskNodeInput(snapshot, current, null, 'regenerate').content.shots[0].body, base.shots[0].body);
  }));


  test('历史查询先投影展示名称，选择复制不读取剧本或镜头正文', () => {
    const p = projectFixture();
    Object.defineProperty(p, 'script', { enumerable: true, get() { throw new Error('不应复制剧本正文'); } });
    Object.defineProperty(p.episodes[0].shot_list.shots[0], 'body', { enumerable: true, get() { throw new Error('不应复制镜头正文'); } });
    const selected = historyContext({ select: fn => structuredClone(fn({ project: p, runtime: { revision: 7 } })) });
    assert.equal(selected.revision, 7);
    assert.equal(selected.project.episodes[0].shot_list.shots[0].number, 'S01');
    assert.equal('script' in selected.project, false);
    assert.equal('body' in selected.project.episodes[0].shot_list.shots[0], false);
  });
});
