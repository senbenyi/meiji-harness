import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-service.js";
import { createHandlerRegistry } from "../server/handlers/handler-registry.js";
import { commitContent } from "../server/handlers/content.js";
import { projectFixture } from "./fixtures/project.js";

test("S6-05/06 人工编辑与放行均两步，AI 不调用；非法内容保留旧稿", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-manual-"));
  try {
    const repository = new ModelRepository(root),
      p = projectFixture(),
      model = await repository.create(p),
      execute = createHandlerRegistry({
        text: () => {
          throw new Error("不得调用 AI");
        },
        media: () => {
          throw new Error("不得调用媒体");
        },
      }),
      service = new TaskService({
        repository,
        execute,
        commitOutput: commitContent,
      });
    const base = {
      project_id: p.id,
      business_type: "project-summary",
      target_id: p.id,
    };
    await service.command({
      ...base,
      type: "manual-edit",
      request_id: "edit",
      content: { 正文: "人工新稿" },
    });
    await service.idle(p.id);
    assert.equal(model.read().project.项目摘要.正文, "人工新稿");
    assert.deepEqual(
      model.read().steps.map((s) => s.kind),
      ["precheck", "manual_edit"],
    );
    await service.command({
      ...base,
      type: "manual-edit",
      request_id: "invalid",
      content: { 正文: "" },
    });
    await service.idle(p.id);
    assert.equal(model.read().project.项目摘要.正文, "人工新稿");
    assert.equal(model.read().tasks[1].task_status, "failed");
    await model.update("set-rejected", {}, (s) => {
      s.project.项目摘要.状态 = "rejected";
      s.project.项目摘要.原因 = "审核不通过";
      s.runtime.queue_stopped = false;
      return {};
    });
    await service.command({
      ...base,
      type: "override",
      request_id: "override",
    });
    await service.idle(p.id);
    assert.equal(model.read().tasks[2].task_status, "completed");
    assert.equal(model.read().project.项目摘要.状态, "generated");
    assert.equal(model.read().tasks[1].task_status, "failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
