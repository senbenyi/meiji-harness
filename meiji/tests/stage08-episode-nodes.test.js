import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAppRuntime } from "../server/runtime/app-runtime.js";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-service.js";
import { createHandlerRegistry } from "../server/handlers/handler-registry.js";
import { commitContent } from "../server/handlers/content.js";
import { projectFixture } from "./fixtures/project.js";

test("剧集参考时长经项目命令修改：主链过期、摘要不变，旧内容和 hash 保留", async () => {
  const home = await mkdtemp(join(tmpdir(), "meiji-episode-duration-"));
  let runtime;
  try {
    runtime = await createAppRuntime({ home });
    const project = projectFixture(), episode = project.episodes[0];
    const model = await runtime.repository.create(project), session = `session-${crypto.randomUUID()}`;
    await runtime.bindings.bind(session, project.id);
    await runtime.projectCommand({ type: "edit-episode", project_id: project.id, request_id: "same", episode_id: episode.id, fields: { duration_seconds: 10 } }, session);
    assert.equal(model.read().project.episodes[0].story_outline.node_state.status, "generated");
    await runtime.projectCommand({ type: "edit-episode", project_id: project.id, request_id: "changed", episode_id: episode.id, fields: { duration_seconds: 60 } }, session);
    const next = model.read().project.episodes[0];
    assert.equal(next.summary.node_state.status, "generated");
    for (const key of ["story_outline", "shot_list", "assembly"]) {
      assert.equal(next[key].node_state.status, "expired");
      assert.equal(next[key].node_state.dependency_hash, episode[key].node_state.dependency_hash);
    }
    assert.equal(next.story_outline.segments[0].body, episode.story_outline.segments[0].body);
    assert.equal(next.shot_list.shots[0].video.node_state.status, "expired");
    assert.equal(next.shot_list.shots[0].video.address, episode.shot_list.shots[0].video.address);
  } finally {
    await runtime?.dispose();
    await rm(home, { recursive: true, force: true });
  }
});

test("视频写回立即累计剧集实测时长；整集导入不覆盖，删镜重算且终态历史仍可读", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-episode-actual-"));
  const repository = new ModelRepository(root), project = projectFixture(), episode = project.episodes[0];
  let service;
  try {
    for (const shot of episode.shot_list.shots) shot.actual_duration_seconds = 0;
    const model = await repository.create(project);
    service = new TaskService({ repository, commitOutput: commitContent, execute: createHandlerRegistry({
      text: async () => { throw Error("人工编辑不调用 AI"); },
      media: async ({ step, draft }) => ({ content: step.kind === "apply" ? { ...draft, last_frame: {address: "import-tail.png"} } : step.result.input, result: step.result?.input }),
    }) });
    const imported = [];
    for (const [index, duration] of [5.2, 6.1].entries()) {
      const result = await service.command({ type: "manual-edit", project_id: project.id, request_id: `video-${index}`, business_type: "video", target_id: episode.shot_list.shots[index].id, content: { address: `import-${index}.mp4`, actual_duration_seconds: duration } });
      await service.idle(project.id);
      assert.equal(model.read().tasks.find(t => t.id === result.task_id).task_status, "completed");
      assert.equal(model.read().project.episodes[0].actual_duration_seconds, index ? 11.3 : 5.2);
      imported.push(result.task_id);
    }
    await service.command({ type: "manual-edit", project_id: project.id, request_id: "assembly", business_type: "assembly", target_id: episode.id, content: { address: "whole-episode.mp4", actual_duration_seconds: 99 } });
    await service.idle(project.id);
    assert.equal(model.read().project.episodes[0].actual_duration_seconds, 11.3);
    assert.equal(model.read().steps.at(-1).result.actual_duration_seconds, 99);
    const shot = model.read().project.episodes[0].shot_list.shots[1];
    const fields = ["title", "number", "duration_seconds", "shot_scale", "hook", "body", "continuity_transition", "reference_anchor", "audio_arrangement"];
    await service.command({ type: "manual-edit", project_id: project.id, request_id: "remove-shot", business_type: "shots", target_id: episode.id, content: { shots: [Object.fromEntries(fields.map(key => [key, shot[key]]))] } });
    await service.idle(project.id);
    const after = model.read();
    assert.equal(after.project.episodes[0].actual_duration_seconds, 6.1);
    assert.equal(after.project.episodes[0].duration_seconds, 10);
    assert.equal(after.project.episodes[0].shot_list.shots[0].id, shot.id);
    assert.equal(after.project.episodes[0].assembly.node_state.status, "expired");
    for (const id of imported) {
      const history = await service.command({ type: "query", project_id: project.id, task_id: id });
      assert.equal(history.task.task_status, "completed");
    }
  } finally {
    await service?.dispose(); await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});
