import { seedQueuedTasks } from './fixtures/queued-tasks.js';
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { ModelRepository } from "../server/data/model-repository.js";
import { projectFixture } from "./fixtures/project.js";

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
    before.runtime.revision += 1;
    assert.deepEqual(restored.read(),before);
    assert.equal('queue_stopped' in restored.read().runtime,false);
    db=new DatabaseSync(join(root,'meiji.sqlite'));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,18);
    assert.equal(db.prepare('PRAGMA table_info(projects)').all().some(c=>c.name==='queue_stopped'),false);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    db.close();
  } finally {await repo.close();}
}));
