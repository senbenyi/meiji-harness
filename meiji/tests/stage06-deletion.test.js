import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ModelRepository } from "../server/data/model-repository.js";
import { TaskService } from "../server/flow/tasks/task-service.js";
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
        编号: "C01",
        名称: "甲",
        国籍: "",
        身份: "",
        身份特征: "",
        性别: "",
        年代: "",
        年龄: "",
        身高: "",
        体型: "",
        面相: "",
        声音: "",
        必出: true,
        默认服装编号: "C01-01",
        服装: [
          { 编号: "C01-01", 名称: "默认", 描述: "白衣" },
          { 编号: "C01-02", 名称: "外套", 描述: "黑衣" },
        ],
      };
    p.角色库.角色 = mergeCharacters(p, [raw]).characters;
    const c = p.角色库.角色[0],
      co = c.服装[1],
      e = p.剧集[0],
      shot = e.镜头表.镜头[0];
    shot.出镜角色 = [{ 角色id: c.id, 服装id: co.id }];
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
      if (
        model.read().tasks.find((t) => t.id === result.task_id).task_status ===
          "queued" &&
        model.read().runtime.queue_stopped
      )
        await service.command({
          type: "start-queued",
          project_id: p.id,
          request_id: crypto.randomUUID(),
          task_id: result.task_id,
        });
      await service.idle(p.id);
      return model.read().tasks.find((t) => t.id === result.task_id);
    };
    assert.equal((await del("character-delete", c.id)).task_status, "failed");
    assert.equal(
      (await del("costume-delete", c.默认服装id)).task_status,
      "failed",
    );
    refs = [co.id];
    assert.equal((await del("costume-delete", co.id)).task_status, "failed");
    refs = [];
    assert.equal((await del("costume-delete", co.id)).task_status, "completed");
    const next = model.read();
    assert.equal(next.project.角色库.角色[0].服装.length, 1);
    assert.equal(
      next.project.剧集[0].镜头表.镜头[0].出镜角色[0].服装id,
      c.默认服装id,
    );
    assert.equal(next.project.剧集[0].镜头表.镜头[0].视频.状态, "expired");
    assert.equal(next.project.剧集[0].镜头表.镜头[0].视频.地址, shot.视频.地址);
    assert.ok(next.tasks.slice(0, 3).every((t) => t.task_status === "failed"));
  } finally {
    await service?.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
