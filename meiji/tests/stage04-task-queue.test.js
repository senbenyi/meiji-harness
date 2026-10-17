import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-manager.js";
import { commitContent } from "../server/handlers/content.js";
import { projectFixture } from "./fixtures/project.js";
import { nodeOf } from "../shared/task_contract.js";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
export async function withService(work, execute) {
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
  project_id: p.id,
  request_id: key,
  business_type: business,
  target_id: id,
  action: "regenerate",
});

test("S4-01/02 同节点去重与项目串行，可控 Promise 确認实际时序", async () => {
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
      await service.command(submit(p, "project-summary", p.id, "second"));
      assert.equal(
        model.readAll().tasks.filter((t) => t.task_status === "running").length,
        1,
      );
      gate.resolve();
      await service.idle(p.id);
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
    await service.command(submit(p,"project-summary",p.id,"next"));
    gate.resolve(); await service.idle(p.id);
    const old = model.readAll().tasks;
    assert.deepEqual(old.map(t=>t.task_status),["rejected","cancelled"]);
    reject=false;
    await service.command(submit(p,"project-summary",p.id,"fresh"));
    await service.idle(p.id);
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
      await service.idle(p.id);
      assert.equal(model.readAll().tasks[0].task_status, "failed");
      assert.equal(model.readAll().project.episodes[0].summary.node_state.status, "generated");


      const retry = submit(p, "episode-summary", p.episodes[0].id, "retry");
      retry.action = "generate";
      const retried = await service.command(retry);
      assert.notEqual(retried.task_id, failed.task_id);

      await service.idle(p.id);

      assert.equal(model.readAll().tasks[0].task_status, "failed");
      assert.equal(model.readAll().tasks[1].task_status, "completed");
      assert.equal(model.readAll().tasks[1].action, "regenerate");
      assert.equal(model.readAll().project.episodes[0].summary.node_state.status, "generated");

      const later = submit(p, "episode-summary", p.episodes[0].id, "ordinary-after-retry");
      later.action = "generate";
      const ordinary = await service.command(later);
      await service.idle(p.id);
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
    await service.command(submit(p)); await service.idle(p.id);
    assert.equal(model.readAll().tasks[0].task_status,"failed"); fail=false;
    await service.command(submit(p,"project-summary",p.id,"session-next"),{source:"session",session_id:"session-test"});
    await service.idle(p.id);
    assert.equal(model.readAll().tasks[1].task_status,"completed");
  },async ({step}) => {
    if(fail)throw Error("模拟HTTP断连");
    return step.kind === "review" ? {result:{是否通过:true, "类型": "",原因:""}} : {content:{body:"摘要"}};
  });
});
test("S4-07 运行取消后晚到模型不写内容，剩余任务全部取消", async () => {
  const entered = deferred(),
    gate = deferred();
  await withService(
    async ({ p, model, service }) => {
      const task = await service.command(submit(p));
      await entered.promise;
      await service.command(submit(p, "project-summary", p.id, "next"));
      await service.command({
        type: "cancel",
        project_id: p.id,
        request_id: "cancel",
        task_id: task.task_id,
      });
      gate.resolve();
      await service.idle(p.id);
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
test("S4-03 precheck 未通过不调用 AI，原因写节点，旧稿保留", () =>
  withService(
    async ({ p, model, service }) => {
      await model.update("expire-upstream", {}, (s) => {
        s.project.episodes[0].plot = "";
        return {};
      });
      await service.command(submit(p));
      await service.idle(p.id);
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
    await service.command(submit(p, "project-summary", p.id, "reject"));
    await service.idle(p.id);
    const before = model.readAll();
    assert.equal(calls, 3);
    assert.equal(before.tasks[0].task_status, "rejected");
    assert.equal(before.project.project_summary.body, "候选3");
    assert.equal(before.project.project_summary.node_state.reason, "剧情来源不符");
    assert.equal(before.project.project_summary.node_state.dependency_hash, "a".repeat(64));
    assert.deepEqual(before.steps.filter(s => s.kind === "review").map(s => [s.round, s.step_status, s.error_reason]), [[0,"rejected","剧情来源不符"],[1,"rejected","剧情来源不符"],[2,"rejected","剧情来源不符"]]);
    reject = false;
    await service.command({ ...submit(p, "project-summary", p.id, "retry-rejected"), opinion: "保留结局" });
    await service.idle(p.id);
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
    await service.idle(p.id);
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
    const command = { ...submit(p, "project-summary", p.id, "empty-first"), action: "generate" };
    await service.command(command);
    await service.idle(p.id);
    assert.equal(model.readAll().tasks[0].task_status, "failed");
    fail = false;
    await service.command({ ...command, request_id: "empty-retry" });
    await service.idle(p.id);
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
    const other=projectFixture(), otherModel=await repository.create(other); otherId=other.id;
    assert.deepEqual(service.current(model),{status:'idle',tasks:[]});
    await service.command(submit(p));
    await entered.promise;
    await service.command(submit(other)); await otherEntered.promise;
    const queued=await service.command(submit(p,'project-summary',p.id,'next'));
    assert.equal(service.current(model).status,'running');
    const cancel={type:'cancel',project_id:p.id,request_id:'cancel-project',task_id:queued.task_id};
    await service.command(cancel);
    assert.equal(oldSignal.aborted,true);
    assert.deepEqual(service.current(model),{status:'idle',tasks:[]});
    assert.equal(otherModel.readAll().tasks[0].task_status,'running');
    const cancelled=model.readAll().tasks;
    assert.ok(cancelled.every(t=>t.task_status==='cancelled' && t.ended_at));
    const fresh=await service.command(submit(p,'project-summary',p.id,'fresh'));
    assert.equal(service.current(model).status,'queued');
    assert.equal(calls,1,'旧请求清理结束前不得发起新请求');
    await service.command(cancel); // 幂等重放不得影响新任务。
    gate.resolve(); await service.idle(p.id);
    assert.equal(model.readAll().tasks.find(t=>t.id===fresh.task_id).task_status,'completed');
    assert.deepEqual(model.readAll().tasks.slice(0,2),cancelled);
    assert.equal(model.readAll().project.episodes[0].summary.body,p.episodes[0].summary.body);
    assert.equal(model.readAll().project.project_summary.body,'新任务结果');
    assert.deepEqual(service.current(model),{status:'idle',tasks:[]});
    otherGate.resolve(); await service.idle(other.id);
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
    await service.command(submit(p,'project-summary',p.id,'other-group'));
    gate.resolve();await service.idle(p.id);
    assert.deepEqual(model.readAll().tasks.map(t=>t.task_status),['failed','cancelled']);
    assert.equal(model.readAll().tasks[0].end_reason,'HTTP连接已断开');
    assert.deepEqual(service.current(model),{status:'idle',tasks:[]});
  },async()=>{entered.resolve();await gate.promise;throw Error('HTTP连接已断开');});
});
