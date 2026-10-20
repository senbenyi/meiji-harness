import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-manager.js";
import { commitContent } from "../server/handlers/content.js";
import { projectFixture, approveScriptReview } from "./fixtures/project.js";
import { nodeOf } from "../shared/task_contract.js";
import { seedQueuedTasks } from "./fixtures/queued-tasks.js";
import { createTestTextHandler as createTextHandler } from "./fixtures/ai.js";
import { createHandlerRegistry } from "../server/handlers/handler-registry.js";
import { mergeCharacters } from "../shared/collection-identity.js";
import { primaryCostumeImage } from "../shared/models/character_model.js";

describe("task-queue", () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
  };
  async function withService(work, execute) {
    const root = await mkdtemp(join(tmpdir(), "meiji-tasks-"));
    try {
      const repository = new ModelRepository(root),
        p = projectFixture(),
        model = await repository.create(p),
        service = new TaskService({
          repository,
          execute:
            execute ||
            (async ({ snapshot, task, step }) =>
              step.kind === "review"
                ? { result: { 是否通过: true, "类型": "", 原因: "" } }
                : { content: { body: "新摘要" } }),
          commitOutput: commitContent,
        });
      await work({ root, repository, p, model, service });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  const submit = (
    p,
    business = "episode-summary",
    id = p.episodes[0].id,
    key = "submit",
  ) => ({
    type: "submit",
    project_id: p.basic_info.id,
    request_id: key,
    business_type: business,
    target_id: id,
    action: "regenerate",
  });

  test("同节点去重与项目串行，可控 Promise 确認实际时序", async () => {
    const entered = deferred(),
      gate = deferred();
    let count = 0,
      maximum = 0,
      running = 0;
    await withService(
      async ({ p, model, service }) => {
        const a = await service.command(submit(p));
        await entered.promise;
        const duplicate = await service.command(
          submit(p, "episode-summary", p.episodes[0].id, "same-target"),
        );
        assert.equal(a.task_id, duplicate.task_id);
        await service.command(submit(p, "project-summary", p.basic_info.id, "second"));
        assert.equal(
          model.readAll().tasks.filter((t) => t.task_status === "running").length,
          1,
        );
        gate.resolve();
        await service.idle(p.basic_info.id);
        assert.equal(maximum, 1);
        assert.equal(count, 2);
        assert.ok(model.readAll().tasks.every((t) => t.task_status === "completed"));
      },
      async ({ step }) => {
        if (step.kind === "review") return { result: { 是否通过: true, "类型": "", 原因: "" } };
        count++;
        running++;
        maximum = Math.max(maximum, running);
        entered.resolve();
        await gate.promise;
        running--;
        return { content: { body: "新摘要" } };
      },
    );
  });
  test("审核未通过取消跨组排队，新提交自动运行且旧终态不变", async () => {
    const entered = deferred(), gate = deferred(); let reject = true;
    await withService(async ({p,model,service}) => {
      await service.command(submit(p)); await entered.promise;
      await service.command(submit(p,"project-summary",p.basic_info.id,"next"));
      gate.resolve(); await service.idle(p.basic_info.id);
      const old = model.readAll().tasks;
      assert.deepEqual(old.map(t=>t.task_status),["rejected","cancelled"]);
      reject=false;
      await service.command(submit(p,"project-summary",p.basic_info.id,"fresh"));
      await service.idle(p.basic_info.id);
      assert.deepEqual(model.readAll().tasks.slice(0,2),old);
      assert.equal(model.readAll().tasks[2].task_status,"completed");
    },async ({step}) => {
      entered.resolve(); await gate.promise;
      return step.kind === "review" ? {result:{是否通过:!reject, "类型": (!reject) ? "" : "模型问题",原因:reject?"未通过":""}} : {content:{body:"摘要"}};
    });
  });
  test("面板重试同一失败节点直接启动新任务并保留失败历史", async () => {
    let failReview = true;
    await withService(
      async ({ p, model, service }) => {
        const failed = await service.command(submit(p));
        await service.idle(p.basic_info.id);
        assert.equal(model.readAll().tasks[0].task_status, "failed");
        assert.equal(model.readAll().project.episodes[0].summary.node_state.status, "generated");


        const retry = submit(p, "episode-summary", p.episodes[0].id, "retry");
        retry.action = "generate";
        const retried = await service.command(retry);
        assert.notEqual(retried.task_id, failed.task_id);

        await service.idle(p.basic_info.id);

        assert.equal(model.readAll().tasks[0].task_status, "failed");
        assert.equal(model.readAll().tasks[1].task_status, "completed");
        assert.equal(model.readAll().tasks[1].action, "regenerate");
        assert.equal(model.readAll().project.episodes[0].summary.node_state.status, "generated");

        const later = submit(p, "episode-summary", p.episodes[0].id, "ordinary-after-retry");
        later.action = "generate";
        const ordinary = await service.command(later);
        await service.idle(p.basic_info.id);
        assert.equal(model.readAll().tasks.find((task) => task.id === ordinary.task_id).action, "generate");

      },
      async ({ step }) => {
        if (step.kind === "review") {
          if (failReview) {
            failReview = false;
            throw new Error("JSON 解析失败");
          }
          return { result: { 是否通过: true, "类型": "", 原因: "" } };
        }
        return { content: { body: "重试后摘要" } };
      },
    );
  });
  test("失败后会话跨节点提交自动执行，无需面板恢复", async () => {
    let fail = true;
    await withService(async ({p,model,service}) => {
      await service.command(submit(p)); await service.idle(p.basic_info.id);
      assert.equal(model.readAll().tasks[0].task_status,"failed"); fail=false;
      await service.command(submit(p,"project-summary",p.basic_info.id,"session-next"),{source:"session",session_id:"session-test"});
      await service.idle(p.basic_info.id);
      assert.equal(model.readAll().tasks[1].task_status,"completed");
    },async ({step}) => {
      if(fail)throw Error("模拟HTTP断连");
      return step.kind === "review" ? {result:{是否通过:true, "类型": "",原因:""}} : {content:{body:"摘要"}};
    });
  });
  test("运行取消后晚到模型不写内容，剩余任务全部取消", async () => {
    const entered = deferred(),
      gate = deferred();
    await withService(
      async ({ p, model, service }) => {
        const task = await service.command(submit(p));
        await entered.promise;
        await service.command(submit(p, "project-summary", p.basic_info.id, "next"));
        await service.command({
          type: "cancel",
          project_id: p.basic_info.id,
          request_id: "cancel",
          task_id: task.task_id,
        });
        gate.resolve();
        await service.idle(p.basic_info.id);
        assert.equal(model.readAll().tasks[0].task_status, "cancelled");
        assert.equal(model.readAll().project.episodes[0].summary.body, "展示摘要");
        assert.equal(model.readAll().tasks[1].task_status, "cancelled");
      },
      async () => {
        entered.resolve();
        await gate.promise;
        return { content: { body: "晚到结果" } };
      },
    );
  });
  test("precheck 未通过不调用 AI，原因写节点，旧稿保留", () =>
    withService(
      async ({ p, model, service }) => {
        await model.update("expire-upstream", {}, (s) => {
          s.project.episodes[0].plot = "";
          return {};
        });
        await service.command(submit(p));
        await service.idle(p.basic_info.id);
        assert.equal(model.readAll().tasks[0].task_status, "rejected");
        assert.equal(model.readAll().project.episodes[0].summary.body, "展示摘要");
      },
      async () => {
        throw new Error("不应调用 AI");
      },
    ));

  test("审核耗尽保留候选与拒绝原因，不刷新 hash；新任务合并原因和用户意见", async () => {
    let calls = 0, reject = true;
    await withService(async ({ p, model, service }) => {
      await model.update("hash", {}, s => { s.project.project_summary.node_state.dependency_hash = "a".repeat(64); });
      await service.command(submit(p, "project-summary", p.basic_info.id, "reject"));
      await service.idle(p.basic_info.id);
      const before = model.readAll();
      assert.equal(calls, 4);
      assert.equal(before.tasks[0].task_status, "rejected");
      assert.equal(before.project.project_summary.body, "候选4");
      assert.equal(before.project.project_summary.node_state.reason, "剧情来源不符");
      assert.equal(before.project.project_summary.node_state.dependency_hash, "a".repeat(64));
      assert.deepEqual(before.steps.filter(s => s.kind === "review").map(s => [s.round, s.step_status, s.error_reason]), [[0,"rejected","剧情来源不符"],[1,"rejected","剧情来源不符"],[2,"rejected","剧情来源不符"],[3,"rejected","剧情来源不符"]]);
      reject = false;
      await service.command({ ...submit(p, "project-summary", p.basic_info.id, "retry-rejected"), opinion: "保留结局" });
      await service.idle(p.basic_info.id);
      const after = model.readAll();
      assert.equal(after.tasks[1].opinion, "剧情来源不符\n保留结局");
      assert.deepEqual(after.tasks[0], before.tasks[0]);
      assert.equal(after.tasks[1].task_status, "completed");
    }, async ({ step }) => step.kind === "review"
      ? { result: { 是否通过: !reject, "类型": (!reject) ? "" : "模型问题", 原因: reject ? "剧情来源不符" : "" } }
      : { content: { body: `候选${++calls}` } });
  });

  test("程序审核与 AI 审核共用修订次数，程序不通过时跳过该轮 AI 审核", async () => {
    const reviews = [];
    await withService(async ({ p, model, service }) => {
      await service.command(submit(p, "shots", p.episodes[0].id, "dual-review"));
      await service.idle(p.basic_info.id);
      const snapshot = model.readAll();
      assert.equal(snapshot.tasks[0].task_status, "completed", snapshot.tasks[0].end_reason);
      assert.deepEqual(reviews, [[0,"program"],[1,"program"],[1,"ai"],[2,"program"],[2,"ai"]]);
      assert.equal(snapshot.steps.filter(s => s.kind === "revise").length, 2);
      assert.ok(snapshot.steps.some(s => s.kind === "review" && s.round === 0 && s.name.includes("AI审核") && s.step_status === "cancelled"));
    }, async ({ snapshot, task, step, reviewType }) => {
      if (step.kind === "review") {
        reviews.push([step.round, reviewType]);
        const rejected = step.round === 0 || (step.round === 1 && reviewType === "ai");
        return { result: { 是否通过: !rejected, "类型": (!rejected) ? "" : "模型问题", 原因: rejected ? `${reviewType}审核原因` : "" } };
      }
      return { content: { shots: structuredClone(nodeOf(snapshot.project, task.business_type, task.target_id).shots) } };
    });
  });

  test("首次无内容解析失败后，AI生成创建新任务并直接执行", async () => {
    let fail = true;
    await withService(async ({ p, model, service }) => {
      await model.update("empty-summary", {}, s => {
        s.project.project_summary.body = "";
        s.project.project_summary.node_state = { status: "empty", reason: "", dependency_hash: "" };
      });
      const command = { ...submit(p, "project-summary", p.basic_info.id, "empty-first"), action: "generate" };
      await service.command(command);
      await service.idle(p.basic_info.id);
      assert.equal(model.readAll().tasks[0].task_status, "failed");
      fail = false;
      await service.command({ ...command, request_id: "empty-retry" });
      await service.idle(p.basic_info.id);
      const tasks = model.readAll().tasks;
      assert.equal(tasks[1].action, "generate");
      assert.equal(tasks[1].task_status, "completed", tasks[1].end_reason);
    }, async ({ step }) => {
      if (fail) throw new Error("输出无法解析");
      return step.kind === "review" ? { result: { 是否通过: true, "类型": "", 原因: "" } } : { content: { body: "新摘要" } };
    });
  });

  test("从排队节点取消全项目；旧请求退出前新提交等待，迟到结果隔离且跨项目不取消", async () => {
    const entered=deferred(), gate=deferred(), otherEntered=deferred(), otherGate=deferred();
    let otherId, oldSignal, calls=0;
    await withService(async ({p,model,service,repository}) => {
      const other=projectFixture(), otherModel=await repository.create(other); otherId=other.basic_info.id;
      assert.deepEqual(service.current(model),{status:'idle',tasks:[]});
      await service.command(submit(p));
      await entered.promise;
      await service.command(submit(other)); await otherEntered.promise;
      const queued=await service.command(submit(p,'project-summary',p.basic_info.id,'next'));
      assert.equal(service.current(model).status,'running');
      const cancel={type:'cancel',project_id:p.basic_info.id,request_id:'cancel-project',task_id:queued.task_id};
      await service.command(cancel);
      assert.equal(oldSignal.aborted,true);
      assert.deepEqual(service.current(model),{status:'idle',tasks:[]});
      assert.equal(otherModel.readAll().tasks[0].task_status,'running');
      const cancelled=model.readAll().tasks;
      assert.ok(cancelled.every(t=>t.task_status==='cancelled' && t.ended_at));
      const fresh=await service.command(submit(p,'project-summary',p.basic_info.id,'fresh'));
      assert.equal(service.current(model).status,'queued');
      assert.equal(calls,1,'旧请求清理结束前不得发起新请求');
      await service.command(cancel); // 幂等重放不得影响新任务。
      gate.resolve(); await service.idle(p.basic_info.id);
      assert.equal(model.readAll().tasks.find(t=>t.id===fresh.task_id).task_status,'completed');
      assert.deepEqual(model.readAll().tasks.slice(0,2),cancelled);
      assert.equal(model.readAll().project.episodes[0].summary.body,p.episodes[0].summary.body);
      assert.equal(model.readAll().project.project_summary.body,'新任务结果');
      assert.deepEqual(service.current(model),{status:'idle',tasks:[]});
      otherGate.resolve(); await service.idle(other.basic_info.id);
      assert.equal(otherModel.readAll().tasks[0].task_status,'completed');
    },async ({task,step,signal}) => {
      if(step.kind==='review')return {result:{是否通过:true, "类型": "",原因:''}};
      if(task.project_id===otherId){otherEntered.resolve();await otherGate.promise;return {content:{body:'其他项目'}};}
      calls++;
      if(calls===1){oldSignal=signal;entered.resolve();await gate.promise;return {content:{body:'取消后的迟到内容'}};}
      return {content:{body:'新任务结果'}};
    });
  });

  test("HTTP执行失败清空跨组待执行队列并保存失败原因", async () => {
    const entered=deferred(), gate=deferred();
    await withService(async ({p,model,service}) => {
      await service.command(submit(p));await entered.promise;
      await service.command(submit(p,'project-summary',p.basic_info.id,'other-group'));
      gate.resolve();await service.idle(p.basic_info.id);
      assert.deepEqual(model.readAll().tasks.map(t=>t.task_status),['failed','cancelled']);
      assert.equal(model.readAll().tasks[0].end_reason,'HTTP连接已断开');
      assert.deepEqual(service.current(model),{status:'idle',tasks:[]});
    },async()=>{entered.resolve();await gate.promise;throw Error('HTTP连接已断开');});
  });
});

describe("workflow-states", () => {
  const person = {name:'甲',gender:'男',era:'宋代',position:'主角',age_range:'成年',body_type:'高大',hairstyle:'束发',facial_features:'',height:'',nationality:'',voice:'',signature_props:[],immutable_traits:[],costumes:['常服','礼服'].map(name=>({name,color:'蓝',material:'布',props:[]}))};
  const split = {剧集:[{序号:1,本集规划:'前集事件引出本集冲突，人物作出选择并留下后续期待。',预估时长秒:30}]};
  const deferred = () => { let resolve; const promise = new Promise(r=>{resolve=r;}); return {promise,resolve}; };
  async function scenario(work) {
   const root=await mkdtemp(join(tmpdir(),'meiji-state-matrix-'));
   let repo=new ModelRepository(root), service;
   const project=projectFixture(); project.basic_info.reference_episode_duration_seconds=30; project.basic_info.creation_mode='剧本'; project.script_revision.body='宋代，甲穿蓝色常服入门。\n甲换上礼服离开。'; approveScriptReview(project);
   project.character_library.characters=mergeCharacters(project,[person]).characters;
   let model=await repo.create(project), mode='ok', gate, entered, calls=0, failAt=Infinity;
   const execute=createHandlerRegistry({text:createTextHandler({chat:async ctx=>{
    if(ctx.step.kind==='review')return {是否通过:mode!=='reject', "类型": (mode!=='reject') ? "" : "模型问题",原因:mode==='reject'?'角色审核拒绝':''};
    await invoke(ctx);
    return ctx.task.business_type==='script-split' ? (mode==='reject'?{剧集:[]} : split) : {characters:[person]};
   }}),media:async ctx=>{await invoke(ctx);return {content:{address:`${ctx.task.id}.png`}};}});
   async function invoke({signal}) {
    calls++;
    if(mode==='fail'||calls===failAt)throw Error('模拟模型失败');
    if(gate) { entered.resolve(); if(mode==='abort') await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})); else await gate.promise; }
   }
   const start=()=>service=new TaskService({repository:repo,execute,commitOutput:commitContent});start();
   const command=(kind,extra={})=>({type:kind==='costume-image'?'submit-costumes':'submit',project_id:project.basic_info.id,request_id:crypto.randomUUID(),target_id:kind==='costume-image'?project.character_library.characters[0].id:project.basic_info.id,...(kind==='costume-image'?{}:{business_type:kind}),action:kind==='costume-image'?'generate':'regenerate',...extra});
   const api={project,command,get model(){return model;},get service(){return service;},get calls(){return calls;},setMode(value){mode=value;},failOn(value){failAt=value;},block(value='late'){mode=value;gate=deferred();entered=deferred();return entered.promise;},release(){gate?.resolve();gate=null;},async reopen(){await repo.close();repo=new ModelRepository(root);model=await repo.open(project.basic_info.id);start();await service.recover(model);}};
   try {await work(api);} finally {api.release();await service.dispose();await repo.close();await rm(root,{recursive:true,force:true});}
  }

  for(const kind of ['script-split','project-characters','costume-image']) {
   test(`${kind} 失败后继续，旧终态不变且无额外派生`,()=>scenario(async x=>{
    x.setMode('fail');await x.service.command(x.command(kind));await x.service.idle(x.project.basic_info.id);
    const before=x.model.readAll();assert.equal(before.tasks[0].task_status,'failed');
    x.setMode('ok');const next=await x.service.command({type:'continue-group',project_id:x.project.basic_info.id,request_id:'continue',group_id:before.groups[0].id});await x.service.idle(x.project.basic_info.id);
    const after=x.model.readAll();assert.deepEqual(after.tasks.slice(0,before.tasks.length),before.tasks);
    const current=after.tasks.filter(t=>t.group_id===next.group_id);assert.ok(current.every(t=>t.task_status==='completed'),current.map(t=>t.end_reason).join(','));assert.equal(current.length,kind==='costume-image'?2:1);
    if(kind==='script-split')assert.equal(after.project.episodes[0].plot,split.剧集[0].本集规划);
   }));
   test(`${kind} 取消运行任务，晚到结果不覆盖，继续可执行`,()=>scenario(async x=>{
    const entered=x.block();await x.service.command(x.command(kind));await entered;
    const current=x.model.readAll(),task=current.tasks.find(t=>t.task_status==='running');
    await x.service.command({type:'cancel',project_id:x.project.basic_info.id,request_id:'cancel',task_id:task.id});
    const cancelled=x.model.readAll();assert.equal(cancelled.tasks[0].task_status,'cancelled');x.release();await x.service.idle(x.project.basic_info.id);
    assert.deepEqual(x.model.readAll().tasks,cancelled.tasks);assert.deepEqual(x.model.readAll().project,cancelled.project);
    x.setMode('ok');const next=await x.service.command({type:'continue-group',project_id:x.project.basic_info.id,request_id:'resume',group_id:task.group_id});await x.service.idle(x.project.basic_info.id);
    assert.ok(x.model.readAll().tasks.filter(t=>t.group_id===next.group_id).every(t=>t.task_status==='completed'));
   }));
   for(const shutdown of ['late','abort']) test(`${kind} 运行中重启（${shutdown}），作废旧组且恢复后不重放`,()=>scenario(async x=>{
    const entered=x.block(shutdown);await x.service.command(x.command(kind));await entered;
    const beforeStop=x.model.readAll().tasks.map(t=>({id:t.id,task_status:t.task_status}));
    const stop=x.service.dispose();if(shutdown==='late'){await new Promise(r=>setTimeout(r,10));x.release();}await stop;
    const old=x.model.readAll();
    for (const item of beforeStop) {
      const task=old.tasks.find(t=>t.id===item.id);
      const expected=['queued','running'].includes(item.task_status)?'cancelled':item.task_status;
      assert.equal(task.task_status, expected, `${item.id}:${task.end_reason}`);
    }

    const calls=x.calls;x.release();x.setMode('ok');await x.reopen();assert.equal(x.calls,calls);assert.deepEqual(x.model.readAll().tasks,old.tasks);
    const next=await x.service.command({type:'continue-group',project_id:x.project.basic_info.id,request_id:'restart-resume',group_id:old.groups[0].id});await x.service.idle(x.project.basic_info.id);
    assert.ok(x.model.readAll().tasks.filter(t=>t.group_id===next.group_id).every(t=>t.task_status==='completed'));
   }));
   test(`${kind} 尚未调度时重启，恢复原节点并允许新提交`,()=>scenario(async x=>{
    const before=x.model.readAll().project;
    await seedQueuedTasks(x.model, [[kind,kind==='costume-image'?x.project.character_library.characters[0].costumes[0].id:x.project.basic_info.id]]);
    assert.ok(x.model.readAll().tasks.every(t=>t.task_status==='queued'));assert.equal(x.calls,0);
    await x.service.dispose();await x.reopen();assert.ok(x.model.readAll().tasks.every(t=>t.task_status==='cancelled'&&t.end_reason==='服务重启，未完成任务已取消'));assert.deepEqual(x.model.readAll().project,before);
    await x.service.command(x.command(kind));await x.service.idle(x.project.basic_info.id);assert.equal(x.model.readAll().tasks.at(-1).task_status,'completed');
   }));
  }
  for(const kind of ['script-split','project-characters']) test(`${kind} 审核不通过耗尽修订，继续保留原因`,()=>scenario(async x=>{
   x.setMode('reject');await x.service.command(x.command(kind));await x.service.idle(x.project.basic_info.id);const old=x.model.readAll();assert.equal(old.tasks[0].task_status,'rejected');
   x.setMode('ok');const result=await x.service.command({type:'continue-group',project_id:x.project.basic_info.id,request_id:'resume-rejected',group_id:old.groups[0].id});await x.service.idle(x.project.basic_info.id);
   const next=x.model.readAll().tasks.find(t=>t.group_id===result.group_id);assert.equal(next.task_status,'completed',next.end_reason);assert.ok(next.opinion);
  }));

  for(const kind of ['script-split','project-characters','costume-image']) test(`${kind} SIGKILL 后新进程连接恢复真实落盘状态`,async()=>{
   const {fork}=await import('node:child_process');const {once}=await import('node:events');
   const root=await mkdtemp(join(tmpdir(),'meiji-kill-state-'));let repo=new ModelRepository(root),child,service;
   try {
    const project=projectFixture();project.basic_info.creation_mode='剧本';project.character_library.characters=mergeCharacters(project,[person]).characters;
    await repo.create(project);await repo.close();
    child=fork(new URL('./fixtures/workflow-crash.js',import.meta.url),[root,project.basic_info.id,kind],{stdio:['ignore','ignore','ignore','ipc']});
    const [message]=await once(child,'message',{signal:AbortSignal.timeout(10000)});assert.equal(message.event,'running');
    const exited=once(child,'exit');child.kill('SIGKILL');await exited;
    repo=new ModelRepository(root);const model=await repo.open(project.basic_info.id),before=model.readAll();assert.equal(before.tasks[0].task_status,'running');
    service=new TaskService({repository:repo,execute:async()=>{assert.fail('旧任务不能重放');},commitOutput:commitContent});await service.recover(model);
    const after=model.readAll();
    for (const item of before.tasks) {
      const task=after.tasks.find(t=>t.id===item.id);
      const expected=['queued','running'].includes(item.task_status)?'cancelled':item.task_status;
      assert.equal(task.task_status, expected, task.end_reason);
    }
    assert.ok(after.steps.every(st=>['done','cancelled'].includes(st.step_status)));
    assert.deepEqual(after.project.episodes,before.project.episodes);
    if(kind==='costume-image'){const c=after.project.character_library.characters[0];assert.equal(primaryCostumeImage(c).node_state.status,'empty');assert.equal(c.costume_images[1].node_state.status,'empty');}
    const stable=model.readAll();await service.recover(model);assert.deepEqual(model.readAll(),stable);
   }finally{child?.kill('SIGKILL');await service?.dispose();await repo.close();await rm(root,{recursive:true,force:true});}
  });


  test('首套成功后次套失败，重启后继续只做未完成服装',()=>scenario(async x=>{
   x.failOn(2);await x.service.command(x.command('costume-image'));await x.service.idle(x.project.basic_info.id);
   const before=x.model.readAll(),saved=before.project.character_library.characters[0].costume_images[0];
   assert.deepEqual(before.tasks.map(t=>t.task_status),['completed','failed']);
   await x.service.dispose();await x.reopen();
   const next=await x.service.command({type:'continue-group',project_id:x.project.basic_info.id,request_id:'resume-second',group_id:before.groups[0].id});await x.service.idle(x.project.basic_info.id);
   assert.equal(next.task_ids.length,1);assert.equal(x.model.readAll().tasks.at(-1).task_status,'completed');assert.deepEqual(x.model.readAll().project.character_library.characters[0].costume_images[0],saved);
  }));

  test('定妆照全量完成后补齐不重复请求，首套过期则连同后续一起重做',()=>scenario(async x=>{
   await x.service.command(x.command('costume-image'));await x.service.idle(x.project.basic_info.id);assert.equal(x.calls,2);
   const skip=await x.service.command(x.command('costume-image'));assert.deepEqual(skip.task_ids,[]);assert.equal(x.calls,2);
   await x.model.update('expire-first',{},s=>{const first=primaryCostumeImage(s.project.character_library.characters[0]);first.node_state.status='expired';first.node_state.reason='用户资料变化';});
   const next=await x.service.command(x.command('costume-image'));assert.equal(next.task_ids.length,2);await x.service.idle(x.project.basic_info.id);assert.equal(x.calls,4);
  }));

  for(const kind of ['script-split','project-characters','costume-image']) test(`${kind} 前置资料空缺失败，不调用模型`,()=>scenario(async x=>{
   await x.model.update('empty-input',{},s=>{if(kind==='costume-image'){const c=s.project.character_library.characters[0];for(const key of ['name','gender','era','position','age_range','body_type','hairstyle'])c[key]='';}else {s.project.script_revision.body='';s.project.basic_info.original_script='';}});
   await x.service.command(x.command(kind));await x.service.idle(x.project.basic_info.id);assert.equal(x.calls,0);assert.equal(x.model.readAll().tasks[0].task_status,'rejected');assert.equal(x.model.readAll().steps[0].kind,'precheck');assert.equal(x.model.readAll().steps[0].step_status,'rejected');
  }));
});
