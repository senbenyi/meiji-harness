import test from "node:test";
import { createId } from "../shared/task_contract.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-manager.js";
import { createTestTextHandler as createTextHandler } from "./fixtures/ai.js";
import { createHandlerRegistry } from "../server/handlers/handler-registry.js";
import { taskNodeInput } from "../server/handlers/node-inputs.js";
import { isNodeCurrent } from "../shared/node-dependencies.js";
import { assertProgramReview } from "../shared/node-state.js";
import { commitContent } from "../server/handlers/content.js";
import { renderTaskPrompt } from "./fixtures/ai.js";
import { projectFixture, taskFixture, snapshotFixture } from "./fixtures/project.js";

const story = '雨夜，武松缓慢扶起颤抖的兄长，红色粗布袖口滴着水。他低声说：“别怕。”门外响起沉闷的脚步声。';
async function outlineScenario({ durations, rejectAi = false, retry = false }) {
  const root = await mkdtemp(join(tmpdir(), "meiji-outline-review-")), project = projectFixture(), episode = project.episodes[0];
  episode.plot = story;
  episode.duration_seconds = 150;
  episode.story_outline.node_state.dependency_hash = "a".repeat(64);
  const repository = new ModelRepository(root), model = await repository.create(project), prompts = [];
  let generations = 0, aiReviews = 0, retrying = false;
  const text = createTextHandler({ chat: async ({ step, messages }) => {
    const prompt = messages.filter(message => message.role !== 'system').map(message => message.content).join('\n\n');
    prompts.push({ kind: step.kind, prompt });
    assert.ok(prompt.includes(story));
    if (step.kind === "review") {
      const rejected = rejectAi === true || rejectAi === "first" && aiReviews === 0;
      aiReviews++;
      return { 是否通过: !rejected, 原因: rejected ? "缺少红色粗布袖口细节" : "" };
    }
    const duration_seconds = retrying ? 137.5 : durations[generations];
    generations++;
    return { segments: [{ sequence: 1, duration_seconds, body: `${story} 候选${generations}`, causal: "承接前段的雨夜" }] };
  } });
  const service = new TaskService({ repository, execute: createHandlerRegistry({ text }), commitOutput: commitContent });
  try {
    const submit = request_id => service.command({ type: "submit", project_id: project.id, request_id, business_type: "outline", target_id: episode.id, action: "regenerate" });
    const first = await submit("outline");
    await service.idle(project.id);
    const before = model.read();
    let second;
    if (retry) {
      retrying = true;
      second = await submit("outline-retry");
      await service.idle(project.id);
    }
    return { before, after: model.read(), first, second, prompts, generations, aiReviews };
  } finally { await service.dispose(); await repository.close(); await rm(root, { recursive: true, force: true }); }
}

test("大纲程序与AI审核共享两次修订，每轮携带最新候选和当前原因", async () => {
  const { before: snapshot, first, prompts, generations, aiReviews } = await outlineScenario({ durations: [119, 137.5, 150], rejectAi: "first" });
  const task = snapshot.tasks.find(item => item.id === first.task_id), steps = snapshot.steps.filter(step => step.task_id === task.id);
  assert.equal(task.task_status, "completed", task.end_reason);
  assert.equal(generations, 3);
  assert.equal(aiReviews, 2);
  const reviews = steps.filter(step => step.kind === "review");
  assert.deepEqual(reviews.map(step => [step.round, step.name.includes("程序审核") ? "program" : "ai", step.step_status]), [
    [0, "program", "rejected"], [0, "ai", "cancelled"],
    [1, "program", "done"], [1, "ai", "rejected"],
    [2, "program", "done"], [2, "ai", "done"],
  ]);
  const revisions = prompts.filter(item => item.kind === "revise");
  assert.match(revisions[0].prompt, /候选1/);
  assert.match(revisions[0].prompt, /小段总时长 119 秒/);
  assert.match(revisions[1].prompt, /候选2/);
  assert.match(revisions[1].prompt, /缺少红色粗布袖口细节/);
  assert.doesNotMatch(revisions[1].prompt, /小段总时长 119 秒/);
  assert.equal(snapshot.project.episodes[0].story_outline.segments[0].body, `${story} 候选3`);
});

for (const rejectAi of [false, true])
  test(`大纲${rejectAi ? "AI" : "程序"}审核耗尽保存最后候选及原因，不更新hash或下游`, async () => {
    const result = await outlineScenario({ durations: rejectAi ? [137.5, 137.5, 137.5] : [119, 118, 117], rejectAi, retry: !rejectAi });
    const { before, after, first, second, prompts } = result;
    const task = before.tasks.find(item => item.id === first.task_id), episode = before.project.episodes[0];
    assert.equal(task.task_status, "rejected", task.end_reason);
    assert.equal(episode.duration_seconds, 150);
    assert.equal(episode.story_outline.node_state.status, "rejected");
    assert.equal(episode.story_outline.node_state.reason, task.end_reason);
    assert.equal(episode.story_outline.node_state.dependency_hash, "a".repeat(64));
    assert.equal(episode.story_outline.segments[0].body, `${story} 候选3`);
    assert.equal(episode.story_outline.segments[0].duration_seconds, rejectAi ? 137.5 : 117);
    assert.equal(episode.shot_list.node_state.status, "generated");
    if (second) {
      const retryTask = after.tasks.find(item => item.id === second.task_id);
      assert.equal(retryTask.task_status, "completed", retryTask.end_reason);
      assert.equal(retryTask.opinion, task.end_reason);
      const retryPrompt = prompts.filter(item => item.kind !== "review")[3].prompt;
      assert.ok(retryPrompt.includes(task.end_reason));
      assert.doesNotMatch(retryPrompt, /候选3/);
      assert.deepEqual(after.tasks.find(item => item.id === task.id), task);
      assert.deepEqual(after.steps.filter(step => step.task_id === task.id), before.steps.filter(step => step.task_id === task.id));
    }
  });

test("摘要和大纲修订注入候选；大纲三种模板均有参考值与程序一致的范围", async () => {
  const snapshot = snapshotFixture(), project = snapshot.project, episode = project.episodes[0];
  episode.plot = story;
  episode.duration_seconds = 137;
  for (const business of ["episode-summary", "outline"]) {
    const task = taskFixture(project, business, episode.id, { opinion: "保留红色粗布" });
    const marker = `${business}待修订标记`, draft = business === "outline"
      ? { segments: [{ sequence: 1, duration_seconds: 138, body: marker, causal: "承接" }] }
      : { body: marker };
    const revised = renderTaskPrompt(snapshot, task, draft, "regenerate", { kind: "revise" });
    assert.ok(revised.messages[2].content.includes(marker));
    assert.match(revised.user, /保留红色粗布/);
    assert.ok(revised.messages[1].content.includes(story));
  }
  for (const suffix of ["generate", "regenerate", "review"]) {
    const task = taskFixture(project, "outline", episode.id);
    const rendered = renderTaskPrompt(snapshot, task, episode.story_outline, suffix);
    assert.match(rendered.messages[1].content, /本集参考时长秒\n137/);
    assert.match(rendered.messages[1].content, /min_seconds["：:\s]+107/);
    assert.match(rendered.messages[1].content, /max_seconds["：:\s]+167/);
  }
});


test("大纲通过后保留固定参考与小数预算，依赖有效且镜头表下游过期", async () => {
  const { after, first } = await outlineScenario({ durations: [137.5] });
  const episode = after.project.episodes[0];
  assert.equal(after.tasks.find(task => task.id === first.task_id).task_status, "completed");
  assert.equal(episode.duration_seconds, 150);
  assert.equal(episode.story_outline.segments[0].duration_seconds, 137.5);
  assert.equal(episode.actual_duration_seconds, 0);
  assert.equal(isNodeCurrent(after, "outline", episode.id), true);
  assert.equal(episode.shot_list.node_state.status, "expired");
});

for (const action of ["regenerate", "manual_edit", "override"])
  test(`大纲 ${action} 保留固定参考，镜头表同时受集预算与大纲目标约束`, () => {
    const snapshot = snapshotFixture(), episode = snapshot.project.episodes[0];
    episode.duration_seconds = 60;
    const task = taskFixture(snapshot.project, "outline", episode.id, { action });
    const content = { segments: [
      { sequence: 1, duration_seconds: 20, body: "前段", causal: "" },
      { sequence: 2, duration_seconds: 20.5, body: "后段", causal: "承接" },
    ] };
    for (const shot of episode.shot_list.shots) shot.duration_seconds = 15;
    assert.doesNotThrow(() => assertProgramReview(snapshot.project, "shots", episode.id));
    if (action === "override") episode.story_outline.segments = content.segments;
    commitContent(snapshot, task, content);
    assert.equal(episode.duration_seconds, 60);
    assert.equal(isNodeCurrent(snapshot, "outline", episode.id), true);
    const input = taskNodeInput(snapshot, taskFixture(snapshot.project, "shots", episode.id), null, "generate");
    assert.equal(input.duration, 60);
    for (const shot of episode.shot_list.shots) shot.duration_seconds = 4;
    assert.throws(() => assertProgramReview(snapshot.project, "shots", episode.id), /故事小段合计取整 41 秒，允许误差±30秒/);
    episode.shot_list.shots[0].duration_seconds = 15;
    episode.shot_list.shots[1].duration_seconds = 15;
    assert.doesNotThrow(() => assertProgramReview(snapshot.project, "shots", episode.id));
  });

test("候选保存不回写，人工放行先以原参考审核，失败不回写", () => {
  const snapshot = snapshotFixture(), episode = snapshot.project.episodes[0];
  episode.duration_seconds = 150;
  const task = taskFixture(snapshot.project, "outline", episode.id);
  const content = { segments: [{ sequence: 1, duration_seconds: 100, body: "候选", causal: "" }] };
  commitContent(snapshot, task, content, { passed: false });
  assert.equal(episode.duration_seconds, 150);
  task.action = "override";
  assert.throws(() => commitContent(snapshot, task, null), /小段总时长 100 秒/);
  assert.equal(episode.duration_seconds, 150);
});
