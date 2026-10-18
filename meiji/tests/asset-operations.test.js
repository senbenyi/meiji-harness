import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-manager.js";
import { createHandlerRegistry } from "../server/handlers/handler-registry.js";
import { commitContent } from "../server/handlers/content.js";
import { mergeCharacters } from "../shared/collection-identity.js";
import { projectFixture } from "./fixtures/project.js";

describe("deletion", () => {
  test("被引用角色/默认服装/素材库引用均禁止删除；服装删除一次重绑与过期", async () => {
    const root = await mkdtemp(join(tmpdir(), "meiji-delete-"));
    let service;
    try {
      const p = projectFixture(),
        raw = {
          name: "甲", gender: "男", era: "宋代", position: "主角", age_range: "青年", body_type: "", hairstyle: "", signature_props: [], immutable_traits: [],
          costumes: [
            { name: "默认", color: "白", material: "", props: [] },
            { name: "外套", color: "黑", material: "", props: [] },
          ],
        };
      p.character_library.characters = mergeCharacters(p, [raw]).characters;
      const c = p.character_library.characters[0],
        co = c.costumes[1],
        e = p.episodes[0],
        shot = e.shot_list.shots[0];
      c.default_costume_id = c.costumes[0].id;
      shot.on_screen_characters = [{ character_id: c.id, costume_id: co.id }];
      const repo = new ModelRepository(root),
        model = await repo.create(p);
      let refs = [];
      service = new TaskService({
        repository: repo,
        commitOutput: commitContent,
        execute: createHandlerRegistry({
          text: () => {
            throw Error("不调用 AI");
          },
          media: () => {
            throw Error("不调用媒体");
          },
        }),
        libraryReferences: async () => refs,
      });
      const del = async (b, id) => {
        const result = await service.command({
          type: "delete",
          project_id: p.id,
          request_id: crypto.randomUUID(),
          business_type: b,
          target_id: id,
        });
        await service.idle(p.id);
        return model.readAll().tasks.find((t) => t.id === result.task_id);
      };
      assert.equal((await del("character-delete", c.id)).task_status, "rejected");
      assert.equal(
        (await del("costume-delete", c.default_costume_id)).task_status,
        "rejected",
      );
      refs = [co.id];
      assert.equal((await del("costume-delete", co.id)).task_status, "rejected");
      refs = [];
      assert.equal((await del("costume-delete", co.id)).task_status, "completed");
      const next = model.readAll();
      assert.equal(next.project.character_library.characters[0].costumes.length, 1);
      assert.equal(
        next.project.episodes[0].shot_list.shots[0].on_screen_characters[0].costume_id,
        c.default_costume_id,
      );
      assert.equal(next.project.episodes[0].shot_list.shots[0].video.node_state.status, "expired");
      assert.equal(next.project.episodes[0].shot_list.shots[0].video.address, shot.video.address);
      assert.ok(next.tasks.slice(0, 3).every((t) => t.task_status === "rejected"));
    } finally {
      await service?.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("manual-tasks", () => {
  test("人工编辑与放行均两步，AI 不调用；非法内容保留旧稿", async () => {
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
        content: "人工新稿",
      });
      await service.idle(p.id);
      assert.equal(model.readAll().project.project_summary.body, "人工新稿");
      assert.deepEqual(
        model.readAll().steps.map((s) => s.kind),
        ["precheck", "manual_edit"],
      );
      await service.command({
        ...base,
        type: "manual-edit",
        request_id: "invalid",
        content: "",
      });
      await service.idle(p.id);
      assert.equal(model.readAll().project.project_summary.body, "人工新稿");
      assert.equal(model.readAll().tasks[1].task_status, "rejected");
      await model.update("set-rejected", {}, (s) => {
        s.project.project_summary.node_state.status = "rejected";
        s.project.project_summary.node_state.reason = "审核不通过";
        s.project.project_summary.node_state.fail_message = "";
        return {};
      });
      await service.command({
        ...base,
        type: "override",
        request_id: "override",
      });
      await service.idle(p.id);
      assert.equal(model.readAll().tasks[2].task_status, "completed");
      assert.equal(model.readAll().project.project_summary.node_state.status, "generated");
      assert.equal(model.readAll().tasks[1].task_status, "rejected");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  for (const business of ["outline", "shots"])
    test(`${business}人工编辑只查结构，人工放行保留程序时长审核`, async () => {
      const root = await mkdtemp(join(tmpdir(), "meiji-manual-duration-")), repository = new ModelRepository(root), project = projectFixture();
      const episode = project.episodes[0];
      episode.duration_seconds = business === "outline" ? 150 : 10;
      const fields = ["title", "id", "duration_seconds", "shot_scale", "hook", "body", "continuity_transition", "reference_anchor", "audio_arrangement", "on_screen_characters", "background_characters"];
      const content = business === "outline"
        ? { segments: [{ sequence: 1, duration_seconds: 119, body: "人工保留完整剧情", causal: "承接前段" }] }
        : { shots: episode.shot_list.shots.map((shot, index) => ({ ...Object.fromEntries(fields.map(key => [key, structuredClone(shot[key])])), duration_seconds: index === 0 ? 3 : 5 })) };
      const model = await repository.create(project), service = new TaskService({ repository, commitOutput: commitContent,
        execute: createHandlerRegistry({ text: () => { throw Error("人工操作不调用AI"); }, media: () => { throw Error("不调用媒体"); } }),
      });
      const base = { project_id: project.id, business_type: business, target_id: episode.id };
      const node = snapshot => snapshot.project.episodes[0][business === "outline" ? "story_outline" : "shot_list"];
      try {
        const edit = await service.command({ ...base, type: "manual-edit", request_id: "edit", content });
        await service.idle(project.id);
        assert.equal(model.readAll().tasks.find(task => task.id === edit.task_id).task_status, "completed");
        assert.equal(node(model.readAll()).node_state.status, "generated");
        if (business === "outline") assert.equal(model.readAll().project.episodes[0].duration_seconds, 150);
        const savedContent = structuredClone(node(model.readAll()));
        const reject = async (key, repair) => model.update(key, {}, snapshot => {
          const current = node(snapshot);
          // 独立构造原参考150秒的未通过候选，验证放行始终使用固定集参考审核。
          if (business === "outline") snapshot.project.episodes[0].duration_seconds = 150;
          current.node_state.status = "rejected";
          current.node_state.reason = "尚有待处理意见";
          current.node_state.fail_message = "";
          if (repair) {
            if (business === "outline") current.segments[0].duration_seconds = 137.5;
            else current.shots[0].duration_seconds = 5;
          }
          return {};
        });
        await reject("mark-rejected", false);
        const blocked = await service.command({ ...base, type: "override", request_id: "outside-range" });
        await service.idle(project.id);
        const blockedSnapshot = model.readAll(), blockedTask = blockedSnapshot.tasks.find(task => task.id === blocked.task_id);
        assert.equal(blockedTask.task_status, "rejected");
        assert.equal(blockedSnapshot.steps.find(step => step.task_id === blocked.task_id && step.step_status === "rejected").kind, "precheck");
        assert.match(blockedTask.end_reason, business === "outline" ? /允许误差±30秒/ : /4–15/);
        assert.deepEqual(business === "outline" ? node(blockedSnapshot).segments : node(blockedSnapshot).shots, business === "outline" ? savedContent.segments : savedContent.shots);
        await reject("repair-rejected", true);
        const allowed = await service.command({ ...base, type: "override", request_id: "inside-range" });
        await service.idle(project.id);
        const accepted = model.readAll();
        assert.equal(accepted.tasks.find(task => task.id === allowed.task_id).task_status, "completed");
        assert.equal(node(accepted).node_state.status, "generated");
        if (business === "outline") assert.equal(accepted.project.episodes[0].duration_seconds, 150);
        assert.deepEqual(accepted.steps.filter(step => step.task_id === allowed.task_id).map(step => step.kind), ["precheck", "override"]);
      } finally { await service.dispose(); await repository.close(); await rm(root, { recursive: true, force: true }); }
    });
});
