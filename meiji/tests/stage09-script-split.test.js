import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAppRuntime } from '../server/runtime/app-runtime.js';
import { buildSplit } from '../server/handlers/script-split.js';
import { composeNodePrompt } from '../server/http/ai-routes.js';
import { taskNodeInput } from '../server/handlers/node-inputs.js';
import { emptyProject, emptyEpisode } from '../shared/project_contract.js';
import { approveScriptReview, taskFixture } from './fixtures/project.js';

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
