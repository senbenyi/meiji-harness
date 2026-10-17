import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyProject, emptyEpisode } from "../shared/project_contract.js";
import { precheck } from "../server/flow/tasks/precheck.js";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-manager.js";
import { createTestTextHandler as createTextHandler } from "./fixtures/ai.js";
import { createHandlerRegistry } from "../server/handlers/handler-registry.js";
import { commitContent } from "../server/handlers/content.js";
import { renderTaskPrompt } from "./fixtures/ai.js";
import { stampDependencyHash } from "../shared/node-dependencies.js";

function fixture(mode, action = "generate") {
  const p = emptyProject({ name: "剧情独立输入", creation_mode: mode });
  const e = emptyEpisode({ duration_seconds: 10 });
  p.episodes = [e];
  if (mode === "剧本") p.script.body = e.plot = "林峥醒来，发现自己成为武松。";
  else { p.creative_direction = "方向哨兵，不得代替剧情"; e.plot = "少年在雨夜的未来都市找到兄长留下的红色纸条。"; }
  if (action === "regenerate") e.story_outline = {
    node_state: { status: "generated", reason: "", dependency_hash: "" }, segments: [{ sequence: 1, duration_seconds: 10, body: "已有剧情", causal: "" }],
  };
  const task = { business_type: "outline", target_id: e.id, action,
    previous_node_state: { status: e.story_outline.node_state.status } };
  return { p, e, task };
}

for (const mode of ["剧本", "自由创作"]) {
  test(`${mode} 大纲生成、修订及审核允许按时长合理补充，保留原剧情约束`, () => {
    const { p, e, task } = fixture(mode);
    e.duration_seconds = 180;
    for (const action of ["generate", "regenerate", "review"]) {
      const rendered = renderTaskPrompt({ project: p, steps: [] }, task, e.story_outline, action);
      assert.match(rendered.system, /明显不足|明显撑不满/);
      assert.match(rendered.system, /补充.*合理情节|合理补充/);
      assert.match(rendered.system, /内容足够时不强行扩写/);
      assert.match(rendered.system, /原台词逐字保留|逐字核对原台词/);
      assert.match(rendered.system, /不改变原事件结果|拒绝改变原事件结果/);
      assert.doesNotMatch(rendered.system, /只拆分和整理原剧情，不续写|拒绝新增人物、动机、动作|唯一剧情事实来源|反查每段内容都有原文依据/);
      assert.ok(rendered.messages[1].content.includes(e.plot));
    }
  });

  test(`${mode} 按预算补充剧情的任务保留扩写正文且不改源剧情`, async () => {
    const root = await mkdtemp(join(tmpdir(), "meiji-outline-expand-"));
    try {
      const { p, e } = fixture(mode);
      e.duration_seconds = 180;
      const expanded = { segments: [
        { sequence: 1, duration_seconds: 30, body: e.plot, causal: "" },
        { sequence: 2, duration_seconds: 150, body: "人物循着已有线索反复核对身边的物件，在试探与受阻中确认下一步行动。", causal: "承接原事件的行动与反应" },
      ] };
      const repository = new ModelRepository(root), model = await repository.create(p);
      let reviewed = false;
      const service = new TaskService({ repository, commitOutput: commitContent,
        execute: createTextHandler({ chat: async ({ step, messages }) => {
          if (step.kind === "review") {
            reviewed = true;
            assert.match(messages[0].content, /不能仅因合理补充没有原文逐句依据而判未通过/);
            assert.ok(messages.some(message => message.content.includes(expanded.segments[1].body)));
            return { 是否通过: true, 原因: "" };
          }
          return expanded;
        } }),
      });
      const result = await service.command({ type: "submit", project_id: p.id, request_id: "expand", business_type: "outline", target_id: e.id, action: "generate" });
      await service.idle(p.id);
      const saved = model.readAll();
      assert.equal(saved.tasks.find(task => task.id === result.task_id).task_status, "completed");
      assert.equal(reviewed, true);
      assert.equal(saved.project.episodes[0].plot, e.plot);
      assert.equal(saved.project.script.body, p.script.body);
      assert.equal(saved.project.episodes[0].duration_seconds, 180);
      assert.deepEqual(saved.project.episodes[0].story_outline.segments, expanded.segments);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test(`B-8 ${mode} 摘要的空/失败/过期/无效生成状态均不阻断剧情`, () => {
    const { p, task } = fixture(mode);
    for (const state of ["empty", "failed", "expired", "generated"]) {
      p.project_summary = { node_state: { status: state, reason: state === "failed" || state === "expired" ? "旧原因" : "", dependency_hash: "" }, body: "", script_version: 1 };
      assert.equal(precheck({ project: p }, task).passed, true);
    }
    p.episodes[0].plot = " \n ";
    p.project_summary = { node_state: { status: "generated", reason: "", dependency_hash: "" }, body: "有效摘要不能替代必需输入", script_version: 1 };
    if (mode === "剧本") p.creative_direction = "不能替代剧本";
    else p.script.body = "不能替代创作方向";
    assert.throws(() => precheck({ project: p }, task), /本集剧情为空/);
  });

  for (const action of ["generate", "regenerate"]) {
    test(`B-8 ${mode} 无摘要 ${action} 真实任务生成与审核闭环`, async () => {
      const root = await mkdtemp(join(tmpdir(), "meiji-outline-"));
      try {
        const { p, e } = fixture(mode, action);
        const repository = new ModelRepository(root), model = await repository.create(p);
        const seen = [];
        const service = new TaskService({ repository, commitOutput: commitContent,
          execute: createHandlerRegistry({ text: createTextHandler({ chat: async ({ step, messages }) => {
    const prompt = messages.filter(message => message.role !== 'system').map(message => message.content).join('\n\n');
            seen.push(step.kind);
            assert.ok(!prompt.includes("项目摘要"));
            assert.ok(prompt.includes(e.plot));
            assert.ok(!prompt.includes("方向哨兵"));
            return step.kind === "review" ? { 是否通过: true, 原因: "" }
              : { segments: [{ sequence: 1, duration_seconds: 10, body: "新的剧情", causal: "" }] };
          } }) }),
        });
        const result = await service.command({ type: "submit", project_id: p.id,
          request_id: "outline", business_type: "outline", target_id: e.id, action });
        await service.idle(p.id);
        const snapshot = model.readAll(), task = snapshot.tasks.find(t => t.id === result.task_id);
        assert.equal(task.task_status, "completed", task.end_reason);
        assert.deepEqual(seen, ["generate", "review"]);
        assert.equal(snapshot.project.episodes[0].story_outline.node_state.status, "generated");
        assert.deepEqual(snapshot.project.project_summary, p.project_summary);
        assert.equal(snapshot.tasks.length, 1);
        assert.equal(snapshot.project.episodes[0].plot, e.plot);
        assert.match(task.name, /生成故事大纲/);
        assert.match(snapshot.groups[0].name, /生成故事大纲/);
        const steps = snapshot.steps.filter(step => step.task_id === task.id);
        assert.match(steps.find(step => step.kind === "generate").name, /生成故事大纲/);
        assert.ok(steps.filter(step => step.kind === "review").every(step => step.name.includes("审核故事大纲")));
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  }

  test(`B-8 ${mode} 三种剧情模板均忽略已有项目摘要`, async () => {
    const { p, task } = fixture(mode);
    p.project_summary.body = "摘要哨兵内容禁止进入剧情资料";
    const snapshot = { project: p, steps: [] };
    for (const suffix of ["generate", "regenerate", "review"]) {
      const prompt = renderTaskPrompt(snapshot, task, {}, suffix);
      assert.ok(!prompt.user.includes("摘要哨兵内容"));
      assert.ok(!prompt.user.includes("项目摘要"));
    }
  });

  test(`B-8 ${mode} 必需输入为空时任务失败且不调用模型`, async () => {
    const root = await mkdtemp(join(tmpdir(), "meiji-outline-missing-"));
    try {
      const { p, e } = fixture(mode);
      if (mode === "剧本") { p.episodes[0].plot = " "; p.creative_direction = "其他资料"; }
      else { e.plot = " "; p.creative_direction = "其他资料"; }
      p.project_summary = { node_state: { status: "generated", reason: "", dependency_hash: "" }, body: "已有摘要", script_version: 1 };
      const repository = new ModelRepository(root), model = await repository.create(p);
      let calls = 0;
      const service = new TaskService({ repository, commitOutput: commitContent,
        execute: createTextHandler({ chat: async () => { calls++; throw new Error("不应调用模型"); } }),
      });
      const result = await service.command({ type: "submit", project_id: p.id,
        request_id: "missing", business_type: "outline", target_id: e.id, action: "generate" });
      await service.idle(p.id);
      const snapshot = model.readAll(), task = snapshot.tasks.find(t => t.id === result.task_id);
      assert.equal(task.task_status, "rejected");
      assert.match(task.end_reason, /本集剧情为空/);
      assert.equal(calls, 0);
      assert.deepEqual(snapshot.project.project_summary, p.project_summary);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("B-8 镜头表要求有效故事大纲与角色库", () => {
  const { p, e } = fixture("剧本"),
    s = { business_type: "shots", target_id: e.id, action: "generate",
      previous_node_state: { status: "empty", reason: "" } };
  e.story_outline.node_state.status = "empty";
  assert.throws(() => precheck({ project: p }, s), /outline尚未有效生成/);
  e.story_outline.node_state.status = "generated";
  e.story_outline.segments = [{ sequence: 1, duration_seconds: 10, body: "完整故事", causal: "" }];
  stampDependencyHash({ project: p }, "outline", e.id);
  stampDependencyHash({project:p}, "project-characters", p.id);
  p.character_library.node_state.status="generated";
  e.scene_catalog.has_result = true; e.scene_catalog.node_state.status = "generated";
  stampDependencyHash({project:p}, "episode-scenes", e.id);
  assert.equal(precheck({ project: p }, s).passed, true);
});


test("自由模式有本集剧情无需创作方向，缺少剧情不能由方向替代", () => {
  const { p, e, task } = fixture("自由创作"); p.creative_direction = "";
  assert.equal(precheck({project:p},task).passed,true);
  e.plot=""; p.creative_direction="补写另一个故事";
  assert.throws(()=>precheck({project:p},task),/本集剧情为空/);
});
