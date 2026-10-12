import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRepository } from "../server/data/model-repository.js";
import { taskDetail, groupDetail } from "../server/data/task-store.js";
import { createId } from "../shared/task_contract.js";
import {
  emptyProject,
  emptyEpisode,
  emptyShot,
} from "../shared/project_contract.js";

export function fixture() {
  const p = emptyProject({ 名称: "存储测试" }),
    e = emptyEpisode();
  e.镜头表.镜头 = [emptyShot()];
  p.剧集 = [e];
  return p;
}
export function task(p, fields = {}) {
  return {
    id: createId("task"),
    project_id: p.id,
    episode_id: p.剧集[0].id,
    business_type: "seconds",
    target_id: p.剧集[0].镜头表.镜头[0].id,
    action: "generate",
    group_id: null,
    group_seq: null,
    task_status: "queued",
    source: "panel",
    queue_order: 1,
    end_reason: "",
    created_at: new Date().toISOString(),
    started_at: null,
    ended_at: null,
    opinion: "",
    previous_node_state: { 状态: "empty", 原因: "" },
    ...fields,
  };
}
export function step(t, seq = 1) {
  return {
    id: createId("step"),
    task_id: t.id,
    seq,
    kind: seq === 1 ? "precheck" : "generate",
    round: 0,
    step_status: "ready",
    error_reason: "",
    prompt: null,
    result: null,
    started_at: null,
    ended_at: null,
  };
}
async function withStore(work) {
  const root = await mkdtemp(join(tmpdir(), "meiji-storage-"));
  try {
    await work(root, new ModelRepository(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("S2-01/02 项目、独立 task/step/group 重载一致，查询按顺序，组状态不落盘", () =>
  withStore(async (root, repo) => {
    const p = fixture(),
      model = await repo.create(p);
    assert.equal(await repo.open(p.id), model);
    assert.equal(model.publish, undefined);
    const g = {
      id: createId("group"),
      project_id: p.id,
      episode_id: p.剧集[0].id,
      group_type: "episode-seconds",
      source: "panel",
      created_at: new Date().toISOString(),
      shot_ids: [p.剧集[0].镜头表.镜头[0].id],
      action: "generate",
      continued_from_group_id: null,
      opinion: "",
    };
    const a = task(p, { group_id: g.id, group_seq: 1 }),
      b = task(p, { group_id: g.id, group_seq: 2, queue_order: 2 });

    await model.update("create-group", { group: g.id }, (s) => {
      s.tasks = [b, a];
      s.steps = [step(a, 2), step(a, 1)];
      s.groups = [g];
      return { group_id: g.id };
    });
    assert.deepEqual(
      groupDetail(model, g.id).tasks.map((t) => t.id),
      [a.id, b.id],
    );
    assert.deepEqual(
      taskDetail(model, a.id).steps.map((s) => s.seq),
      [1, 2],
    );
    assert.equal(groupDetail(model, g.id).status, "queued");
    const restored = await new ModelRepository(root).open(p.id);
    assert.deepEqual(restored.read(), model.read());
    assert.ok(!("steps" in restored.read().tasks[0]));
    assert.ok(!("status" in restored.read().groups[0]));
    const db = new DatabaseSync(join(root, "meiji.sqlite"));
    assert.equal(db.prepare("SELECT revision FROM projects WHERE id=?").get(p.id).revision, 2);
    assert.equal(db.prepare("SELECT count(*) AS n FROM task_groups").get().n, 1);
    db.close();
    const view = restored.read();
    view.project.名称 = "外部修改";
    assert.equal(restored.read().project.名称, "存储测试");
  }));

test("S2-04 并发、幂等和不同项目隔离，无覆盖丢失；同键不同输入拒绝", () =>
  withStore(async (root, repo) => {
    const p = fixture(),
      q = fixture(),
      model = await repo.create(p),
      other = await repo.create(q);
    let calls = 0;
    const same = () =>
      model.update("same", { n: 1 }, (s) => {
        calls++;
        s.project.剧本.版本++;
        return { value: s.project.剧本.版本 };
      });
    const [a, b] = await Promise.all([same(), same()]);
    assert.deepEqual(a, b);
    assert.equal(calls, 1);
    await assert.rejects(
      model.update("same", { n: 2 }, () => {}),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    await Promise.all(
      Array.from({ length: 8 }, (_, n) =>
        model.update(`add-${n}`, { n }, (s) => {
          s.project.剧本.版本++;
          return {};
        }),
      ).concat(
        other.update("other", {}, (s) => {
          s.project.名称 = "独立项目";
          return {};
        }),
      ),
    );
    assert.equal(model.read().project.剧本.版本, 10);
    assert.equal(other.read().project.剧本.版本, 1);
    assert.equal(other.read().project.名称, "独立项目");
    const fresh = await new ModelRepository(root).open(p.id);
    assert.equal(fresh.read().project.剧本.版本, 10);
  }));

test("S2-05 非法路径、符号链接、跨项目步骤及旧格式拒绝，不改合法数据", () =>
  withStore(async (root, repo) => {
    const p = fixture(),
      model = await repo.create(p),
      before = model.read();
    await assert.rejects(repo.open("../escape"), /UUID/);
    await assert.rejects(
      model.update("bad-step", {}, (s) => {
        s.steps = [step(task(fixture()))];
        return {};
      }),
      /任务不存在/,
    );
    assert.deepEqual(model.read(), before);
    const legacy = createId("project");
    await mkdir(join(root, legacy));
    await assert.rejects(repo.open(legacy), { code: "UNSUPPORTED_PROJECT" });
    const linked = createId("project");
    await symlink(join(root, p.id), join(root, linked));
    await assert.rejects(repo.open(linked), { code: "INVALID_STORAGE" });
  }));

test("S2-06 Model 写入后事件与重载一致，订阅错误不影响提交", () =>
  withStore(async (root, repo) => {
    const model = await repo.create(fixture()),
      events = [];
    repo.on("change", () => {
      throw new Error("UI 错误");
    });
    repo.on("change", (event) =>
      events.push({ event, project: model.read().project }),
    );
    const result = await model.update("edit", {}, (s) => {
      s.project.名称 = "已保存";
      return {};
    });
    assert.equal(result.accepted, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].project.名称, "已保存");
    assert.equal(events[0].event.revision, result.revision);
    assert.deepEqual(
      (await new ModelRepository(root).open(model.id)).read(),
      model.read(),
    );
  }));

test("S2 历史终态 task/step/group 不可改写或删除", () =>
  withStore(async (root, repo) => {
    const p = fixture(),
      model = await repo.create(p),
      t = task(p, {
        task_status: "completed",
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
      }),
      st = { ...step(t), step_status: "done" };
    await model.update("history", {}, (s) => {
      t.group_id = createId("group"); t.group_seq = 1;
      s.groups = [{ id: t.group_id, project_id: p.id, episode_id: t.episode_id, group_type: "single", source: t.source, shot_ids: [], action: t.action, continued_from_group_id: null, opinion: "", created_at: t.created_at }];
      s.tasks = [t];
      s.steps = [st];
      return {};
    });
    await assert.rejects(
      model.update("revive", {}, (s) => {
        s.tasks[0].task_status = "queued";
        return {};
      }),
      /终态/,
    );
    await assert.rejects(
      model.update("erase", {}, (s) => {
        s.tasks = [];
        s.steps = [];
        s.groups = [];
        return {};
      }),
      /历史/,
    );
    assert.equal(model.read().tasks[0].task_status, "completed");
  }));
