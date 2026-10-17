import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-manager.js";
import { createTestTextHandler as createTextHandler } from "./fixtures/ai.js";
import { createHandlerRegistry } from "../server/handlers/handler-registry.js";
import { commitContent } from "../server/handlers/content.js";
import { projectFixture } from "./fixtures/project.js";
import { stampDependencyHash } from "../shared/node-dependencies.js";

async function runScenario({ repairDurations, invalidShape = false, episodeDuration = 20 }) {
  const root = await mkdtemp(join(tmpdir(), "meiji-shot-duration-")), project = projectFixture(), episode = project.episodes[0];
  episode.duration_seconds = episodeDuration;
  episode.story_outline.segments[0].duration_seconds = episodeDuration;
  stampDependencyHash({ project }, "outline", episode.id);
  stampDependencyHash({project}, "episode-scenes", episode.id);
  const oldHash = "a".repeat(64);
  episode.shot_list.node_state.dependency_hash = oldHash;
  const repository = new ModelRepository(root), model = await repository.create(project), prompts = [];
  let generationCount = 0;
  const handler = createTextHandler({ chat: async ({ step, messages }) => {
    const prompt = messages.filter(message => message.role !== 'system').map(message => message.content).join('\n\n');
    if (step.kind === "review") return { 是否通过: true, 原因: "" };
    prompts.push({ step, prompt });
    const durations = repairDurations[generationCount++] || [15, 5];
    if (invalidShape) return { shots: [], invalid: true };
    return { ...(step.kind === "revise" ? { mode: "replace" } : {}), shots: durations.map((duration_seconds, index) => ({
      title: "测试镜头", id: "", duration_seconds,
      shot_scale: "中景", hook: "", body: index === 0 ? "超限候选事件标记" : "测试收尾", continuity_transition: "",
      reference_anchor: { fixed_landmark: "", character_positions: "", departed_characters: "", lighting: "" },
      on_screen_characters: [], background_characters: "", audio_arrangement: { narration: "", dialogue: "", sound_effects: "" },
    })) };
  } });
  const service = new TaskService({ repository, execute: createHandlerRegistry({ text: handler, media: () => { throw Error("unexpected media"); } }), commitOutput: commitContent });
  try {
    const submitted = await service.command({ type: "submit", project_id: project.id, request_id: "duration-repair", business_type: "shots", target_id: episode.id, action: "regenerate" });
    await service.idle(project.id);
    return { snapshot: model.readAll(), taskId: submitted.task_id, prompts, generationCount, oldHash };
  } finally { await service.dispose(); await repository.close(); await rm(root, { recursive: true, force: true }); }
}

for (const scenario of [
  { name: "单镜超限", repairDurations: [[16, 4], [15, 5]], total: 20 },
  { name: "总时长下界", episodeDuration: 60, repairDurations: [[15, 14], [15, 15, 15, 15]], total: 60 },
  { name: "总时长上界", repairDurations: [[15, 15, 15, 6], [15, 5]], total: 20 },
]) test(`${scenario.name}在独立程序审核后带原候选修订`, async () => {
  const { snapshot, taskId, prompts, generationCount } = await runScenario(scenario);
  const task = snapshot.tasks.find(item => item.id === taskId), steps = snapshot.steps.filter(step => step.task_id === taskId);
  assert.equal(task.task_status, "completed", task.end_reason);
  assert.equal(generationCount, 2);
  assert.ok(steps.filter(step => ["generate", "revise"].includes(step.kind)).every(step => step.step_status === "done"));
  const rejected = steps.find(step => step.kind === "review" && step.step_status === "rejected");
  assert.match(rejected.name, /程序审核/);
  assert.ok(rejected.error_reason);
  assert.ok(prompts[1].prompt.includes(rejected.error_reason));
  assert.match(prompts[1].prompt, /超限候选事件标记/);
  assert.equal(snapshot.project.episodes[0].shot_list.shots.reduce((sum, shot) => sum + shot.duration_seconds, 0), scenario.total);
});

for (const durations of [[[16, 4], [17, 4], [18, 4]], [[10, 10], [11, 10], [12, 10]]])
  test(`程序审核耗尽保存最终未通过内容和原因，hash保留 ${durations[0]}`, async () => {
    const { snapshot, taskId, generationCount, oldHash } = await runScenario({ episodeDuration: 60, repairDurations: durations });
    const task = snapshot.tasks.find(item => item.id === taskId), node = snapshot.project.episodes[0].shot_list;
    assert.equal(task.task_status, "rejected", task.end_reason);
    assert.equal(generationCount, 3);
    assert.equal(node.node_state.status, "rejected");
    assert.equal(node.node_state.reason, task.end_reason);
    assert.equal(node.node_state.dependency_hash, oldHash);
    assert.deepEqual(node.shots.map(shot => shot.duration_seconds), durations[2]);
    assert.equal(snapshot.steps.filter(step => step.task_id === taskId && step.step_status === "rejected").length, 3);
  });

test("响应结构错误重复不变提前停止修订", async () => {
  const { snapshot, taskId, generationCount } = await runScenario({ repairDurations: [[15, 5]], invalidShape: true });
  assert.equal(snapshot.tasks.find(task => task.id === taskId).task_status, "rejected");
  assert.equal(generationCount, 2);
  assert.equal(snapshot.steps.filter(step => step.task_id === taskId && step.kind === "revise").length, 1);
});
