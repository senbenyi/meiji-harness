import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { JSDOM } from "jsdom";
import { createAppRuntime } from "../server/runtime/app-runtime.js";
import { ModelRepository } from "../server/data/model-repository.js";
import { precheck } from "../server/flow/tasks/precheck.js";
import { validateCommand } from "../shared/task_contract.js";
import { expireDownstream } from "../shared/node-dependencies.js";
import { nodeRoutes } from "../server/http/nodes/index.js";
import { emptyProject } from "../shared/project_contract.js";
import { renderTaskPanel } from "../client/task-panel.js";
import { approveScriptReview, snapshotFixture } from "./fixtures/project.js";

const script = "第一场 酒馆\n武松喝酒。\n第二场 景阳冈\n武松打虎。";
const reason = '旧剧本审核未通过';

async function withRuntime(work) {
  const home = await mkdtemp(join(tmpdir(), 'meiji-no-script-review-'));
  let runtime; const calls=[];
  try {
    runtime=await createAppRuntime({home,sessionController:{create:async()=>({sessionId:`session-${randomUUID()}`}),resolveAgent:async()=>({agent:null})},gateway:{chat:async options=>{calls.push(options);throw Error('导入不应调用模型')}}});
    await work(runtime,calls);
  } finally {await runtime?.dispose();await rm(home,{recursive:true,force:true});}
}
test('导入剧本只创建项目，不创建审核任务且不调用模型',()=>withRuntime(async(runtime,calls)=>{
  const result=await runtime.projectCommand({type:'create',fields:{name:'原始剧本',creation_mode:'剧本',script:{body:script}}},null);
  await runtime.tasks.idle(result.project_id);
  const snapshot=(await runtime.repository.open(result.project_id)).readAll();
  assert.equal(snapshot.tasks.length,0);assert.equal(snapshot.groups.length,0);assert.equal(calls.length,0);
  assert.equal(snapshot.project.script.body,script);
  assert.equal(result.script_review_task_id,undefined);
}));
for(const status of ['empty','rejected','expired','generated'])test(`原剧本状态${status}不拦截全集规划与提取人物`,()=>{
  const snapshot=snapshotFixture(),p=snapshot.project;
  Object.assign(p.script.node_state,{status,reason:status==='rejected'||status==='expired'?reason:''});
  for(const business of ['script-split','project-characters'])
    assert.equal(precheck(snapshot,{business_type:business,target_id:p.id,action:'generate'}).passed,true);
  p.script.body='';
  for(const business of ['script-split','project-characters'])
    assert.throws(()=>precheck(snapshot,{business_type:business,target_id:p.id,action:'generate'}),/剧本为空/);
});
test('剧本审核路由和执行命令已退役，查询历史仍可用',()=>{
  assert.equal(nodeRoutes['script-review'],undefined);
  const base={project_id:'p_'+randomUUID(),target_id:'p_'+randomUUID(),request_id:'retired',business_type:'script-review'};
  for(const command of [{type:'submit',action:'generate'},{type:'submit',action:'revise',opinion:'修改'},{type:'override'},{type:'manual-edit',content:'新文本'}])
    assert.throws(()=>validateCommand({...base,...command}),/剧本审核已移除/);
  assert.doesNotThrow(()=>validateCommand({type:'query',project_id:base.project_id,task_id:'t_'+randomUUID()}));
});
test('概览剧本仅展示原文入口，不提供审核、修改或放行',()=>{
  const dom=new JSDOM('<main></main>'),saved=globalThis.document;globalThis.document=dom.window.document;
  try{
    const snapshot=snapshotFixture(),root=document.querySelector('main');snapshot.project.creation_mode='剧本';
    Object.assign(snapshot.project.script.node_state,{status:'rejected',reason});
    renderTaskPanel(root,snapshot,{session_id:'s',view:{page:'overview'},refresh:async()=>{},onError:assert.fail});
    assert.ok(root.querySelector('.script-title-row'));assert.equal(root.querySelector('[data-business="script-review"]'),null);
    assert.doesNotMatch(root.textContent,/AI审核|重新审核|旧剧本审核未通过/);
  }finally{globalThis.document=saved;dom.window.close();}
});

test("v15→v18：旧项目补剧本节点状态；v16 独立 script_review 并入剧本；v17 审核结论字段移除并保留状态", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-v18-"));
  try {
    let repo = new ModelRepository(root);
    const projects = ["v15", "v16", "v17"].map(name => { const p = emptyProject({ name, creation_mode: "剧本" }); p.script.body = script; return approveScriptReview(p); });
    for (const p of projects.slice(1)) Object.assign(p.script.node_state, { status: "rejected", reason });
    for (const p of projects) await repo.create(p);
    await repo.close();
    let db = new DatabaseSync(join(root, "meiji.sqlite"));
    const update = db.prepare("UPDATE projects SET data_json=? WHERE id=?");
    for (const row of db.prepare("SELECT id,data_json FROM projects").all()) {
      const project = JSON.parse(row.data_json), state = project.script.node_state, name = project.name;
      delete project.script.node_state;
      if (name === "v16") project.script_review = { node_state: state, has_result: true, suggestions: reason };
      if (name === "v17") project.script = { ...project.script, node_state: state, review: { has_result: true, suggestions: reason } };
      update.run(JSON.stringify(project), row.id);
    }
    db.exec("DELETE FROM schema_migrations WHERE version>=16; PRAGMA user_version=15");
    db.close();
    repo = new ModelRepository(root);
    const [v15, v16, v17] = await Promise.all(projects.map(async p => (await repo.open(p.id)).read().project));
    assert.equal(v15.script.node_state.status, "empty");
    for (const p of [v16, v17]) {
      assert.equal(p.script.node_state.status, "rejected");
      assert.equal(p.script.node_state.reason, reason);
      assert.match(p.script.node_state.dependency_hash, /^[a-f0-9]{64}$/);
    }
    for (const p of [v15, v16, v17]) {
      assert.equal("script_review" in p, false);
      assert.equal("review" in p.script, false);
      assert.equal(p.script.body, script);
    }
    await repo.close();
    db = new DatabaseSync(join(root, "meiji.sqlite"));
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 25);
    assert.deepEqual(db.prepare("SELECT version FROM schema_migrations WHERE version>=16 ORDER BY version").all().map(r => r.version), [16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
    db.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});
