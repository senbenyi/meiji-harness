import test, { describe } from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRepository } from "../server/data/model-repository.js";
import { emptyProject } from "../shared/project_contract.js";
import { createId } from "../shared/task_contract.js";
import { projectFixture } from "./fixtures/project.js";
import { seedQueuedTasks } from "./fixtures/queued-tasks.js";
import { spawnSync } from "node:child_process";

describe("commit-recovery", () => {
  for (const point of [
    "after-project",
    "after-tasks",
    "after-steps",
    "after-groups",
    "after-runtime",
    "before-commit",
    "after-commit",
  ]) {
    test(`${point} 中断后重载为完整旧事务或完整新事务`, async () => {
      const root = await mkdtemp(join(tmpdir(), "meiji-commit-"));
      let armed = false;
      try {
        const repo = new ModelRepository(root, {
            checkpoint: (name) => {
              if (armed && name === point) throw new Error(`注入：${name}`);
            },
          }),
          p = emptyProject(),
          model = await repo.create(p);
        const t = {
          id: createId("task"),
          project_id: p.id,
          episode_id: null,
          business_type: "project-summary",
          target_id: p.id,
          action: "generate",
          group_id: null,
          group_seq: null,
          task_status: "completed",
          source: "panel",
          queue_order: 1,
          end_reason: "",
          created_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
          opinion: "",
          previous_node_state: { status: "empty", reason: "" },
        };
        let mutations = 0;
        armed = true;
        const update = () =>
          model.update("atomic", { operation: "complete" }, (s) => {
            mutations++;
            s.project.project_summary = { ...s.project.project_summary,
              node_state: { status: "generated", reason: "", dependency_hash: "" },
              body: "新摘要",
              script_version: 1,
            };
            t.group_id = createId("group"); t.group_seq = 1;
            s.groups = [{ id: t.group_id, project_id: p.id, episode_id: null, group_type: "single", source: t.source, shot_ids: [], action: t.action, created_at: t.created_at }];
            s.tasks = [t];
            return { task_id: t.id };
          });
        if (point === "after-commit") {
          const result = await update();
          assert.equal(result.accepted, true);
          assert.ok(result.storage_warning);
          assert.equal((await update()).task_id, t.id);
          assert.equal(mutations, 1);
        } else await assert.rejects(update(), /注入/);
        const fresh = await new ModelRepository(root).open(p.id),
          snapshot = fresh.readAll(),
          published = point === "after-commit";
        assert.equal(
          snapshot.project.project_summary.node_state.status,
          published ? "generated" : "empty",
        );
        assert.equal(snapshot.tasks.length, published ? 1 : 0);
        assert.equal(snapshot.runtime.requests.length, published ? 1 : 0);
        assert.deepEqual(snapshot, model.readAll());
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  test("SQLite 约束拒绝非法项目 JSON，保留原数据", async () => {
    const root = await mkdtemp(join(tmpdir(), "meiji-corrupt-"));
    try {
      const repo = new ModelRepository(root), p = emptyProject();
      await repo.create(p);
      const db = new DatabaseSync(join(root, "meiji.sqlite"));
      assert.throws(() => db.prepare("UPDATE projects SET data_json=? WHERE id=?").run("invalid JSON", p.id));
      db.close();
      assert.deepEqual((await new ModelRepository(root).open(p.id)).readAll().project, p);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("创建项目发布后出错仍返回已创建 Model，不反馈未受理", async () => {
    const root = await mkdtemp(join(tmpdir(), "meiji-create-commit-"));
    try {
      const repo = new ModelRepository(root, {
          checkpoint: (point) => {
            if (point === "after-commit") throw new Error("发布后异常");
          },
        }),
        p = emptyProject();
      const model = await repo.create(p);
      assert.equal(model.id, p.id);
      assert.deepEqual(
        (await new ModelRepository(root).open(p.id)).readAll(),
        model.readAll(),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("project-json", () => {
  async function fixture(work) {
    const root = await mkdtemp(join(tmpdir(), 'meiji-project-json-'));
    const repo = new ModelRepository(root), project = projectFixture();
    try { await work({ root, repo, project, file: join(root, project.id, 'project.json') }); }
    finally { await repo.close(); await rm(root, { recursive: true, force: true }); }
  }
  const read = async file => JSON.parse(await readFile(file, 'utf8'));

  test('项目JSON：创建及串行更新任意项目字段，事件发布前同步完成', () => fixture(async ({ root, repo, project, file }) => {
    const model = await repo.create(project);
    assert.deepEqual(await read(file), model.read().project);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    const events = [];
    repo.on('change', () => events.push(read(file)));
    await model.update('duration', {}, s => { s.project.episodes[0].duration_seconds = 288.5; s.project.episodes[0].episode_requirements = '新要求'; });
    assert.deepEqual(await events[0], model.read().project);
    await Promise.all([
      model.update('name', {}, s => { s.project.name = '新名称'; }),
      model.update('body', {}, s => { s.project.episodes[0].story_outline.segments[0].body = '新剧情'; }),
    ]);
    const json = await read(file), db = new DatabaseSync(join(root, 'meiji.sqlite'), { readOnly: true });
    try { assert.deepEqual(json, JSON.parse(db.prepare('SELECT data_json FROM projects WHERE id=?').get(project.id).data_json)); }
    finally { db.close(); }
    assert.deepEqual(json, model.read().project);
    assert.equal(json.tasks, undefined);
    assert.equal(json.episodes[0].duration_seconds, 288.5);
    assert.equal(json.name, '新名称');
    await assert.rejects(stat(file + '.tmp'), { code: 'ENOENT' });
  }));

  test('项目JSON：校验失败及数据库回滚不覆盖已保存JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meiji-project-json-rollback-'));
    let fail = false;
    const repo = new ModelRepository(root, { checkpoint(point) { if (fail && point === 'after-project') throw Error('事务中断'); } });
    try {
      const p = projectFixture(), model = await repo.create(p), file = join(root, p.id, 'project.json'), before = await read(file);
      await assert.rejects(model.update('invalid', {}, s => { s.project.episodes[0].duration_seconds = -1; }));
      fail = true;
      await assert.rejects(model.update('rollback', {}, s => { s.project.name = '不应保存'; }), /事务中断/);
      assert.deepEqual(await read(file), before);
      assert.deepEqual(model.read().project, before);
    } finally { await repo.close(); await rm(root, { recursive: true, force: true }); }
  });

  test('项目JSON：写入失败明确警告，幂等重试修复且不重复业务提交', () => fixture(async ({ repo, project, file }) => {
    const model = await repo.create(project), old = await read(file);
    await mkdir(file + '.tmp');
    const result = await model.update('change', {}, s => { s.project.name = '数据库已更新'; });
    assert.equal(result.accepted, true);
    assert.match(result.storage_warning, /本地JSON同步失败/);
    assert.equal(model.read().project.name, '数据库已更新');
    assert.deepEqual(await read(file), old);
    await rm(file + '.tmp', { recursive: true });
    const retry = await model.update('change', {}, () => { throw Error('不应重复执行'); });
    assert.equal(retry.revision, result.revision);
    assert.equal(retry.storage_warning, undefined);
    assert.deepEqual(await read(file), model.read().project);
  }));

  test('项目JSON：重启补齐缺失、覆盖损坏或过期镜像，删除项目移除镜像', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meiji-project-json-reopen-'));
    let repo = new ModelRepository(root);
    try {
      const a = projectFixture(), b = projectFixture();
      await repo.create(a); await repo.create(b); await repo.close();
      const aFile = join(root, a.id, 'project.json'), bFile = join(root, b.id, 'project.json');
      await rm(aFile); await writeFile(bFile, '{损坏JSON');
      repo = new ModelRepository(root);
      await repo.open(a.id);
      assert.deepEqual(await read(aFile), a);
      assert.deepEqual(await read(bFile), b);
      await repo.remove(a.id);
      await assert.rejects(stat(aFile), { code: 'ENOENT' });
    } finally { await repo.close(); await rm(root, { recursive: true, force: true }); }
  });
});

describe("sqlite", () => {
  async function fixture(work) {
    const home = await mkdtemp(join(tmpdir(), "meiji-sqlite-"));
    try { await work(home); } finally { await rm(home, { recursive: true, force: true }); }
  }
  test("SQLite：七表、外键、组内顺序与项目运行唯一约束", () => fixture(async root => {
    const repo = new ModelRepository(root), p = projectFixture(), q = projectFixture();
    const model = await repo.create(p); await repo.create(q);
    await seedQueuedTasks(model, [["project-summary",p.id],["episode-summary",p.episodes[0].id]]);
    const result = {group_id:model.read().tasks[0].group_id};
    const db = new DatabaseSync(join(root, "meiji.sqlite")); db.exec("PRAGMA foreign_keys=ON");
    try {
      assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name), ["command_requests", "notification_outbox", "projects", "schema_migrations", "task_groups", "task_steps", "tasks"]);
      const tasks = db.prepare("SELECT * FROM tasks ORDER BY group_seq").all(), a = tasks[0], b = tasks[1];
      assert.equal(a.group_id, result.group_id);
      assert.throws(() => db.prepare("UPDATE tasks SET group_id='missing' WHERE id=?").run(a.id), /FOREIGN KEY/);
      assert.throws(() => db.prepare("UPDATE tasks SET project_id=? WHERE id=?").run(q.id, a.id), /FOREIGN KEY/);
      assert.throws(() => db.prepare("UPDATE tasks SET group_id=NULL WHERE id=?").run(a.id), /NOT NULL/);
      assert.throws(() => db.prepare("UPDATE tasks SET group_id=?,group_seq=? WHERE id=?").run(a.group_id,a.group_seq, b.id), /UNIQUE/);
      db.prepare("UPDATE tasks SET task_status='running' WHERE id=?").run(a.id);
      assert.throws(() => db.prepare("UPDATE tasks SET task_status='running' WHERE id=?").run(b.id), /UNIQUE/);
      const steps = db.prepare("SELECT * FROM task_steps WHERE task_id=? ORDER BY seq").all(a.id);
      assert.throws(() => db.prepare("UPDATE task_steps SET task_id='missing' WHERE id=?").run(steps[0].id), /FOREIGN KEY/);
      assert.throws(() => db.prepare("UPDATE task_steps SET seq=? WHERE id=?").run(steps[0].seq, steps[1].id), /UNIQUE/);
      assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { db.close(); await repo.close(); }
  }));

  test("SQLite：旧连接不能覆盖新版本，失败不发布缓存或事件", () => fixture(async root => {
    const a = new ModelRepository(root), p = projectFixture(), first = await a.create(p), b = new ModelRepository(root), second = await b.open(p.id);
    try {
      let events = 0; b.on("change", () => events++);
      await first.update("first", {}, s => { s.project.name = "新版本"; });
      await assert.rejects(second.update("stale", {}, s => { s.project.name = "旧连接覆盖"; }), { code: "REVISION_CONFLICT" });
      assert.equal(events, 0);
      const c = new ModelRepository(root);
      try { assert.equal((await c.open(p.id)).read().project.name, "新版本"); } finally { await c.close(); }
    } finally { await a.close(); await b.close(); }
  }));

  for (const point of ["after-tasks", "after-commit"]) test(`SQLite：真实进程在 ${point} 退出后事务完整`, () => fixture(async root => {
    const repo = new ModelRepository(root), p = projectFixture(); await repo.create(p); await repo.close();
    const moduleUrl = new URL("../server/data/model-repository.js", import.meta.url).href;
    const script = `import {ModelRepository} from ${JSON.stringify(moduleUrl)}; const [root,id,point]=process.argv.slice(1); const repo=new ModelRepository(root,{checkpoint(name){if(name===point)process.exit(73)}});const model=await repo.open(id);await model.update('crash',{},s=>{s.project.name='进程提交'; return {saved:true}});`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, root, p.id, point], { encoding: "utf8" });
    assert.equal(child.status, 73, child.stderr);
    const restored = new ModelRepository(root);
    try {
      const model = await restored.open(p.id), s = model.read();
      assert.equal(s.project.name, point === "after-commit" ? "进程提交" : p.name);
      assert.deepEqual(JSON.parse(await readFile(join(root, p.id, "project.json"), "utf8")), s.project);
      assert.equal(s.runtime.requests.length, point === "after-commit" ? 1 : 0);
      if (point === "after-commit") assert.equal((await model.update("crash", {}, () => { throw Error("重复执行"); })).saved, true);
    } finally { await restored.close(); }
  }));

  test("v13迁移删除暂停列，完整保留项目、队列、历史与幂等记录", () => fixture(async root => {
    let repo=new ModelRepository(root);const p=projectFixture(),model=await repo.create(p);
    await seedQueuedTasks(model, [['project-summary',p.id],['episode-summary',p.episodes[0].id]]);
    const before=model.read();await repo.close();
    let db=new DatabaseSync(join(root,'meiji.sqlite'));
    db.exec('ALTER TABLE projects ADD COLUMN queue_stopped INTEGER NOT NULL DEFAULT 1 CHECK(queue_stopped IN (0,1)); DELETE FROM schema_migrations WHERE version>=14; PRAGMA user_version=13');
    db.close();repo=new ModelRepository(root);
    try {
      const restored=await repo.open(p.id);
      before.runtime.revision += 3; // 节点状态迁移与 v23 最近任务关联各推进一次。
      before.project.latest_tasks = Object.fromEntries(before.tasks.map(t => [`${t.business_type}:${t.target_id}`, t.id]));
      assert.deepEqual(restored.read(),before);
      assert.equal('queue_stopped' in restored.read().runtime,false);
      db=new DatabaseSync(join(root,'meiji.sqlite'));
      assert.equal(db.prepare('PRAGMA user_version').get().user_version,27);
      assert.equal(db.prepare('PRAGMA table_info(projects)').all().some(c=>c.name==='queue_stopped'),false);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
      db.close();
    } finally {await repo.close();}
  }));
});
