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
              ? { result: { 是否通过: true, 原因: "" } }
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
        model.read().tasks.filter((t) => t.task_status === "running").length,
        1,
      );
      gate.resolve();
      await service.idle(p.id);
      assert.equal(maximum, 1);
      assert.equal(count, 2);
      assert.ok(model.read().tasks.every((t) => t.task_status === "completed"));
    },
    async ({ step }) => {
      if (step.kind === "review") return { result: { 是否通过: true, 原因: "" } };
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
test("S4-03 rejected 停住队列，原任务终态不可复活，面板显式开始下一项", async () => {
  let first = true;
  await withService(
    async ({ p, model, service }) => {
      await service.command(submit(p));
      await service.command(submit(p, "project-summary", p.id, "next"));
      await service.idle(p.id);
      const [old, next] = model.read().tasks;
      assert.equal(old.task_status, "rejected");
      assert.equal(next.task_status, "queued");
      assert.equal(model.read().runtime.queue_stopped, true);
      first = false;
      await service.command({
        type: "start-queued",
        project_id: p.id,
        request_id: "start",
        task_id: next.id,
      });
      await service.idle(p.id);
      assert.equal(model.read().tasks[0].task_status, "rejected");
      assert.equal(
        model.read().tasks[1].task_status,
        "completed",
        model.read().tasks[1].end_reason,
      );
    },
    async ({ step }) =>
      step.kind === "review"
        ? { result: { 是否通过: !first, 原因: first ? "剧情未通过" : "" } }
        : { content: { body: "新摘要" } },
  );
});
test("面板重试同一失败节点直接启动新任务并保留失败历史", async () => {
  let failReview = true;
  await withService(
    async ({ p, model, service }) => {
      const failed = await service.command(submit(p));
      await service.idle(p.id);
      assert.equal(model.read().tasks[0].task_status, "failed");
      assert.equal(model.read().project.episodes[0].summary.node_state.status, "failed");
      assert.equal(model.read().runtime.queue_stopped, true);

      const retry = submit(p, "episode-summary", p.episodes[0].id, "retry");
      retry.action = "generate";
      const retried = await service.command(retry);
      assert.notEqual(retried.task_id, failed.task_id);
      assert.equal(model.read().runtime.queue_stopped, false);
      await service.idle(p.id);

      assert.equal(model.read().tasks[0].task_status, "failed");
      assert.equal(model.read().tasks[1].task_status, "completed");
      assert.equal(model.read().tasks[1].action, "regenerate");
      assert.equal(model.read().project.episodes[0].summary.node_state.status, "generated");

      await model.update("pause-after-retry", {}, (s) => {
        s.runtime.queue_stopped = true;
      });
      const later = submit(p, "episode-summary", p.episodes[0].id, "ordinary-after-retry");
      later.action = "generate";
      const ordinary = await service.command(later);
      assert.equal(model.read().tasks.find((task) => task.id === ordinary.task_id).action, "generate");
      assert.equal(model.read().runtime.queue_stopped, true);
    },
    async ({ step }) => {
      if (step.kind === "review") {
        if (failReview) {
          failReview = false;
          throw new Error("JSON 解析失败");
        }
        return { result: { 是否通过: true, 原因: "" } };
      }
      return { content: { body: "重试后摘要" } };
    },
  );
});
test("失败节点重试遇到其他等待任务时冲突，会话重试仍保持暂停", async () => {
  await withService(
    async ({ p, model, service }) => {
      await service.command(submit(p));
      await service.idle(p.id);
      await service.command(
        submit(p, "project-summary", p.id, "session-next"),
        { source: "session", session_id: "session-test" },
      );
      await service.idle(p.id);
      assert.equal(model.read().tasks[1].task_status, "queued");
      assert.equal(model.read().runtime.queue_stopped, true);

      const retry = submit(
        p,
        "episode-summary",
        p.episodes[0].id,
        "retry-conflict",
      );
      retry.action = "generate";
      await assert.rejects(
        service.command(retry),
        (error) =>
          error.code === "TASK_CONFLICT" &&
          error.conflicts.some((task) => task.task_id === model.read().tasks[1].id),
      );
      assert.equal(model.read().runtime.queue_stopped, true);
      assert.equal(model.read().tasks.length, 2);
    },
    async ({ step }) => {
      if (step.kind === "review") throw new Error("解析失败");
      return { content: { body: "内容" } };
    },
  );
});
test("面板重试已排队的同节点请求时复用并校正为重新生成", async () => {
  let failReview = true;
  await withService(
    async ({ p, model, service }) => {
      await service.command(submit(p));
      await service.idle(p.id);
      const pending = submit(p, "episode-summary", p.episodes[0].id, "session-retry");
      pending.action = "generate";
      const queued = await service.command(pending, {
        source: "session",
        session_id: "session-test",
      });
      await service.idle(p.id);
      assert.equal(model.read().tasks[1].task_status, "queued");
      assert.equal(model.read().runtime.queue_stopped, true);

      const retry = submit(p, "episode-summary", p.episodes[0].id, "panel-retry");
      retry.action = "generate";
      const started = await service.command(retry);
      assert.equal(started.task_id, queued.task_id);
      await service.idle(p.id);

      assert.equal(model.read().tasks.length, 2);
      assert.equal(model.read().tasks[0].task_status, "failed");
      assert.equal(model.read().tasks[1].task_status, "completed");
      assert.equal(model.read().tasks[1].action, "regenerate");
      assert.equal(model.read().project.episodes[0].summary.node_state.status, "generated");
    },
    async ({ step }) => {
      if (step.kind === "review") {
        if (failReview) {
          failReview = false;
          throw new Error("JSON 解析失败");
        }
        return { result: { 是否通过: true, 原因: "" } };
      }
      return { content: { body: "重试后摘要" } };
    },
  );
});
test("S4-07 运行取消后晚到模型不写内容，队列不自动继续", async () => {
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
      assert.equal(model.read().tasks[0].task_status, "cancelled");
      assert.equal(model.read().project.episodes[0].summary.body, "展示摘要");
      assert.equal(model.read().tasks[1].task_status, "queued");
    },
    async () => {
      entered.resolve();
      await gate.promise;
      return { content: { body: "晚到结果" } };
    },
  );
});
test("S4-03 precheck 失败不调用 AI，原因写节点，旧稿保留", () =>
  withService(
    async ({ p, model, service }) => {
      await model.update("expire-upstream", {}, (s) => {
        s.project.episodes[0].plot = "";
        return {};
      });
      await service.command(submit(p));
      await service.idle(p.id);
      assert.equal(model.read().tasks[0].task_status, "failed");
      assert.equal(model.read().project.episodes[0].summary.body, "展示摘要");
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
    const before = model.read();
    assert.equal(calls, 3);
    assert.equal(before.tasks[0].task_status, "rejected");
    assert.equal(before.project.project_summary.body, "候选3");
    assert.equal(before.project.project_summary.node_state.reason, "剧情来源不符");
    assert.equal(before.project.project_summary.node_state.dependency_hash, "a".repeat(64));
    assert.deepEqual(before.steps.filter(s => s.kind === "review").map(s => [s.round, s.step_status, s.error_reason]), [[0,"rejected","剧情来源不符"],[1,"rejected","剧情来源不符"],[2,"rejected","剧情来源不符"]]);
    reject = false;
    await service.command({ ...submit(p, "project-summary", p.id, "retry-rejected"), opinion: "保留结局" });
    await service.idle(p.id);
    const after = model.read();
    assert.equal(after.tasks[1].opinion, "剧情来源不符\n保留结局");
    assert.deepEqual(after.tasks[0], before.tasks[0]);
    assert.equal(after.tasks[1].task_status, "completed");
  }, async ({ step }) => step.kind === "review"
    ? { result: { 是否通过: !reject, 原因: reject ? "剧情来源不符" : "" } }
    : { content: { body: `候选${++calls}` } });
});

test("程序审核与 AI 审核共用修订次数，程序不通过时跳过该轮 AI 审核", async () => {
  const reviews = [];
  await withService(async ({ p, model, service }) => {
    await service.command(submit(p, "shots", p.episodes[0].id, "dual-review"));
    await service.idle(p.id);
    const snapshot = model.read();
    assert.equal(snapshot.tasks[0].task_status, "completed", snapshot.tasks[0].end_reason);
    assert.deepEqual(reviews, [[0,"program"],[1,"program"],[1,"ai"],[2,"program"],[2,"ai"]]);
    assert.equal(snapshot.steps.filter(s => s.kind === "revise").length, 2);
    assert.ok(snapshot.steps.some(s => s.kind === "review" && s.round === 0 && s.name.includes("AI审核") && s.step_status === "cancelled"));
  }, async ({ snapshot, task, step, reviewType }) => {
    if (step.kind === "review") {
      reviews.push([step.round, reviewType]);
      const rejected = step.round === 0 || (step.round === 1 && reviewType === "ai");
      return { result: { 是否通过: !rejected, 原因: rejected ? `${reviewType}审核原因` : "" } };
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
    assert.equal(model.read().tasks[0].task_status, "failed");
    fail = false;
    await service.command({ ...command, request_id: "empty-retry" });
    await service.idle(p.id);
    const tasks = model.read().tasks;
    assert.equal(tasks[1].action, "generate");
    assert.equal(tasks[1].task_status, "completed", tasks[1].end_reason);
  }, async ({ step }) => {
    if (fail) throw new Error("输出无法解析");
    return step.kind === "review" ? { result: { 是否通过: true, 原因: "" } } : { content: { body: "新摘要" } };
  });
});
