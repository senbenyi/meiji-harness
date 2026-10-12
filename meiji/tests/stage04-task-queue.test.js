import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-service.js";
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
              ? { result: { 通过: true, 原因: "" } }
              : { content: { 正文: "新摘要" } }),
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
  id = p.剧集[0].id,
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
        submit(p, "episode-summary", p.剧集[0].id, "same-target"),
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
      if (step.kind === "review") return { result: { 通过: true, 原因: "" } };
      count++;
      running++;
      maximum = Math.max(maximum, running);
      entered.resolve();
      await gate.promise;
      running--;
      return { content: { 正文: "新摘要" } };
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
        ? { result: { 通过: !first, 原因: first ? "剧情未通过" : "" } }
        : { content: { 正文: "新摘要" } },
  );
});
test("面板重试同一失败节点直接启动新任务并保留失败历史", async () => {
  let failReview = true;
  await withService(
    async ({ p, model, service }) => {
      const failed = await service.command(submit(p));
      await service.idle(p.id);
      assert.equal(model.read().tasks[0].task_status, "failed");
      assert.equal(model.read().project.剧集[0].摘要.状态, "failed");
      assert.equal(model.read().runtime.queue_stopped, true);

      const retry = submit(p, "episode-summary", p.剧集[0].id, "retry");
      retry.action = "generate";
      const retried = await service.command(retry);
      assert.notEqual(retried.task_id, failed.task_id);
      assert.equal(model.read().runtime.queue_stopped, false);
      await service.idle(p.id);

      assert.equal(model.read().tasks[0].task_status, "failed");
      assert.equal(model.read().tasks[1].task_status, "completed");
      assert.equal(model.read().tasks[1].action, "regenerate");
      assert.equal(model.read().project.剧集[0].摘要.状态, "generated");

      await model.update("pause-after-retry", {}, (s) => {
        s.runtime.queue_stopped = true;
      });
      const later = submit(p, "episode-summary", p.剧集[0].id, "ordinary-after-retry");
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
        return { result: { 通过: true, 原因: "" } };
      }
      return { content: { 正文: "重试后摘要" } };
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
        p.剧集[0].id,
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
      return { content: { 正文: "内容" } };
    },
  );
});
test("面板重试已排队的同节点请求时复用并校正为重新生成", async () => {
  let failReview = true;
  await withService(
    async ({ p, model, service }) => {
      await service.command(submit(p));
      await service.idle(p.id);
      const pending = submit(p, "episode-summary", p.剧集[0].id, "session-retry");
      pending.action = "generate";
      const queued = await service.command(pending, {
        source: "session",
        session_id: "session-test",
      });
      await service.idle(p.id);
      assert.equal(model.read().tasks[1].task_status, "queued");
      assert.equal(model.read().runtime.queue_stopped, true);

      const retry = submit(p, "episode-summary", p.剧集[0].id, "panel-retry");
      retry.action = "generate";
      const started = await service.command(retry);
      assert.equal(started.task_id, queued.task_id);
      await service.idle(p.id);

      assert.equal(model.read().tasks.length, 2);
      assert.equal(model.read().tasks[0].task_status, "failed");
      assert.equal(model.read().tasks[1].task_status, "completed");
      assert.equal(model.read().tasks[1].action, "regenerate");
      assert.equal(model.read().project.剧集[0].摘要.状态, "generated");
    },
    async ({ step }) => {
      if (step.kind === "review") {
        if (failReview) {
          failReview = false;
          throw new Error("JSON 解析失败");
        }
        return { result: { 通过: true, 原因: "" } };
      }
      return { content: { 正文: "重试后摘要" } };
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
      assert.equal(model.read().project.剧集[0].摘要.正文, "展示摘要");
      assert.equal(model.read().tasks[1].task_status, "queued");
    },
    async () => {
      entered.resolve();
      await gate.promise;
      return { content: { 正文: "晚到结果" } };
    },
  );
});
test("S4-03 precheck 失败不调用 AI，原因写节点，旧稿保留", () =>
  withService(
    async ({ p, model, service }) => {
      await model.update("expire-upstream", {}, (s) => {
        s.project.剧集[0].故事大纲.状态 = "expired";
        s.project.剧集[0].故事大纲.原因 = "过期";
        return {};
      });
      await service.command(submit(p));
      await service.idle(p.id);
      assert.equal(model.read().tasks[0].task_status, "failed");
      assert.equal(model.read().project.剧集[0].摘要.正文, "展示摘要");
    },
    async () => {
      throw new Error("不应调用 AI");
    },
  ));
