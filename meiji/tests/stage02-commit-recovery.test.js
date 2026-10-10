import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRepository } from "../server/data/model-repository.js";
import { emptyProject } from "../shared/project-contract.js";
import { createId } from "../shared/task-contract.js";

for (const point of [
  "after-project",
  "after-tasks",
  "after-steps",
  "after-groups",
  "after-runtime",
  "before-commit",
  "after-commit",
]) {
  test(`S2-03 ${point} 中断后重载为完整旧事务或完整新事务`, async () => {
    const root = await mkdtemp(join(tmpdir(), "meiji-commit-"));
    let armed = false;
    try {
      const repo = new ModelRepository(root, {
          checkpoint: (name) => {
            if (armed && name === point) throw new Error(`注入：${name}`);
          },
        }),
        p = emptyProject(),
        model = await repo.create(p);
      const t = {
        id: createId("task"),
        project_id: p.id,
        episode_id: null,
        business_type: "project-summary",
        target_id: p.id,
        action: "generate",
        group_id: null,
        group_seq: null,
        task_status: "completed",
        source: "panel",
        queue_order: 1,
        end_reason: "",
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        opinion: "",
        previous_node_state: { 状态: "empty", 原因: "" },
      };
      let mutations = 0;
      armed = true;
      const update = () =>
        model.update("atomic", { operation: "complete" }, (s) => {
          mutations++;
          s.project.项目摘要 = {
            状态: "generated",
            原因: "",
            正文: "新摘要",
            剧本版本: 1,
          };
          t.group_id = createId("group"); t.group_seq = 1;
          s.groups = [{ id: t.group_id, project_id: p.id, episode_id: null, group_type: "single", source: t.source, shot_ids: [], action: t.action, continued_from_group_id: null, opinion: "", created_at: t.created_at }];
          s.tasks = [t];
          return { task_id: t.id };
        });
      if (point === "after-commit") {
        const result = await update();
        assert.equal(result.accepted, true);
        assert.ok(result.storage_warning);
        assert.equal((await update()).task_id, t.id);
        assert.equal(mutations, 1);
      } else await assert.rejects(update(), /注入/);
      const fresh = await new ModelRepository(root).open(p.id),
        snapshot = fresh.read(),
        published = point === "after-commit";
      assert.equal(
        snapshot.project.项目摘要.状态,
        published ? "generated" : "empty",
      );
      assert.equal(snapshot.tasks.length, published ? 1 : 0);
      assert.equal(snapshot.runtime.requests.length, published ? 1 : 0);
      assert.deepEqual(snapshot, model.read());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("S2-05 SQLite 约束拒绝非法项目 JSON，保留原数据", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-corrupt-"));
  try {
    const repo = new ModelRepository(root), p = emptyProject();
    await repo.create(p);
    const db = new DatabaseSync(join(root, "meiji.sqlite"));
    assert.throws(() => db.prepare("UPDATE projects SET data_json=? WHERE id=?").run("invalid JSON", p.id));
    db.close();
    assert.deepEqual((await new ModelRepository(root).open(p.id)).read().project, p);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("S2-03 创建项目发布后出错仍返回已创建 Model，不反馈未受理", async () => {
  const root = await mkdtemp(join(tmpdir(), "meiji-create-commit-"));
  try {
    const repo = new ModelRepository(root, {
        checkpoint: (point) => {
          if (point === "after-commit") throw new Error("发布后异常");
        },
      }),
      p = emptyProject();
    const model = await repo.create(p);
    assert.equal(model.id, p.id);
    assert.deepEqual(
      (await new ModelRepository(root).open(p.id)).read(),
      model.read(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
