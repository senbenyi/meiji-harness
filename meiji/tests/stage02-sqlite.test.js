import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-service.js";
import { createId } from "../shared/task-contract.js";
import { projectFixture } from "./fixtures/project.js";

async function fixture(work) {
  const home = await mkdtemp(join(tmpdir(), "meiji-sqlite-"));
  try { await work(home); } finally { await rm(home, { recursive: true, force: true }); }
}
test("SQLite：七表、外键、组内顺序与项目运行唯一约束", () => fixture(async root => {
  const repo = new ModelRepository(root), p = projectFixture(), q = projectFixture();
  const model = await repo.create(p); await repo.create(q);
  const service = new TaskService({ repository: repo, execute: async () => { throw new Error("不应执行"); } });
  await model.update("pause", {}, s => { s.runtime.queue_stopped = true; });
  const result = await service.command({ type: "submit-group", project_id: p.id, request_id: "group", group_type: "episode-film", episode_id: p.剧集[0].id });
  const db = new DatabaseSync(join(root, "meiji.sqlite")); db.exec("PRAGMA foreign_keys=ON");
  try {
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name), ["command_requests", "notification_outbox", "projects", "schema_migrations", "task_groups", "task_steps", "tasks"]);
    const tasks = db.prepare("SELECT * FROM tasks ORDER BY group_seq").all(), a = tasks[0], b = tasks[1];
    assert.equal(a.group_id, result.group_id);
    assert.throws(() => db.prepare("UPDATE tasks SET group_id='missing' WHERE id=?").run(a.id), /FOREIGN KEY/);
    assert.throws(() => db.prepare("UPDATE tasks SET project_id=? WHERE id=?").run(q.id, a.id), /FOREIGN KEY/);
    assert.throws(() => db.prepare("UPDATE tasks SET group_id=NULL WHERE id=?").run(a.id), /NOT NULL/);
    assert.throws(() => db.prepare("UPDATE tasks SET group_seq=? WHERE id=?").run(a.group_seq, b.id), /UNIQUE/);
    db.prepare("UPDATE tasks SET task_status='running' WHERE id=?").run(a.id);
    assert.throws(() => db.prepare("UPDATE tasks SET task_status='running' WHERE id=?").run(b.id), /UNIQUE/);
    const steps = db.prepare("SELECT * FROM task_steps WHERE task_id=? ORDER BY seq").all(a.id);
    assert.throws(() => db.prepare("UPDATE task_steps SET task_id='missing' WHERE id=?").run(steps[0].id), /FOREIGN KEY/);
    assert.throws(() => db.prepare("UPDATE task_steps SET seq=? WHERE id=?").run(steps[0].seq, steps[1].id), /UNIQUE/);
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db.close(); await repo.close(); }
}));

test("SQLite v1→v2：清理资产字段与规则，保留历史并作废旧活动资产任务", () => fixture(async root => {
  const repo = new ModelRepository(root), p = projectFixture();
  await repo.create(p);
  await repo.close();
  const db = new DatabaseSync(join(root, "meiji.sqlite"));
  let groupId;
  try {
    const row = db.prepare("SELECT data_json FROM projects WHERE id=?").get(p.id),
      data = JSON.parse(row.data_json);
    data.剧集[0].本集资产 = { 状态: "generated", 原因: "", 角色: [] };
    data.规则 = [{ id: "r_00000000-0000-4000-8000-000000000001", 范围: "project",
      适用业务: ["outline", "episode-characters"], 节点id: "", 类别: "其他",
      约束: "参考", 内容: "保留" }];
    db.prepare("UPDATE projects SET data_json=? WHERE id=?").run(JSON.stringify(data), p.id);
    const created = new Date().toISOString(),
      taskId = createId("task"), stepId = createId("step");
    groupId = createId("group");
    db.prepare(`INSERT INTO task_groups
      (id,project_id,episode_id,name,group_type,action,source,shot_ids_json,opinion,continued_from_group_id,created_at,position)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(groupId,p.id,p.剧集[0].id,"旧本集资产任务","workflow","generate","panel","[]","",null,created,0);
    db.prepare(`INSERT INTO tasks
      (id,project_id,group_id,group_seq,name,business_type,target_id,episode_id,action,source,task_status,queue_order,opinion,previous_node_state_json,end_reason,created_at,started_at,ended_at,position)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(taskId,p.id,groupId,1,"旧本集资产任务","episode-characters",p.剧集[0].id,p.剧集[0].id,"generate","panel","queued",1,"",JSON.stringify({状态:"empty",原因:""}),"",created,null,null,0);
    db.prepare(`INSERT INTO task_steps
      (id,project_id,task_id,seq,name,kind,round,step_status,prompt_json,result_json,error_reason,started_at,ended_at,position)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(stepId,p.id,taskId,1,"前置检查","precheck",0,"ready","null","null","",null,null,0);
    db.prepare("DELETE FROM schema_migrations WHERE version=2").run();
    db.exec("PRAGMA user_version=1");
  } finally { db.close(); }
  const upgraded = new ModelRepository(root);
  try {
    const model = await upgraded.open(p.id),
      restored = model.read();
    assert.equal(Object.hasOwn(restored.project.剧集[0], "本集资产"), false);
    assert.deepEqual(restored.project.规则[0].适用业务, ["outline"]);
    assert.equal(restored.project.规则[0].内容, "保留");
    assert.equal(restored.runtime.revision, 2);
    assert.equal(restored.tasks[0].task_status, "superseded");
    assert.equal(restored.steps[0].step_status, "superseded");
    assert.match(restored.tasks[0].end_reason, /功能已移除/);
    const service = new TaskService({ repository: upgraded, execute: async () => { throw Error("不应恢复旧业务"); } }),
      continued = await service.command({ type: "continue-group", project_id: p.id,
        request_id: "continue-removed", group_id: groupId });
    assert.deepEqual(continued.task_ids, []);
    assert.equal(model.read().tasks.length, 1);
    await service.dispose();
    const check = new DatabaseSync(join(root, "meiji.sqlite"));
    try { assert.equal(check.prepare("PRAGMA user_version").get().user_version, 3); }
    finally { check.close(); }
  } finally { await upgraded.close(); }
}));

test("SQLite v2→v3：旧节点补上空依赖指纹并保留正文", () => fixture(async root => {
  const repo = new ModelRepository(root), p = projectFixture();
  await repo.create(p);
  await repo.close();
  const db = new DatabaseSync(join(root, "meiji.sqlite"));
  try {
    const row = db.prepare("SELECT data_json FROM projects WHERE id=?").get(p.id),
      data = JSON.parse(row.data_json);
    const strip = (node) => { delete node.依赖hash; };
    strip(data.项目摘要);
    strip(data.剧集[0].摘要);
    strip(data.剧集[0].镜头表.镜头[0].视频);
    db.prepare("UPDATE projects SET data_json=? WHERE id=?").run(JSON.stringify(data), p.id);
    db.prepare("DELETE FROM schema_migrations WHERE version=3").run();
    db.exec("PRAGMA user_version=2");
  } finally { db.close(); }
  const upgraded = new ModelRepository(root);
  try {
    const restored = (await upgraded.open(p.id)).read().project;
    assert.equal(restored.项目摘要.依赖hash, "");
    assert.equal(restored.项目摘要.正文, "摘要");
    assert.equal(restored.剧集[0].镜头表.镜头[0].视频.依赖hash, "");
    assert.equal(restored.剧集[0].镜头表.镜头[0].视频.地址, "1.mp4");
  } finally { await upgraded.close(); }
}));

test("SQLite：旧连接不能覆盖新版本，失败不发布缓存或事件", () => fixture(async root => {
  const a = new ModelRepository(root), p = projectFixture(), first = await a.create(p), b = new ModelRepository(root), second = await b.open(p.id);
  try {
    let events = 0; b.on("change", () => events++);
    await first.update("first", {}, s => { s.project.名称 = "新版本"; });
    await assert.rejects(second.update("stale", {}, s => { s.project.名称 = "旧连接覆盖"; }), { code: "REVISION_CONFLICT" });
    assert.equal(events, 0);
    const c = new ModelRepository(root);
    try { assert.equal((await c.open(p.id)).read().project.名称, "新版本"); } finally { await c.close(); }
  } finally { await a.close(); await b.close(); }
}));

for (const point of ["after-tasks", "after-commit"]) test(`SQLite：真实进程在 ${point} 退出后事务完整`, () => fixture(async root => {
  const repo = new ModelRepository(root), p = projectFixture(); await repo.create(p); await repo.close();
  const moduleUrl = new URL("../server/data/model-repository.js", import.meta.url).href;
  const script = `import {ModelRepository} from ${JSON.stringify(moduleUrl)}; const [root,id,point]=process.argv.slice(1); const repo=new ModelRepository(root,{checkpoint(name){if(name===point)process.exit(73)}});const model=await repo.open(id);await model.update('crash',{},s=>{s.project.名称='进程提交'; return {saved:true}});`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, root, p.id, point], { encoding: "utf8" });
  assert.equal(child.status, 73, child.stderr);
  const restored = new ModelRepository(root);
  try {
    const model = await restored.open(p.id), s = model.read();
    assert.equal(s.project.名称, point === "after-commit" ? "进程提交" : p.名称);
    assert.equal(s.runtime.requests.length, point === "after-commit" ? 1 : 0);
    if (point === "after-commit") assert.equal((await model.update("crash", {}, () => { throw Error("重复执行"); })).saved, true);
  } finally { await restored.close(); }
}));
