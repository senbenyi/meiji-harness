import test from "node:test";
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
test("S6-07 被引用角色/默认服装/素材库引用均禁止删除；服装删除一次重绑与过期", async () => {
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
