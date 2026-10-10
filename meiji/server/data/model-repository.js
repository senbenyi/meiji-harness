import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  lstat,
  realpath,
  readdir,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { ProjectModel } from "../model/project-model.js";
import { validateProject } from "../../shared/project-contract.js";
import {
  assertFields,
  assertId,
  assertNumber,
  assertEnum,
  assertText,
  validateTask,
  validateStep,
  TERMINAL_TASKS,
  invalid,
} from "../../shared/task-contract.js";

const files = ["project", "tasks", "steps", "groups", "runtime"];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const encode = (value) => JSON.stringify(value, null, 2) + "\n";
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
const terminalSteps = new Set([
  "done",
  "failed",
  "skipped",
  "cancelled",
  "superseded",
]);
const fail = (code, message, status = 422) => {
  throw Object.assign(new Error(message), { code, status });
};

export function validateSnapshot(snapshot) {
  assertFields(snapshot, files, "snapshot");
  validateProject(snapshot.project);
  const unique = (rows, name) => {
    if (!Array.isArray(rows)) invalid(name, "需为数组");
    const map = new Map();
    for (const row of rows) {
      assertId(row.id, `${name}.id`);
      if (map.has(row.id)) invalid(name, "重复 ID");
      map.set(row.id, row);
    }
    return map;
  };
  const tasks = unique(snapshot.tasks, "tasks"),
    steps = unique(snapshot.steps, "steps"),
    groups = unique(snapshot.groups, "groups");
  for (const t of tasks.values()) {
    validateTask(
      t,
      TERMINAL_TASKS.includes(t.task_status) ? undefined : snapshot.project,
    );
    if (t.project_id !== snapshot.project.id)
      invalid("task.project_id", "跨项目");
    if (t.group_id && !groups.has(t.group_id))
      invalid("task.group_id", "组合不存在");
  }
  const sequences = new Set();
  for (const step of steps.values()) {
    const task = tasks.get(step.task_id);
    if (!task) invalid("step.task_id", "任务不存在或跨项目");
    validateStep(step, task);
    const key = `${step.task_id}:${step.seq}`;
    if (sequences.has(key)) invalid("step.seq", "重复步骤顺序");
    sequences.add(key);
  }
  for (const group of groups.values()) {
    assertFields(
      group,
      [
        "id",
        "project_id",
        "episode_id",
        "group_type",
        "source",
        "shot_ids",
        "created_at",
        "action",
        "continued_from_group_id",
        "opinion",
      ],
      "group",
    );
    if (group.project_id !== snapshot.project.id)
      invalid("group.project_id", "跨项目");
    assertId(group.episode_id, "group.episode_id");
    assertEnum(
      group.group_type,
      ["episode-seconds", "episode-film"],
      "group.group_type",
    );
    assertEnum(group.source, ["panel", "session"], "group.source");
    assertEnum(
      group.action,
      ["generate", "regenerate", "continue"],
      "group.action",
    );
    assertText(group.opinion, "group.opinion");
    if (group.action === "continue") {
      if (
        !groups.has(group.continued_from_group_id) ||
        group.continued_from_group_id === group.id
      )
        invalid("group.continued_from_group_id", "来源组合不存在");
      const origin = groups.get(group.continued_from_group_id);
      if (
        origin.episode_id !== group.episode_id ||
        origin.group_type !== group.group_type ||
        canonical(origin.shot_ids) !== canonical(group.shot_ids)
      )
        invalid("group", "继续组合需继承原范围");
    } else if (group.continued_from_group_id !== null)
      invalid("group.continued_from_group_id", "普通组合为空");
    if (!Number.isFinite(Date.parse(group.created_at)))
      invalid("group.created_at", "时间无效");
    if (
      !Array.isArray(group.shot_ids) ||
      !group.shot_ids.length ||
      new Set(group.shot_ids).size !== group.shot_ids.length
    )
      invalid("group.shot_ids", "需非空不重复数组");
    for (const id of group.shot_ids) assertId(id, "group.shot_ids");
    const members = [...tasks.values()]
      .filter((t) => t.group_id === group.id)
      .sort((a, b) => a.group_seq - b.group_seq);
    if (!members.length) invalid("group", "不可创建空组");
    members.forEach((task, index) => {
      if (
        task.group_seq !== index + 1 ||
        task.episode_id !== group.episode_id ||
        !group.shot_ids.includes(task.target_id)
      )
        invalid("group", "任务归属、范围或顺序错误");
    });
  }
  assertFields(
    snapshot.runtime,
    ["revision", "requests", "queue_stopped", "outbox"],
    "runtime",
  );
  assertNumber(snapshot.runtime.revision, "runtime.revision", 1);
  if (typeof snapshot.runtime.queue_stopped !== "boolean")
    invalid("runtime.queue_stopped", "需布尔值");
  if (
    !Array.isArray(snapshot.runtime.requests) ||
    !Array.isArray(snapshot.runtime.outbox)
  )
    invalid("runtime", "记录需数组");
  const keys = new Set();
  for (const record of snapshot.runtime.requests) {
    assertFields(record, ["id", "input_hash", "result"], "request");
    assertText(record.id, "request.id");
    if (!record.id || record.id.length > 128 || keys.has(record.id))
      invalid("request.id", "幂等键无效或重复");
    keys.add(record.id);
    if (!/^[a-f0-9]{64}$/.test(record.input_hash))
      invalid("request.input_hash", "指纹无效");
  }
  return snapshot;
}

function checkHistory(before, after) {
  for (const [key, status, terminal] of [
    ["tasks", "task_status", new Set(TERMINAL_TASKS)],
    ["steps", "step_status", terminalSteps],
  ]) {
    const next = new Map(after[key].map((row) => [row.id, row]));
    for (const row of before[key]) {
      if (!next.has(row.id)) invalid(key, "历史记录不可删除");
      if (
        terminal.has(row[status]) &&
        canonical(row) !== canonical(next.get(row.id))
      )
        invalid(key, "终态历史不可修改");
    }
  }
  const nextGroups = new Map(after.groups.map((g) => [g.id, g]));
  for (const g of before.groups)
    if (canonical(g) !== canonical(nextGroups.get(g.id)))
      invalid("groups", "组合成员及历史不可改写");
  for (const key of ["requests", "outbox"])
    for (const row of before.runtime[key]) {
      const next = after.runtime[key].find((r) => r.id === row.id);
      if (!next) invalid(`runtime.${key}`, "历史记录不可删除");
      if (key === "requests" && canonical(row) !== canonical(next))
        invalid("runtime.requests", "幂等结果不可修改");
    }
}

async function ordinary(path, directory = false) {
  const stat = await lstat(path);
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile())
  )
    fail("INVALID_STORAGE", "存储路径不是普通文件或目录");
}
async function durableWrite(path, data) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function syncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class ModelRepository extends EventEmitter {
  #root;
  #models = new Map();
  #snapshots = new Map();
  #locks = new Map();
  #hook;
  #ready;
  constructor(root, { checkpoint = async () => {} } = {}) {
    super();
    this.#root = resolve(root);
    this.#hook = checkpoint;
    this.#ready = (async () => {
      await mkdir(this.#root, { recursive: true });
      await ordinary(this.#root, true);
      this.#root = await realpath(this.#root);
    })();
  }
  async #serial(id, work) {
    assertId(id, "project_id");
    await this.#ready;
    const previous = this.#locks.get(id) || Promise.resolve();
    const running = previous.catch(() => {}).then(work);
    this.#locks.set(id, running);
    try {
      return await running;
    } finally {
      if (this.#locks.get(id) === running) this.#locks.delete(id);
    }
  }
  async create(project) {
    validateProject(project);
    return this.#serial(project.id, async () => {
      const dir = join(this.#root, project.id);
      try {
        await mkdir(dir);
      } catch (error) {
        if (error.code === "EEXIST") fail("PROJECT_EXISTS", "项目已存在", 409);
        throw error;
      }
      const snapshot = {
        project: structuredClone(project),
        tasks: [],
        steps: [],
        groups: [],
        runtime: {
          revision: 1,
          requests: [],
          queue_stopped: false,
          outbox: [],
        },
      };
      try {
        await this.#write(dir, snapshot);
        return this.#install(snapshot);
      } catch (error) {
        if (error.committed) {
          const saved = await this.#read(project.id);
          const model = this.#install(saved);
          this.#notify(project.id, saved.runtime.revision);
          return model;
        }
        await rm(dir, { recursive: true, force: true });
        throw error;
      }
    });
  }
  open(id) {
    if (/^[a-f0-9-]{36}$/i.test(id || ""))
      return Promise.reject(
        Object.assign(new Error("旧格式项目不受支持，可删除后重新创建"), {
          code: "UNSUPPORTED_PROJECT",
          status: 422,
        }),
      );
    return this.#serial(
      id,
      async () => this.#models.get(id) || this.#install(await this.#read(id)),
    );
  }
  async list() {
    await this.#ready;
    const rows = [];
    for (const name of await readdir(this.#root)) {
      if (name.endsWith(".json")) {
        rows.push({
          id: name.slice(0, -5),
          名称: name.slice(0, -5),
          unsupported: true,
        });
        continue;
      }
      if (!/^[a-z]+_[0-9a-f-]{36}$/.test(name)) continue;
      try {
        const model = await this.open(name);
        const p = model.read().project;
        rows.push({
          id: model.id,
          名称: p.名称,
          画幅: p.画幅,
          集数: p.剧集.length,
          已完成:
            p.剧集.length > 0 &&
            p.剧集.every((e) => e.合片.状态 === "generated"),
        });
      } catch (error) {
        rows.push({
          id: name,
          名称: name,
          unsupported: true,
          error: error.message,
        });
      }
    }
    return rows;
  }
  async remove(id) {
    return this.#serial(id, async () => {
      const model = this.#models.get(id) || this.#install(await this.#read(id));
      if (
        model
          .read()
          .tasks.some((t) => ["queued", "running"].includes(t.task_status))
      )
        fail("TASK_CONFLICT", "项目仍有未结束任务", 409);
      await rm(join(this.#root, id), { recursive: true });
      this.#models.delete(id);
      this.#snapshots.delete(id);
      return { deleted: true };
    });
  }
  async removeUnsupported(id) {
    await this.#ready;
    if (!/^[a-f0-9-]{36}$/i.test(id || ""))
      invalid("project_id", "旧项目 ID 无效");
    const file = join(this.#root, id + ".json"),
      directory = join(this.#root, id);
    await ordinary(file);
    try {
      await ordinary(directory, true);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rm(file);
    await rm(directory, { recursive: true, force: true });
    return { deleted: true };
  }
  #install(snapshot) {
    const id = snapshot.project.id;
    let model = this.#models.get(id);
    this.#snapshots.set(id, structuredClone(snapshot));
    if (!model) {
      model = new ProjectModel(
        () => this.#snapshots.get(id),
        (key, input, mutate) => this.#commit(id, key, input, mutate),
      );
      this.#models.set(id, model);
    }
    return model;
  }
  async #read(id) {
    const dir = join(this.#root, id);
    await ordinary(dir, true);
    let pointer;
    try {
      await ordinary(join(dir, "CURRENT"));
      pointer = JSON.parse(await readFile(join(dir, "CURRENT"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT")
        fail("UNSUPPORTED_PROJECT", "缺少新版本 CURRENT，旧格式项目不受支持");
      throw error;
    }
    assertFields(
      pointer,
      ["version", "generation", "revision", "hashes"],
      "CURRENT",
    );
    if (pointer.version !== 1 || !/^g-[a-f0-9-]{36}$/.test(pointer.generation))
      fail("INVALID_STORAGE", "存储版本或数据代无效");
    assertNumber(pointer.revision, "CURRENT.revision", 1);
    assertFields(pointer.hashes, files, "CURRENT.hashes");
    const generation = join(dir, pointer.generation);
    await ordinary(generation, true);
    const snapshot = {};
    for (const name of files) {
      const path = join(generation, `${name}.json`);
      await ordinary(path);
      const bytes = await readFile(path);
      if (hash(bytes) !== pointer.hashes[name])
        fail("CORRUPT_STORAGE", `数据损坏：${name}`);
      snapshot[name] = JSON.parse(bytes.toString());
    }
    validateSnapshot(snapshot);
    if (
      snapshot.project.id !== id ||
      snapshot.runtime.revision !== pointer.revision
    )
      fail("CORRUPT_STORAGE", "项目身份或版本不匹配");
    // 中断前未发布的数据代不会恢复；保留已发布的旧代供排查。
    for (const name of await readdir(dir))
      if (name.startsWith(".CURRENT-"))
        await rm(join(dir, name), { force: true });
    return snapshot;
  }
  async #write(dir, snapshot) {
    validateSnapshot(snapshot);
    const name = `g-${randomUUID()}`,
      generation = join(dir, name),
      pointerTemp = join(dir, `.CURRENT-${randomUUID()}`);
    await ordinary(dir, true);
    await mkdir(generation);
    let committed = false;
    try {
      const hashes = {};
      for (const key of files) {
        const data = encode(snapshot[key]);
        await durableWrite(join(generation, `${key}.json`), data);
        hashes[key] = hash(data);
        await this.#hook(`after-${key}`, snapshot);
      }
      await syncDirectory(generation);
      const pointer = {
        version: 1,
        generation: name,
        revision: snapshot.runtime.revision,
        hashes,
      };
      await durableWrite(pointerTemp, encode(pointer));
      await this.#hook("before-current", snapshot);
      await rename(pointerTemp, join(dir, "CURRENT"));
      committed = true;
      await syncDirectory(dir);
      await this.#hook("after-current", snapshot);
    } catch (error) {
      if (!committed) {
        await rm(generation, { recursive: true, force: true });
        await rm(pointerTemp, { force: true });
      } else
        Object.assign(error, {
          code: "COMMIT_ACCEPTED",
          committed: true,
          revision: snapshot.runtime.revision,
        });
      throw error;
    }
  }
  async #commit(id, key, input, mutate) {
    if (typeof key !== "string" || !key || key.length > 128)
      invalid("request_id", "幂等键无效");
    return this.#serial(id, async () => {
      const model = this.#models.get(id) || this.#install(await this.#read(id)),
        before = model.read();
      const inputHash = hash(canonical(input)),
        previous = before.runtime.requests.find((r) => r.id === key);
      if (previous) {
        if (previous.input_hash !== inputHash)
          fail("IDEMPOTENCY_CONFLICT", "幂等键已用于不同输入", 409);
        return structuredClone(previous.result);
      }
      const next = structuredClone(before);
      const result = await mutate(next);
      next.runtime.revision = before.runtime.revision + 1;
      const accepted = {
        ...structuredClone(result),
        accepted: true,
        revision: next.runtime.revision,
      };
      next.runtime.requests.push({
        id: key,
        input_hash: inputHash,
        result: accepted,
      });
      validateSnapshot(next);
      checkHistory(before, next);
      try {
        await this.#write(join(this.#root, id), next);
      } catch (error) {
        if (!error.committed) throw error;
        const saved = await this.#read(id);
        this.#install(saved);
        this.#notify(id, saved.runtime.revision);
        return { ...accepted, storage_warning: error.message };
      }
      this.#install(next);
      this.#notify(id, next.runtime.revision);
      return structuredClone(accepted);
    });
  }
  #notify(projectId, revision) {
    // 订阅者抛错不应把已提交命令变成未受理，也不应阻断其他订阅者。
    for (const listener of this.listeners("change"))
      try {
        listener({ project_id: projectId, revision });
      } catch {}
  }
}
