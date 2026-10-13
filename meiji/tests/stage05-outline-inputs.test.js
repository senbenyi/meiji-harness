import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyProject, emptyEpisode } from "../shared/project_contract.js";
import { precheck } from "../server/flow/tasks/precheck.js";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-service.js";
import { createTextHandler } from "../server/handlers/text-handler.js";
import { createHandlerRegistry } from "../server/handlers/handler-registry.js";
import { commitContent } from "../server/handlers/content.js";
import { loadTemplate, renderTemplate } from "../server/prompts/yaml-prompts.js";
import { promptValues } from "../server/handlers/text-handler.js";
import { stampDependencyHash } from "../shared/node-dependencies.js";

function fixture(mode, action = "generate") {
  const p = emptyProject({ name: "剧情独立输入", creation_mode: mode });
  const e = emptyEpisode({ duration_seconds: 10 });
  p.episodes = [e];
  if (mode === "剧本") p.script.body = e.plot = "林峥醒来，发现自己成为武松。";
  else p.creative_direction = "少年在未来都市寻找失踪的兄长。";
  if (action === "regenerate") e.story_outline = {
    node_state: { status: "generated", reason: "", dependency_hash: "" }, segments: [{ sequence: 1, duration_seconds: 10, body: "已有剧情", causal: "" }],
  };
  const task = { business_type: "outline", target_id: e.id, action,
    previous_node_state: { status: e.story_outline.node_state.status } };
  return { p, e, task };
}

for (const mode of ["剧本", "自由创作"]) {
  test(`B-8 ${mode} 摘要的空/失败/过期/无效生成状态均不阻断剧情`, () => {
    const { p, task } = fixture(mode);
    for (const state of ["empty", "failed", "expired", "generated"]) {
      p.project_summary = { node_state: { status: state, reason: state === "failed" || state === "expired" ? "旧原因" : "", dependency_hash: "" }, body: "", script_version: 1 };
      assert.equal(precheck({ project: p }, task).passed, true);
    }
    if (mode === "剧本") p.episodes[0].plot = " \n ";
    else p.creative_direction = " \n ";
    p.project_summary = { node_state: { status: "generated", reason: "", dependency_hash: "" }, body: "有效摘要不能替代必需输入", script_version: 1 };
    if (mode === "剧本") p.creative_direction = "不能替代剧本";
    else p.script.body = "不能替代创作方向";
    assert.throws(() => precheck({ project: p }, task), mode === "剧本" ? /本集剧情为空/ : /创作方向为空/);
  });

  for (const action of ["generate", "regenerate"]) {
    test(`B-8 ${mode} 无摘要 ${action} 真实任务生成与审核闭环`, async () => {
      const root = await mkdtemp(join(tmpdir(), "meiji-outline-"));
      try {
        const { p, e } = fixture(mode, action);
        const repository = new ModelRepository(root), model = await repository.create(p);
        const seen = [];
        const service = new TaskService({ repository, commitOutput: commitContent,
          execute: createHandlerRegistry({ text: createTextHandler({ chat: async ({ step, prompt }) => {
            seen.push(step.kind);
            assert.ok(!prompt.includes("项目摘要"));
            assert.ok(prompt.includes(mode === "剧本" ? p.script.body : p.creative_direction));
            return step.kind === "review" ? { 是否通过: true, 原因: "" }
              : { segments: [{ sequence: 1, duration_seconds: 10, body: "新的剧情", causal: "" }] };
          } }) }),
        });
        const result = await service.command({ type: "submit", project_id: p.id,
          request_id: "outline", business_type: "outline", target_id: e.id, action });
        await service.idle(p.id);
        const snapshot = model.read(), task = snapshot.tasks.find(t => t.id === result.task_id);
        assert.equal(task.task_status, "completed", task.end_reason);
        assert.deepEqual(seen, ["generate", "review"]);
        assert.equal(snapshot.project.episodes[0].story_outline.node_state.status, "generated");
        assert.deepEqual(snapshot.project.project_summary, p.project_summary);
        assert.equal(snapshot.tasks.length, 1);
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  }

  test(`B-8 ${mode} 三种剧情模板均忽略已有项目摘要`, async () => {
    const { p, task } = fixture(mode);
    p.project_summary.body = "摘要哨兵内容禁止进入剧情资料";
    const snapshot = { project: p, steps: [] };
    for (const suffix of ["generate", "regenerate", "review"]) {
      const prompt = renderTemplate(await loadTemplate(`outline-${suffix}`), promptValues(snapshot, task, {}, suffix));
      assert.ok(!prompt.user.includes("摘要哨兵内容"));
      assert.ok(!prompt.user.includes("项目摘要"));
    }
  });

  test(`B-8 ${mode} 必需输入为空时任务失败且不调用模型`, async () => {
    const root = await mkdtemp(join(tmpdir(), "meiji-outline-missing-"));
    try {
      const { p, e } = fixture(mode);
      if (mode === "剧本") { p.episodes[0].plot = " "; p.creative_direction = "其他资料"; }
      else { p.creative_direction = " "; p.script.body = "其他资料"; }
      p.project_summary = { node_state: { status: "generated", reason: "", dependency_hash: "" }, body: "已有摘要", script_version: 1 };
      const repository = new ModelRepository(root), model = await repository.create(p);
      let calls = 0;
      const service = new TaskService({ repository, commitOutput: commitContent,
        execute: createTextHandler({ chat: async () => { calls++; throw new Error("不应调用模型"); } }),
      });
      const result = await service.command({ type: "submit", project_id: p.id,
        request_id: "missing", business_type: "outline", target_id: e.id, action: "generate" });
      await service.idle(p.id);
      const snapshot = model.read(), task = snapshot.tasks.find(t => t.id === result.task_id);
      assert.equal(task.task_status, "failed");
      assert.match(task.end_reason, mode === "剧本" ? /本集剧情为空/ : /创作方向为空/);
      assert.equal(calls, 0);
      assert.deepEqual(snapshot.project.project_summary, p.project_summary);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("B-8 镜头表以有效故事大纲为唯一剧集前置", () => {
  const { p, e } = fixture("剧本"),
    s = { business_type: "shots", target_id: e.id, action: "generate",
      previous_node_state: { status: "empty", reason: "" } };
  e.story_outline.node_state.status = "empty";
  assert.throws(() => precheck({ project: p }, s), /outline尚未有效生成/);
  e.story_outline.node_state.status = "generated";
  e.story_outline.segments = [{ sequence: 1, duration_seconds: 10, body: "完整故事", causal: "" }];
  stampDependencyHash({ project: p }, "outline", e.id);
  assert.equal(precheck({ project: p }, s).passed, true);
});
