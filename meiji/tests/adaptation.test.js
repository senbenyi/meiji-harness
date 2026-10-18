import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyProject, emptyEpisode } from "../shared/project_contract.js";
import { precheck } from "../server/flow/tasks/precheck.js";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-manager.js";
import { createTestTextHandler as createTextHandler, renderTaskPrompt } from "./fixtures/ai.js";
import { createHandlerRegistry } from "../server/handlers/handler-registry.js";
import { commitContent } from "../server/handlers/content.js";
import { stampDependencyHash, isNodeCurrent, expireDownstream } from "../shared/node-dependencies.js";
import { taskNodeInput } from "../server/handlers/node-inputs.js";
import { assertProgramReview } from "../shared/node-state.js";
import { projectFixture, taskFixture, snapshotFixture } from "./fixtures/project.js";
import { adaptationContext, adaptedStory } from "../shared/adaptation-context.js";
import { shotsBudget } from "../server/prompts/duration-policy.js";

describe("outline-inputs", () => {
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

    test(`${mode} 分集改编保存新正文且不覆盖源剧本或本集规划`, async () => {
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
              assert.match(messages[0].content, /合理增删改或对白重写可通过/);
              assert.ok(messages.some(message => message.content.includes(expanded.segments[1].body)));
              return { 是否通过: true, "类型": "", 原因: "" };
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

    test(`${mode} 摘要的空/失败/过期/无效生成状态均不阻断剧情`, () => {
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
      test(`${mode} 无摘要 ${action} 真实任务生成与审核闭环`, async () => {
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
              assert.equal(prompt.includes("方向哨兵"), mode === "自由创作");
              return step.kind === "review" ? { 是否通过: true, "类型": "", 原因: "" }
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
          assert.match(task.name, /生成分集改编/);
          assert.match(snapshot.groups[0].name, /生成分集改编/);
          const steps = snapshot.steps.filter(step => step.task_id === task.id);
          assert.match(steps.find(step => step.kind === "generate").name, /生成分集改编/);
          assert.ok(steps.filter(step => step.kind === "review").every(step => step.name.includes("审核分集改编")));
        } finally { await rm(root, { recursive: true, force: true }); }
      });
    }

    test(`${mode} 三种剧情模板均忽略已有项目摘要`, async () => {
      const { p, task } = fixture(mode);
      p.project_summary.body = "摘要哨兵内容禁止进入剧情资料";
      const snapshot = { project: p, steps: [] };
      for (const suffix of ["generate", "regenerate", "review"]) {
        const prompt = renderTaskPrompt(snapshot, task, {}, suffix);
        assert.ok(!prompt.user.includes("摘要哨兵内容"));
        assert.ok(!prompt.user.includes("项目摘要"));
      }
    });

    test(`${mode} 必需输入为空时任务失败且不调用模型`, async () => {
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

  test("镜头表要求有效分集改编与角色库", () => {
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
});

describe("outline-review", () => {
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
        return { 是否通过: !rejected, "类型": (!rejected) ? "" : "模型问题", 原因: rejected ? "缺少红色粗布袖口细节" : "" };
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
      const before = model.readAll();
      let second;
      if (retry) {
        retrying = true;
        second = await submit("outline-retry");
        await service.idle(project.id);
      }
      return { before, after: model.readAll(), first, second, prompts, generations, aiReviews };
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
      assert.ok(revised.messages[1].content.includes(business === "outline" ? story : episode.story_outline.segments[0].body));
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
});

describe("adaptation", () => {
  function fixture() {
    const snapshot=snapshotFixture(), project=snapshot.project, first=project.episodes[0];
    first.plot='首集规划：甲找到线索，结尾带着线索离开。';
    first.story_outline.segments[0].body='甲与乙争论后拿到红色钥匙，独自离开仓库。';
    const second=emptyEpisode({sequence:2,duration_seconds:10,plot:'次集规划：甲用线索救人并揭开真相。'});
    second.story_outline.segments=[{sequence:1,duration_seconds:10,body:'甲在门前停下，最终救出同伴。',causal:''}];
    second.story_outline.node_state.status='generated';
    project.episodes.push(second);
    stampDependencyHash(snapshot,'outline',first.id);stampDependencyHash(snapshot,'outline',second.id);
    return {snapshot,project,first,second};
  }

  test('逐集改编输入含完整剧本、全集规划、前集实际结果，本集单独输出',()=>{
    const {snapshot,project,first,second}=fixture();
    const task=taskFixture(project,'outline',second.id);
    const input=taskNodeInput(snapshot,task,null,'generate');
    assert.equal(input.script,project.script.body);assert.equal(input.sequence,2);
    assert.equal(input.episodes.length,2);assert.equal(input.plot,second.plot);
    assert.equal(input.previous.story,adaptedStory(first));
    for(const action of ['generate','regenerate','review']) {
      const prompt=renderTaskPrompt(snapshot,task,second.story_outline,action);
      assert.ok(prompt.messages.some(message=>message.content.includes('红色钥匙')));
      assert.ok(prompt.messages.some(message=>message.content.includes(second.plot)));
      assert.match(prompt.system,/允许改写对白、增删或合并局部事件/);
      assert.doesNotMatch(prompt.system,/原台词逐字保留|原剧情必须完整保留/);
    }
  });
  test('前集无有效改编时只传规划，不把被拒绝的正文当作实际状态',()=>{
    const {project,first,second}=fixture();
    first.story_outline.node_state.status='rejected';first.story_outline.node_state.reason='需修正';
    const input=adaptationContext(project,second);
    assert.equal(input.previous.story,'');assert.equal(input.previous.plan,first.plot);
  });
  test('前集改编变化使后集改编过期，旧规划及正文保留',()=>{
    const {snapshot,project,first,second}=fixture();
    const old=structuredClone(second);
    assert.equal(isNodeCurrent(snapshot,'outline',second.id),true);
    first.story_outline.segments[0].body='甲失去钥匙，带着伤返回仓库。';
    stampDependencyHash(snapshot,'outline',first.id);
    expireDownstream(snapshot,'outline',first.id);
    assert.equal(second.story_outline.node_state.status,'expired');
    assert.equal(second.plot,old.plot);assert.deepEqual(second.story_outline.segments,old.story_outline.segments);
    assert.equal(project.episodes.length,2);
  });
  test('后集规划变化会使依赖全集规划的前集改编过期',()=>{
    const {snapshot,first,second}=fixture();second.plot='改为先救人，最终结果不变。';
    expireDownstream(snapshot,'episode-plot',second.id);
    assert.equal(first.story_outline.node_state.status,'expired');
  });
  test('完整改编正文由段落派生，不覆盖或重复保存规划',()=>{
    const {first}=fixture();first.story_outline.segments.push({sequence:2,duration_seconds:5,body:'甲打开信封，发现新的去向。',causal:'接续离开仓库'});
    assert.equal(adaptedStory(first),first.story_outline.segments.map(s=>s.body).join('\n\n'));
    assert.match(first.plot,/首集规划/);
  });
});

describe("duration-budget", () => {
  test('分集改编的小数时长仍按累计舍入交给镜头表，无独立二次预算',()=>{
    const segments=[{sequence:1,duration_seconds:10.4},{sequence:2,duration_seconds:10.4},{sequence:3,duration_seconds:10.4}];
    const budget=shotsBudget(segments,31.2);
    assert.equal(budget.target_seconds,31);
    assert.deepEqual(budget.segments.map(s=>s.budget_seconds),[10,11,10]);
  });
});
