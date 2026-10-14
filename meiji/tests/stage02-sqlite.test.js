import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-service.js";
import { createId } from "../shared/task_contract.js";
import { projectFixture } from "./fixtures/project.js";
import { migrateEpisodeNodesV4 } from "../shared/models/migrate_project_model.js";
import { commitContent } from "../server/handlers/content.js";

async function fixture(work) {
  const home = await mkdtemp(join(tmpdir(), "meiji-sqlite-"));
  try { await work(home); } finally { await rm(home, { recursive: true, force: true }); }
}
test("SQLite：七表、外键、组内顺序与项目运行唯一约束", () => fixture(async root => {
  const repo = new ModelRepository(root), p = projectFixture(), q = projectFixture();
  const model = await repo.create(p); await repo.create(q);
  const service = new TaskService({ repository: repo, execute: async () => { throw new Error("不应执行"); } });
  await model.update("pause", {}, s => { s.runtime.queue_stopped = true; });
  const result = await service.command({ type: "submit-group", project_id: p.id, request_id: "group", group_type: "episode-film", episode_id: p.episodes[0].id, action: "regenerate" });
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

function legacyProject() {
  const id = createId("project"), episodeId = createId("episode");
  const state = { 状态: "generated", 原因: "", 依赖hash: "" };
  return {
    id, 名称: "旧项目", 创作方式: "剧本", 画幅: "1344x768", 创作方向: "", 输出语言: "zh-CN", 参考单集时长秒: 150,
    规则: [], 剧本: { 版本: 3, 正文: "原文不可丢失", 后续剧情: "", 修改记录: [], 更新时间: "" },
    项目摘要: { ...state, 正文: "旧摘要", 剧本版本: 3 },
    角色库: { ...state, 角色: [{ id: createId("character"), 编号: "C01", 名称: "甲", 年龄: "青年", 体型: "健壮", 服装: [], 图片: { ...state, 地址: "original.png" } }] },
    剧集: [{ id: episodeId, 序号: 1, 时长秒: 150, 剧情: "完整剧情", 摘要: { ...state, 正文: "摘要" }, 故事大纲: { 状态: "empty", 原因: "", 依赖hash: "", 小段: [] }, 镜头表: { 状态: "empty", 原因: "", 依赖hash: "", 镜头: [] }, 合片: { 状态: "empty", 原因: "", 依赖hash: "", 地址: "" } }],
  };
}
async function legacyDatabase(root, version = 3, project = legacyProject()) {
  const db = new DatabaseSync(join(root, "meiji.sqlite"));
  db.exec(await readFile(new URL("./fixtures/sqlite-v3.sql", import.meta.url), "utf8"));
  db.prepare("INSERT INTO projects VALUES (?,?,1,0)").run(project.id, JSON.stringify(project));
  db.prepare("DELETE FROM schema_migrations WHERE version>?").run(version);
  db.exec(`PRAGMA user_version=${version}`);
  return { db, project };
}
function legacyTask(db, project, business = "project-summary", status = "completed") {
  const created = new Date().toISOString(), taskId = createId("task"), stepId = createId("step"), groupId = createId("group");
  const episodeId = business === "episode-characters" ? project.剧集[0].id : null;
  db.prepare("INSERT INTO task_groups VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(groupId, project.id, episodeId, "原组", "workflow", "generate", "panel", "[]", "旧组意见", null, created, 0);
  db.prepare("INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(taskId, project.id, groupId, 1, "原任务", business, episodeId || project.id, episodeId, "generate", "panel", status, 1, "任务意见", JSON.stringify({ 状态: "empty", 原因: "" }), "", created, status === "completed" ? created : null, status === "completed" ? created : null, 0);
  db.prepare("INSERT INTO task_steps VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(stepId, project.id, taskId, 1, "生成", "generate", 0, status === "completed" ? "done" : "ready", JSON.stringify({ 原始提示词: "按历史保存" }), JSON.stringify({ 原始结果: "不重建" }), "", null, null, 0);
  return { taskId, stepId, groupId };
}

test("SQLite v1→v7：清理资产字段与规则，保留历史并作废旧活动资产任务", () => fixture(async root => {
  const p = legacyProject();
  p.剧集[0].本集资产 = { 状态: "generated", 原因: "", 角色: [] };
  p.规则 = [{ id: createId("rule"), 范围: "project", 适用业务: ["outline", "episode-characters"], 节点id: "", 类别: "其他", 约束: "参考", 内容: "保留" }];
  const { db } = await legacyDatabase(root, 1, p);
  const { groupId } = legacyTask(db, p, "episode-characters", "queued");
  db.close();
  const upgraded = new ModelRepository(root);
  try {
    const model = await upgraded.open(p.id), restored = model.read();
    assert.equal(Object.hasOwn(restored.project.episodes[0], "本集资产"), false);
    assert.deepEqual(restored.project.rules[0].applicable_business_types, ["outline"]);
    assert.equal(restored.project.rules[0].content, "保留");
    assert.equal(restored.tasks[0].task_status, "superseded");
    assert.equal(restored.steps[0].step_status, "superseded");
    assert.match(restored.tasks[0].end_reason, /功能已移除/);
    const service = new TaskService({ repository: upgraded, execute: async () => { throw Error("不应恢复旧业务"); } });
    await assert.rejects(service.command({ type: "continue-group", project_id: p.id, request_id: "continue-removed", group_id: groupId }), /已移除业务/);
    assert.equal(model.read().tasks.length, 1);
    await service.dispose();
  } finally { await upgraded.close(); }
}));

test("SQLite v2→v7：补节点指纹并保留正文、人物图和空服装", () => fixture(async root => {
  const p = legacyProject(); delete p.项目摘要.依赖hash;
  const { db } = await legacyDatabase(root, 2, p); db.close();
  const upgraded = new ModelRepository(root);
  try {
    const restored = (await upgraded.open(p.id)).read().project;
    assert.equal(restored.project_summary.node_state.dependency_hash, "");
    assert.equal(restored.project_summary.body, "旧摘要");
    assert.equal(restored.character_library.characters[0].id, p.角色库.角色[0].id);
    assert.equal(restored.character_library.characters[0].costume_images[0].address, "original.png");
    assert.deepEqual(restored.character_library.characters[0].costumes, []);
    assert.equal(restored.character_library.characters[0].costume_images[0].costume_id, "");
  } finally { await upgraded.close(); }
}));

test("SQLite v3→v7：保留终态和原始请求，移除组冗余字段，备份且只迁移一次", () => fixture(async root => {
  const { db, project: p } = await legacyDatabase(root);
  const ids = legacyTask(db, p);
  const before = db.prepare("SELECT prompt_json,result_json FROM task_steps").get();
  db.close();
  const upgraded = new ModelRepository(root);
  const model = await upgraded.open(p.id), snapshot = model.read();
  assert.equal(snapshot.tasks[0].id, ids.taskId);
  assert.equal(snapshot.tasks[0].task_status, "completed");
  assert.deepEqual(snapshot.tasks[0].previous_node_state, { status: "empty", reason: "" });
  assert.equal(snapshot.groups[0].id, ids.groupId);
  assert.equal(snapshot.groups[0].opinion, undefined);
  assert.equal(snapshot.groups[0].continued_from_group_id, undefined);
  await upgraded.close();
  const backups = (await readdir(root)).filter(name => name.includes("before-v7"));
  assert.equal(backups.length, 1);
  const backup = new DatabaseSync(join(root, backups[0]));
  assert.equal(backup.prepare("PRAGMA user_version").get().user_version, 3); backup.close();
  const check = new DatabaseSync(join(root, "meiji.sqlite"));
  assert.equal(check.prepare("PRAGMA user_version").get().user_version, 7);
  assert.deepEqual(check.prepare("PRAGMA foreign_key_check").all(), []);
  assert.deepEqual(check.prepare("SELECT prompt_json,result_json FROM task_steps").get(), before);
  assert.ok(!check.prepare("PRAGMA table_info(task_groups)").all().some(row => ["opinion", "continued_from_group_id"].includes(row.name)));
  check.exec("BEGIN");
  check.prepare("UPDATE task_steps SET step_status='rejected',error_reason='未通过' WHERE id=?").run(ids.stepId);
  check.exec("ROLLBACK");
  check.close();
  const second = new ModelRepository(root);
  await second.open(p.id); await second.close();
  assert.equal((await readdir(root)).filter(name => name.includes("before-v7")).length, 1);
}));

for (const version of [1, 2, 3]) test(`SQLite v${version}→v7 校验失败整体回滚且备份保持升级前状态`, () => fixture(async root => {
  const p = legacyProject();
  p.角色库.角色[0].id = p.id;
  delete p.项目摘要.依赖hash;
  if (version === 1) p.剧集[0].本集资产 = { 状态: "empty", 原因: "", 角色: [] };
  const { db } = await legacyDatabase(root, version, p);
  legacyTask(db, p, version === 1 ? "episode-characters" : "project-summary", version === 1 ? "queued" : "completed");
  const capture = database => ({
    version: database.prepare("PRAGMA user_version").get().user_version,
    schema: database.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all(),
    tables: Object.fromEntries(["projects", "task_groups", "tasks", "task_steps", "schema_migrations"].map(table => [table, database.prepare(`SELECT * FROM ${table}`).all()])),
  });
  const before = capture(db);
  db.close();
  const repo = new ModelRepository(root);
  await assert.rejects(repo.open(p.id), /重复 ID/);
  const check = new DatabaseSync(join(root, "meiji.sqlite"));
  assert.deepEqual(capture(check), before, "任一迁移步骤失败后，旧版本号、结构、项目、任务和历史均保持不变");
  check.close();
  const backups = (await readdir(root)).filter(name => name.includes("before-v7"));
  assert.equal(backups.length, 1);
  const backup = new DatabaseSync(join(root, backups[0]));
  assert.deepEqual(capture(backup), before, "备份是升级前的完整旧版本");
  backup.close();
}));

test("SQLite v4→v7：修正累计时长和旧依赖，排队恢复不覆盖过期，终态历史不变", () => fixture(async root => {
  const repo = new ModelRepository(root), p = projectFixture();
  const episode = p.episodes[0];
  episode.shot_list.shots[0].actual_duration_seconds = 5.2;
  episode.shot_list.shots[1].actual_duration_seconds = 6.1;
  const model = await repo.create(p);
  const service = new TaskService({ repository: repo, commitOutput: commitContent, execute: async ({ step }) => step.kind === "review" ? { result: { 是否通过: true, 原因: "" } } : { content: { body: "历史摘要" } } });
  const completed = await service.command({ type: "submit", project_id: p.id, request_id: "history", business_type: "project-summary", target_id: p.id, action: "regenerate" });
  await service.idle(p.id);
  await model.update("pause", {}, s => { s.runtime.queue_stopped = true; });
  const queued = await service.command({ type: "submit", project_id: p.id, request_id: "pending", business_type: "outline", target_id: episode.id, action: "regenerate" });
  const history = model.read();
  assert.equal(history.tasks.find(t => t.id === completed.task_id).task_status, "completed");
  await service.dispose(); await repo.close();

  const path = join(root, "meiji.sqlite"), db = new DatabaseSync(path);
  const oldProject = JSON.parse(db.prepare("SELECT data_json FROM projects WHERE id=?").get(p.id).data_json);
  oldProject.episodes[0].actual_duration_seconds = 999;
  oldProject.episodes[0].story_outline.node_state.dependency_hash = "a".repeat(64);
  db.prepare("UPDATE projects SET data_json=? WHERE id=?").run(JSON.stringify(oldProject), p.id);
  db.exec("DELETE FROM schema_migrations WHERE version>=5; PRAGMA user_version=4");
  const historicalTasks = db.prepare("SELECT * FROM tasks WHERE task_status='completed'").all();
  const historicalSteps = db.prepare("SELECT * FROM task_steps WHERE task_id=?").all(completed.task_id);
  db.close();

  const upgraded = new ModelRepository(root), restoredModel = await upgraded.open(p.id), restored = restoredModel.read();
  assert.equal(restored.project.episodes[0].actual_duration_seconds, 11.3);
  assert.equal(restored.project.episodes[0].story_outline.node_state.dependency_hash, "a".repeat(64));
  assert.equal(restored.project.episodes[0].story_outline.segments[0].body, "故事");
  assert.equal(restored.tasks.find(t => t.id === queued.task_id).previous_node_state.status, "expired");
  assert.equal(restored.project.episodes[0].assembly.node_state.status, "expired");
  const recovering = new TaskService({ repository: upgraded, execute: async () => { throw Error("不执行旧任务"); } });
  await recovering.recover(restoredModel);
  assert.equal(restoredModel.read().project.episodes[0].story_outline.node_state.status, "expired");
  assert.equal(restoredModel.read().tasks.find(t => t.id === queued.task_id).task_status, "superseded");
  await recovering.dispose(); await upgraded.close();
  const check = new DatabaseSync(path);
  assert.equal(check.prepare("PRAGMA user_version").get().user_version, 7);
  assert.deepEqual(check.prepare("SELECT * FROM tasks WHERE task_status='completed'").all(), historicalTasks);
  assert.deepEqual(check.prepare("SELECT * FROM task_steps WHERE task_id=?").all(completed.task_id), historicalSteps);
  check.close();
  const once = new ModelRepository(root); await once.open(p.id); await once.close();
  assert.equal((await readdir(root)).filter(name => name.includes("before-v7")).length, 1);
}));

test("SQLite v4→v7：非法项目导致整个数据修订回滚", () => fixture(async root => {
  const repo = new ModelRepository(root), p = projectFixture();
  await repo.create(p); await repo.close();
  const path = join(root, "meiji.sqlite"), db = new DatabaseSync(path);
  const bad = structuredClone(p); bad.episodes[0].id = p.id;
  const original = JSON.stringify(bad);
  db.prepare("UPDATE projects SET data_json=? WHERE id=?").run(original, p.id);
  db.exec("DELETE FROM schema_migrations WHERE version>=5; PRAGMA user_version=4");
  db.close();
  const broken = new ModelRepository(root);
  await assert.rejects(broken.open(p.id), /重复 ID/);
  const check = new DatabaseSync(path);
  assert.equal(check.prepare("PRAGMA user_version").get().user_version, 4);
  assert.equal(check.prepare("SELECT data_json FROM projects WHERE id=?").get(p.id).data_json, original);
  assert.equal(check.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version=5").get().n, 0);
  check.close();
  const backups = (await readdir(root)).filter(name => name.includes("before-v7"));
  assert.equal(backups.length, 1);
  const backup = new DatabaseSync(join(root, backups[0]));
  assert.equal(backup.prepare("SELECT data_json FROM projects WHERE id=?").get(p.id).data_json, original);
  backup.close();
}));

for (const queued of [false, true]) test(`v4 数据修订：已有${queued ? "排队快照" : "节点"}过期且 hash 相同，仍向下游传播`, () => {
  const project = projectFixture(), episode = project.episodes[0];
  const state = { status: "expired", reason: "剧情已修改" };
  const tasks = queued ? [{ business_type: "outline", target_id: episode.id, task_status: "queued", previous_node_state: state }] : [];
  Object.assign(episode.story_outline.node_state, queued ? { status: "queued", reason: "" } : state);
  const hash = episode.shot_list.node_state.dependency_hash;
  migrateEpisodeNodesV4({ project, tasks, steps: [] });
  assert.equal(episode.shot_list.node_state.status, "expired");
  assert.equal(episode.shot_list.node_state.dependency_hash, hash);
  assert.equal(episode.shot_list.shots[0].video.node_state.status, "expired");
});

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
    assert.equal(s.runtime.requests.length, point === "after-commit" ? 1 : 0);
    if (point === "after-commit") assert.equal((await model.update("crash", {}, () => { throw Error("重复执行"); })).saved, true);
  } finally { await restored.close(); }
}));
