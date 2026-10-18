import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createAppRuntime } from "../server/runtime/app-runtime.js";
import { buildSplit } from "../server/handlers/script-split.js";
import { composeNodePrompt } from "../server/http/ai-routes.js";
import { taskNodeInput } from "../server/handlers/node-inputs.js";
import { emptyProject, emptyEpisode } from "../shared/project_contract.js";
import { approveScriptReview, taskFixture, snapshotFixture } from "./fixtures/project.js";
import { DatabaseSync } from "node:sqlite";
import { JSDOM } from "jsdom";
import { ModelRepository } from "../server/data/model-repository.js";
import { precheck } from "../server/flow/tasks/precheck.js";
import { validateCommand } from "../shared/task_contract.js";
import { nodeRoutes } from "../server/http/nodes/index.js";
import { renderTaskPanel } from "../client/task-panel.js";
import { splitBudget } from "../server/prompts/duration-policy.js";
import { commitContent } from "../server/handlers/content.js";

describe("script-split", () => {
  const script = '甲为寻找兄长进入旧城。乙藏起真相。甲找到线索，最终救出兄长。';
  const rows = [
    { 序号: 1, 本集规划: '甲进入旧城寻找兄长，与乙发生冲突；获得被隐瞒的线索，结尾决定追查。', 预估时长秒: 150 },
    { 序号: 2, 本集规划: '承接甲追查线索，乙坦白隐情；甲救出兄长，回收失踪伏笔并结束主线。', 预估时长秒: 150 },
  ];
  const plan = () => ({ 剧集: structuredClone(rows) });
  async function scenario(chat, run) {
    const home = await mkdtemp(join(tmpdir(), 'meiji-planning-'));
    let runtime;
    try {
      runtime = await createAppRuntime({ home, gateway: { chat } });
      const project = emptyProject({ creation_mode: '剧本' });
      project.script.body = script; approveScriptReview(project);
      const model = await runtime.repository.create(project);
      const submit = (action = 'generate') => runtime.tasks.command({ type:'submit', project_id:project.id, target_id:project.id, business_type:'script-split', action, request_id:randomUUID() });
      await run({ home, runtime, project, model, submit });
    } finally { await runtime?.dispose(); await rm(home,{recursive:true,force:true}); }
  }

  test('全集规划保存AI安排而非拼接原文，保留原剧本且不预生成分集正文', () => {
    const raw = plan(), before = structuredClone(raw), result = buildSplit(script, raw, 150);
    assert.deepEqual(raw,before);
    assert.deepEqual(result.episodes.map(e=>e.plot),rows.map(r=>r.本集规划));
    assert.notEqual(result.episodes.map(e=>e.plot).join(''),script);
    assert.deepEqual(result.episodes.map(e=>e.sequence),[1,2]);
  });
  for (const [name, mutate, pattern] of [
    ['空剧集', x=>x.剧集=[], /没有返回剧集/],
    ['跳号', x=>x.剧集[1].序号=3, /连续/],
    ['空规划', x=>x.剧集[0].本集规划=' ', /非空/],
    ['非文本规划', x=>x.剧集[0].本集规划=[], /非空/],
    ['小数时长', x=>x.剧集[0].预估时长秒=150.5, /整数/],
    ['时长过短', x=>x.剧集[0].预估时长秒=119, /120—180/],
    ['时长过长', x=>x.剧集[0].预估时长秒=181, /120—180/],
    ['旧切点协议', x=>x.剧集[0].起始段落='P001', /未定义字段/],
    ['旧排除协议', x=>x.排除段落=[], /未定义字段/],
  ]) test(`全集规划拒绝${name}，不改调用方数据`,()=>{
    const raw=plan();mutate(raw);const before=structuredClone(raw);
    assert.throws(()=>buildSplit(script,raw,150),pattern);assert.deepEqual(raw,before);
  });
  test('空剧本不创建规划',()=>assert.throws(()=>buildSplit(' ',plan(),150),/剧本为空/));
  for(const action of ['generate','regenerate','review']) test(`全集规划${action}请求传完整原文且使用同一改编边界`,()=>{
    const input={language:'zh-CN',requirements:'保留结局',script,duration:150,opinion:'改善交接',...(action==='generate'?{}:{content:plan()})};
    const prompt=composeNodePrompt('script-split',action,input,'codex-gpt');
    assert.ok(prompt.messages.some(m=>m.content.includes(script)));
    assert.match(prompt.system,/允许调整支线/);assert.match(prompt.system,/伏笔/);
    assert.doesNotMatch(prompt.system,/程序按归入段落拼接|不能改写剧本/);
  });
  test('全集规划真实任务只创建计划，JSON镜像与数据库一致',()=>scenario(async({step})=>step.kind==='review'?{是否通过:true,类型:'',原因:''}:plan(),async({runtime,project,model,submit,home})=>{
    const result=await submit();await runtime.tasks.idle(project.id);
    const snapshot=model.readAll();assert.equal(snapshot.tasks.find(t=>t.id===result.task_id).task_status,'completed');
    assert.deepEqual(snapshot.project.episodes.map(e=>e.plot),rows.map(r=>r.本集规划));
    assert.ok(snapshot.project.episodes.every(e=>e.story_outline.segments.length===0));
    assert.equal(snapshot.project.script.body,script);
    const mirror=JSON.parse(await readFile(join(home,'storages','meiji','projects',project.id,'project.json'),'utf8'));
    assert.deepEqual(mirror,snapshot.project);
  }));
  test('全集规划网络失败后新任务成功，旧失败记录不改写',async()=>{
    let calls=0;
    await scenario(async({step})=>{if(step.kind==='review')return{是否通过:true,类型:'',原因:''};if(++calls===1)throw Error('HTTP 503');return plan();},async({runtime,project,model,submit})=>{
      const first=await submit();await runtime.tasks.idle(project.id);
      const second=await submit();await runtime.tasks.idle(project.id);
      assert.equal(model.readAll().tasks.find(t=>t.id===first.task_id).task_status,'failed');
      assert.equal(model.readAll().tasks.find(t=>t.id===second.task_id).task_status,'completed');
    });
  });
  test('规划时长校验进入修订，下一轮修复后才替换剧集',async()=>{
    let calls=0;
    await scenario(async({step,messages})=>{
      if(step.kind==='review')return{是否通过:true,类型:'',原因:''};
      const value=plan();if(++calls===1)value.剧集[1].预估时长秒=65;
      else assert.match(messages.at(-1).content,/第2集/);
      return value;
    },async({runtime,project,model,submit})=>{
      const result=await submit();await runtime.tasks.idle(project.id);
      assert.equal(model.readAll().tasks.find(t=>t.id===result.task_id).task_status,'completed');assert.equal(calls,2);
    });
  });
  test('AI审核拒绝规划后可人工放行，未通过时不替换旧剧集',()=>scenario(async({step})=>step.kind==='review'?{是否通过:false,类型:'模型问题',原因:'第1集的转折与后集交接需改善'}:plan(),async({runtime,project,model,submit})=>{
    const result=await submit();await runtime.tasks.idle(project.id);
    assert.equal(model.readAll().tasks.find(t=>t.id===result.task_id).task_status,'rejected');
    assert.equal(model.read().project.episodes.length,0);
    const override=await runtime.tasks.command({type:'override',project_id:project.id,target_id:project.id,business_type:'script-split',request_id:randomUUID()});
    await runtime.tasks.idle(project.id);assert.equal(model.readAll().tasks.find(t=>t.id===override.task_id).task_status,'completed');
    assert.equal(model.read().project.episodes.length,2);
  }));
  test('现有规划修订基稿直接取各集规划，不反推原文段落',()=>{
    const project=emptyProject({creation_mode:'剧本'});project.script.body=script;
    project.episodes=rows.map(row=>emptyEpisode({sequence:row.序号,plot:row.本集规划,duration_seconds:row.预估时长秒}));
    const task=taskFixture(project,'script-split',project.id,{action:'revise',opinion:'调整结尾钩子'});
    const input=taskNodeInput({project,tasks:[],steps:[]},task,null,'regenerate');
    assert.deepEqual(input.content,plan());
  });
});

describe("script-review", () => {
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
});

describe("split-hard-duration", () => {
  const row = (序号, 预估时长秒) => ({ 序号, 本集规划: `第${序号}集：甲发现证据，乙确认事实，结尾交接后续。`, 预估时长秒 });
  const candidate = (...剧集) => ({ 剧集 });
  const script = '室内，甲取出证据。乙逐项核对。甲说明来由。乙确认结果。';

  for (const reference of [60, 150, 300]) test(`参考${reference}秒固定±30，边界允许，单单位与末集不豁免`, () => {
    const min = reference - 30, max = reference + 30;
    assert.deepEqual(splitBudget(reference), { target_seconds: reference, min_seconds: min, max_seconds: max, tolerance_seconds: 30 });
    for (const seconds of [min, max]) {
      const value = buildSplit('甲：完整发言。', candidate(row(1, seconds)), reference);
      assert.equal(value.episodes[0].duration_seconds, seconds);
    }
    for (const seconds of [min - 1, max + 1]) {
      const raw = candidate(row(1, reference), row(2, seconds));
      const before = structuredClone(raw);
      assert.throws(() => buildSplit(script, raw, reference), error => error.code === 'INVALID_CONTRACT' && error.message.includes('第2集') && /秒内的整数/.test(error.message));
      assert.deepEqual(raw, before);
      assert.throws(() => buildSplit('甲：完整发言。', candidate(row(1, seconds)), reference), /秒内的整数/);
    }
  });

  test('生成、修订、审核均从项目参考值获得同一固定秒数范围', () => {
    for (const duration of [60, 300]) for (const action of ['generate', 'regenerate', 'review']) {
      const prompt = composeNodePrompt('script-split', action, { language: 'zh-CN', requirements: '', script, duration, opinion: '检查切点', ...(action === 'generate' ? {} : { content: candidate(row(1, duration)) }) }, 'codex-gpt');
      assert.match(prompt.body, new RegExp(`"min_seconds": ${duration - 30}`));
      assert.match(prompt.body, new RegExp(`"max_seconds": ${duration + 30}`));
      assert.doesNotMatch(prompt.body, /最后一集可以更短|单个不可拆发言可以独立超|单独成集并填写真实时长/);
    }
    assert.equal(splitBudget(20).min_seconds, 1);
  });

  test('短尾集进入程序修订，调整规划后保存新的集间安排', async () => {
    const home = await mkdtemp(join(tmpdir(), 'meiji-split-short-tail-'));
    let runtime, calls = 0;
    const first = candidate(row(1, 150), row(2, 65));
    const fixed = candidate(row(1, 120), row(2, 120));
    try {
      runtime = await createAppRuntime({ home, gateway: { chat: async ({ step, messages }) => {
        if (step.kind === 'review') return { 是否通过: true, "类型": "", 原因: '' };
        if (++calls > 1) {
          assert.match(messages.at(-1).content, /第2集.*120—180秒/s);
          assert.match(messages.at(-1).content, /调整集数和事件安排/);
        }
        return calls === 1 ? first : fixed;
      } } });
      const project = emptyProject({ name: '同情景跨集', creation_mode: '剧本' });
      project.script.body = script; approveScriptReview(project);
      project.episodes = [emptyEpisode({ plot: '旧剧集' })];
      const model = await runtime.repository.create(project);
      const result = await runtime.tasks.command({ type: 'submit', project_id: project.id, target_id: project.id, business_type: 'script-split', action: 'regenerate', request_id: randomUUID() });
      await runtime.tasks.idle(project.id);
      const snapshot = model.readAll(), task = snapshot.tasks.find(t => t.id === result.task_id);
      assert.equal(task.task_status, 'completed', task.end_reason);
      assert.equal(calls, 2);
      assert.deepEqual(snapshot.project.episodes.map(e => e.plot), fixed.剧集.map(row => row.本集规划));
      assert.deepEqual(snapshot.project.episodes.map(e => e.duration_seconds), [120, 120]);
      assert.equal(snapshot.steps.filter(s => s.kind === 'review' && s.step_status === 'rejected').length, 1);
    } finally { await runtime?.dispose(); await rm(home, { recursive: true, force: true }); }
  });

  test('人工放行与提交均拦短集，数值合规的AI拒绝候选仍可人工放行', async () => {
    const home = await mkdtemp(join(tmpdir(), 'meiji-split-hard-override-'));
    let runtime, seconds = 65;
    try {
      runtime = await createAppRuntime({ home, gateway: { chat: async ({ step }) => step.kind === 'review' ? { 是否通过: false, "类型": "模型问题", 原因: '测试语义意见' } : candidate(row(1, seconds)) } });
      const project = emptyProject({ name: '硬条件放行', creation_mode: '剧本' });
      project.script.body = script; approveScriptReview(project);
      project.episodes = [emptyEpisode({ plot: '旧正式剧情' })];
      const old = structuredClone(project.episodes);
      const short = candidate(row(1, 65));
      for (const action of ['override', 'regenerate']) {
        assert.throws(() => commitContent({ project }, { business_type: 'script-split', target_id: project.id, action }, short), /120—180秒/);
        assert.deepEqual(project.episodes, old);
      }
      const model = await runtime.repository.create(project);
      const command = action => runtime.tasks.command({ type: action === 'override' ? 'override' : 'submit', project_id: project.id, target_id: project.id, business_type: 'script-split', ...(action === 'override' ? {} : { action }), request_id: randomUUID() });
      for (const current of [65, 150]) {
        seconds = current;
        const generated = await command('regenerate'); await runtime.tasks.idle(project.id);
        assert.equal(model.readAll().tasks.find(t => t.id === generated.task_id).task_status, 'rejected');
        const accepted = await command('override'); await runtime.tasks.idle(project.id);
        const snapshot = model.readAll(), task = snapshot.tasks.find(t => t.id === accepted.task_id);
        assert.equal(task.task_status, current === 65 ? 'rejected' : 'completed', task.end_reason);
        if (current === 65) {
          assert.match(task.end_reason, /120—180秒/);
          assert.deepEqual(snapshot.project.episodes, old);
        } else {
          assert.match(snapshot.project.episodes[0].plot, /甲发现证据/);
          assert.equal(snapshot.project.episodes[0].duration_seconds, 150);
        }
      }
    } finally { await runtime?.dispose(); await rm(home, { recursive: true, force: true }); }
  });
});
