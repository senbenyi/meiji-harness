import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyProject, emptyEpisode } from "../shared/project-contract.js";
import { precheck } from "../server/flow/tasks/precheck.js";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-service.js";
import { createTextHandler } from "../server/handlers/text-handler.js";
import { commitContent } from "../server/handlers/content.js";
import { loadTemplate, renderTemplate } from "../server/prompts/yaml-prompts.js";
import { promptValues } from "../server/handlers/text-handler.js";

function fixture(mode, action = "generate") {
  const p = emptyProject({ 名称: "剧情独立输入", 创作方式: mode });
  const e = emptyEpisode({ 时长秒: 10 });
  p.剧集 = [e];
  if (mode === "剧本") p.剧本.正文 = e.剧情 = "林峥醒来，发现自己成为武松。";
  else p.创作方向 = "少年在未来都市寻找失踪的兄长。";
  if (action === "regenerate") e.故事大纲 = {
    状态: "generated", 原因: "", 依赖hash: "", 小段: [{ 序号: 1, 时长秒: 10, 正文: "已有剧情" }],
  };
  const task = { business_type: "outline", target_id: e.id, action,
    previous_node_state: { 状态: e.故事大纲.状态 } };
  return { p, e, task };
}

for (const mode of ["剧本", "自由创作"]) {
  test(`B-8 ${mode} 摘要的空/失败/过期/无效生成状态均不阻断剧情`, () => {
    const { p, task } = fixture(mode);
    for (const state of ["empty", "failed", "expired", "generated"]) {
      p.项目摘要 = { 状态: state, 原因: state === "failed" || state === "expired" ? "旧原因" : "", 依赖hash: "", 正文: "", 剧本版本: 1 };
      assert.equal(precheck({ project: p }, task).passed, true);
    }
    if (mode === "剧本") p.剧集[0].剧情 = " \n ";
    else p.创作方向 = " \n ";
    p.项目摘要 = { 状态: "generated", 原因: "", 依赖hash: "", 正文: "有效摘要不能替代必需输入", 剧本版本: 1 };
    if (mode === "剧本") p.创作方向 = "不能替代剧本";
    else p.剧本.正文 = "不能替代创作方向";
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
          execute: createTextHandler({ chat: async ({ step, prompt }) => {
            seen.push(step.kind);
            assert.ok(!prompt.includes("项目摘要"));
            assert.ok(prompt.includes(mode === "剧本" ? p.剧本.正文 : p.创作方向));
            return step.kind === "review" ? { 是否通过: true, 原因: "" }
              : { 小段: [{ 序号: 1, 时长秒: 10, 正文: "新的剧情", 因果: "" }] };
          } }),
        });
        const result = await service.command({ type: "submit", project_id: p.id,
          request_id: "outline", business_type: "outline", target_id: e.id, action });
        await service.idle(p.id);
        const snapshot = model.read(), task = snapshot.tasks.find(t => t.id === result.task_id);
        assert.equal(task.task_status, "completed", task.end_reason);
        assert.deepEqual(seen, ["generate", "review"]);
        assert.equal(snapshot.project.剧集[0].故事大纲.状态, "generated");
        assert.deepEqual(snapshot.project.项目摘要, p.项目摘要);
        assert.equal(snapshot.tasks.length, 1);
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  }

  test(`B-8 ${mode} 三种剧情模板均忽略已有项目摘要`, async () => {
    const { p, task } = fixture(mode);
    p.项目摘要.正文 = "摘要哨兵内容禁止进入剧情资料";
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
      if (mode === "剧本") { p.剧集[0].剧情 = " "; p.创作方向 = "其他资料"; }
      else { p.创作方向 = " "; p.剧本.正文 = "其他资料"; }
      p.项目摘要 = { 状态: "generated", 原因: "", 依赖hash: "", 正文: "已有摘要", 剧本版本: 1 };
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
      assert.deepEqual(snapshot.project.项目摘要, p.项目摘要);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("B-8 镜头表以有效故事大纲为唯一剧集前置", () => {
  const { p, e } = fixture("剧本"),
    s = { business_type: "shots", target_id: e.id, action: "generate",
      previous_node_state: { 状态: "empty", 原因: "" } };
  e.故事大纲.状态 = "empty";
  assert.throws(() => precheck({ project: p }, s), /outline尚未有效生成/);
  e.故事大纲.状态 = "generated";
  e.故事大纲.小段 = [{ 序号: 1, 时长秒: 10, 正文: "完整故事" }];
  assert.equal(precheck({ project: p }, s).passed, true);
});
