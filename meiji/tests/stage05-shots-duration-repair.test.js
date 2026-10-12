import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-service.js";
import { createTextHandler } from "../server/handlers/text-handler.js";
import { commitContent } from "../server/handlers/content.js";
import { projectFixture } from "./fixtures/project.js";

async function runScenario({ repairDurations, invalidShape = false, episodeDuration = 20 }) {
  const root = await mkdtemp(join(tmpdir(), "meiji-shot-duration-")),
    p = projectFixture(),
    episode = p.剧集[0];
  episode.时长秒 = episodeDuration;
  episode.故事大纲.小段[0].时长秒 = episodeDuration;
  episode.镜头表.镜头.forEach((shot) => (shot.时长秒 = Math.min(15, episodeDuration / 2)));
  const repository = new ModelRepository(root),
    model = await repository.create(p),
    prompts = [],
    generationDurations = [...repairDurations];
  let generationCount = 0;
  const handler = createTextHandler({
    chat: async ({ task, step, prompt }) => {
      if (step.kind === "review") return { 通过: true, 原因: "" };
      prompts.push({ step, prompt });
      generationCount++;
      if (invalidShape && generationCount === 1) return { 镜头: [], 错误字段: true };
      const durations = generationDurations.shift() || [15, 5];
      return {
        镜头: durations.map((时长秒, index) => ({
          编号: `S${String(index + 1).padStart(2, "0")}`,
          标题: "测试镜头",
          参考时长: 时长秒,
          正文: index === 0 ? "超限草稿事件标记" : "测试收尾",
        })),
      };
    },
  });
  const service = new TaskService({ repository, execute: handler, commitOutput: commitContent });
  try {
    const submitted = await service.command({
      type: "submit",
      project_id: p.id,
      request_id: "duration-repair",
      business_type: "shots",
      target_id: episode.id,
      action: "regenerate",
    });
    await service.idle(p.id);
    return { snapshot: model.read(), taskId: submitted.task_id, prompts, generationCount };
  } finally {
    await service.dispose();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("镜头超 15 秒时同一任务带着程序错误和原草稿修订后通过", async () => {
  const { snapshot, taskId, prompts, generationCount } = await runScenario({
      repairDurations: [[16, 4], [15, 5]],
    }),
    task = snapshot.tasks.find((item) => item.id === taskId),
    steps = snapshot.steps.filter((step) => step.task_id === taskId);
  assert.equal(task.task_status, "completed", task.end_reason);
  assert.equal(generationCount, 2);
  assert.deepEqual(
    steps.filter((step) => step.kind === "generate" || step.kind === "revise")
      .map((step) => [step.kind, step.step_status, step.error_reason]),
    [
      ["generate", "failed", "镜头.时长秒：最多 15 秒"],
      ["revise", "done", ""],
    ],
  );
  assert.equal(steps.find((step) => step.kind === "review" && step.round === 0).step_status, "superseded");
  assert.equal(steps.find((step) => step.kind === "review" && step.round === 1).step_status, "done");
  assert.match(prompts[1].prompt, /程序校验错误：镜头\.时长秒：最多 15 秒/);
  assert.match(prompts[1].prompt, /当前2镜合计20秒/);
  assert.match(prompts[1].prompt, /本集目标20秒，允许1–50秒/);
  assert.match(prompts[1].prompt, /超限草稿事件标记/);
  const shots = snapshot.project.剧集[0].镜头表.镜头;
  assert.ok(shots.every((shot) => shot.时长秒 <= 15));
  assert.equal(shots.reduce((sum, shot) => sum + shot.时长秒, 0), 20);
});

test("整集镜头时长低于下界时原任务修订到含边界下限后通过", async () => {
  const { snapshot, taskId, prompts } = await runScenario({
      episodeDuration: 60,
      repairDurations: [[15, 14], [15, 15]],
    }),
    task = snapshot.tasks.find((item) => item.id === taskId),
    steps = snapshot.steps.filter((step) => step.task_id === taskId),
    shots = snapshot.project.剧集[0].镜头表.镜头;
  assert.equal(task.task_status, "completed", task.end_reason);
  assert.deepEqual(
    steps.filter((step) => step.kind === "generate" || step.kind === "revise")
      .map((step) => [step.kind, step.step_status]),
    [["generate", "failed"], ["revise", "done"]],
  );
  assert.match(steps.find((step) => step.kind === "generate").error_reason, /允许 30–90 秒/);
  assert.match(prompts[1].prompt, /允许30–90秒/);
  assert.match(prompts[1].prompt, /当前2镜合计29秒/);
  assert.equal(shots.reduce((sum, shot) => sum + shot.时长秒, 0), 30);
});

test("整集镜头时长高于上界时原任务修订到含边界上限后通过", async () => {
  const { snapshot, taskId, prompts } = await runScenario({
      repairDurations: [[15, 15, 15, 6], [15, 15, 15, 5]],
    }),
    task = snapshot.tasks.find((item) => item.id === taskId),
    steps = snapshot.steps.filter((step) => step.task_id === taskId),
    shots = snapshot.project.剧集[0].镜头表.镜头;
  assert.equal(task.task_status, "completed", task.end_reason);
  assert.match(steps.find((step) => step.kind === "generate").error_reason, /允许 1–50 秒/);
  assert.match(prompts[1].prompt, /允许1–50秒/);
  assert.equal(shots.reduce((sum, shot) => sum + shot.时长秒, 0), 50);
});

test("两轮修订仍超限时原任务失败，非结构错误不进入自动修订", async (t) => {
  await t.test("修订预算耗尽", async () => {
    const { snapshot, taskId, generationCount } = await runScenario({
        repairDurations: [[16, 4], [17, 3], [18, 2]],
      }),
      task = snapshot.tasks.find((item) => item.id === taskId),
      steps = snapshot.steps.filter((step) => step.task_id === taskId);
    assert.equal(task.task_status, "failed");
    assert.equal(task.end_reason, "镜头.时长秒：最多 15 秒");
    assert.equal(generationCount, 3);
    assert.deepEqual(
      steps.filter((step) => step.kind === "revise").map((step) => [step.round, step.step_status]),
      [[1, "failed"], [2, "failed"]],
    );
    assert.match(snapshot.steps.find((step) => step.task_id === taskId && step.kind === "revise" && step.round === 2).prompt.user, /程序校验错误：镜头\.时长秒：最多 15 秒/);
    assert.ok(steps.filter((step) => step.kind === "review").every((step) => step.step_status === "superseded"));
  });
  await t.test("总时长超限的最终结构有效结果写入正式镜头表", async () => {
    const { snapshot, taskId } = await runScenario({
        episodeDuration: 60,
        repairDurations: [[10, 10], [11, 10], [12, 10]],
      }),
      task = snapshot.tasks.find((item) => item.id === taskId),
      episode = snapshot.project.剧集[0],
      steps = snapshot.steps.filter((step) => step.task_id === taskId);
    assert.equal(task.task_status, "failed");
    assert.match(task.end_reason, /镜头总时长超出允许范围.*允许 30–90 秒/);
    assert.equal(episode.镜头表.状态, "failed");
    assert.equal(episode.镜头表.原因, task.end_reason);
    assert.deepEqual(
      episode.镜头表.镜头.map(({ 时长秒, 正文 }) => [时长秒, 正文]),
      [[12, "超限草稿事件标记"], [10, "测试收尾"]],
    );
    assert.equal(steps.filter((step) => step.kind === "revise").length, 2);
    assert.match(
      steps.find((step) => step.kind === "revise" && step.round === 2).prompt.user,
      /超限草稿事件标记/,
    );
    assert.doesNotMatch(
      steps.find((step) => step.kind === "revise" && step.round === 2).prompt.user,
      /removed_ids/,
    );
  });
  await t.test("响应结构错误", async () => {
    const { snapshot, taskId, generationCount } = await runScenario({
        repairDurations: [[15, 5]],
        invalidShape: true,
      }),
      task = snapshot.tasks.find((item) => item.id === taskId),
      steps = snapshot.steps.filter((step) => step.task_id === taskId);
    assert.equal(task.task_status, "failed");
    assert.equal(generationCount, 1);
    assert.equal(steps.some((step) => step.kind === "revise"), false);
  });
});
