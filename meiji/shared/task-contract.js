import {
  BUSINESS_TARGET,
  NODE_TYPES,
  NODE_DEFINITIONS,
} from "./node-definitions.js";

// 新任务协议的纯模块；不读取旧 Run、任务历史或文件。
export const NODE_STATUS = Object.freeze([
  "empty",
  "queued",
  "running",
  "generated",
  "rejected",
  "failed",
  "cancelled",
  "expired",
]);
export const TASK_STATUS = Object.freeze([
  "queued",
  "running",
  "completed",
  "rejected",
  "failed",
  "cancelled",
  "superseded",
]);
export const STEP_STATUS = Object.freeze([
  "ready",
  "running",
  "done",
  "failed",
  "skipped",
  "cancelled",
  "superseded",
]);
export const STEP_KINDS = Object.freeze([
  "precheck",
  "generate",
  "review",
  "revise",
  "manual_edit",
  "override",
  "impact",
  "apply",
]);
export const ACTIONS = Object.freeze([
  "generate",
  "regenerate",
  "continue",
  "manual_edit",
  "override",
  "delete",
]);
export { BUSINESS_TARGET, NODE_TYPES };
export const ID_PREFIX = Object.freeze({
  project: "p",
  episode: "e",
  character: "c",
  costume: "co",
  shot: "s",
  rule: "r",
  task: "t",
  group: "tg",
  step: "st",
});
export const TERMINAL_TASKS = Object.freeze([
  "completed",
  "rejected",
  "failed",
  "cancelled",
  "superseded",
]);
export function invalid(path, message) {
  throw Object.assign(new Error(`${path}：${message}`), {
    code: "INVALID_CONTRACT",
    status: 422,
    path,
  });
}
export function createId(kind) {
  if (!ID_PREFIX[kind]) invalid("id", "未知对象类型");
  return `${ID_PREFIX[kind]}_${globalThis.crypto.randomUUID()}`;
}
export function assertId(value, path = "id") {
  if (
    typeof value !== "string" ||
    !/^[a-z]+_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    invalid(path, "需为创建时生成的带前缀 UUID");
  return value;
}
export function assertRecord(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(path, "需为对象");
  return value;
}
export function assertText(value, path) {
  if (typeof value !== "string") invalid(path, "需为文本");
  return value;
}
export function assertNumber(value, path, min = 0) {
  if (!Number.isInteger(value) || value < min)
    invalid(path, `需为不小于 ${min} 的整数`);
  return value;
}
export function assertEnum(value, values, path) {
  if (!values.includes(value)) invalid(path, "值不在协议枚举内");
  return value;
}
export function assertFields(value, keys, path) {
  assertRecord(value, path);
  for (const k of Object.keys(value))
    if (!keys.includes(k)) invalid(`${path}.${k}`, "未定义字段");
  for (const k of keys)
    if (!Object.hasOwn(value, k)) invalid(`${path}.${k}`, "缺少字段");
  return value;
}
export function validateNode(node, path, checkHash = true) {
  assertRecord(node, path);
  assertEnum(node.状态, NODE_STATUS, `${path}.状态`);
  assertText(node.原因, `${path}.原因`);
  if (checkHash) {
    assertText(node.依赖hash, `${path}.依赖hash`);
    if (node.依赖hash && !/^[a-f0-9]{64}$/.test(node.依赖hash))
      invalid(`${path}.依赖hash`, "需为空或依赖指纹");
  }
  const needs = ["rejected", "failed", "cancelled", "expired"].includes(
    node.状态,
  );
  if (needs !== Boolean(node.原因.trim()))
    invalid(`${path}.原因`, needs ? "当前状态必须有原因" : "当前状态原因为空");
  return node;
}
export function locateTarget(project, business, targetId) {
  const kind = BUSINESS_TARGET[business];
  if (!kind) invalid("business_type", "未知任务业务");
  if (kind === "project" && project.id === targetId)
    return { kind, object: project, episode: null };
  if (kind === "character" || kind === "costume")
    for (const c of project.角色库.角色) {
      if (kind === "character" && c.id === targetId)
        return { kind, object: c, episode: null };
      for (const co of c.服装)
        if (kind === "costume" && co.id === targetId)
          return { kind, object: co, character: c, episode: null };
    }
  for (const e of project.剧集) {
    if (kind === "episode" && e.id === targetId)
      return { kind, object: e, episode: e };
    for (const s of e.镜头表.镜头)
      if (kind === "shot" && s.id === targetId)
        return { kind, object: s, episode: e };
  }
  invalid("target_id", "目标不存在或与业务归属不符");
}
export function nodeOf(project, business, targetId) {
  const definition = NODE_DEFINITIONS[business];
  if (!definition) return null;
  return locateTarget(project, business, targetId).object[definition.field];
}
const taskFields = [
  "id",
  "project_id",
  "episode_id",
  "business_type",
  "target_id",
  "action",
  "group_id",
  "group_seq",
  "task_status",
  "source",
  "queue_order",
  "end_reason",
  "created_at",
  "started_at",
  "ended_at",
  "opinion",
  "previous_node_state",
];
export function validateTask(t, p) {
  assertFields(t, [...taskFields, ...(Object.hasOwn(t, "name") ? ["name"] : [])], "task");
  if (Object.hasOwn(t, "name")) { assertText(t.name, "task.name"); if (!t.name.trim()) invalid("task.name", "不可为空"); }
  for (const k of ["id", "project_id", "target_id"])
    assertId(t[k], `task.${k}`);
  const removedBusiness = t.business_type === "episode-characters";
  if (removedBusiness && !TERMINAL_TASKS.includes(t.task_status))
    invalid("task.business_type", "已移除的任务只能保留为历史终态");
  assertEnum(t.business_type, [
    ...Object.keys(BUSINESS_TARGET),
    ...(removedBusiness ? ["episode-characters"] : []),
  ], "task.business_type");
  if (t.episode_id !== null) assertId(t.episode_id, "task.episode_id");
  if (NODE_TYPES.includes(t.business_type) || removedBusiness) {
    assertFields(
      t.previous_node_state,
      ["状态", "原因"],
      "task.previous_node_state",
    );
    validateNode(t.previous_node_state, "task.previous_node_state", false);
  } else if (t.previous_node_state !== null)
    invalid("task.previous_node_state", "非节点任务为空");
  assertEnum(t.action, ACTIONS, "task.action");
  assertEnum(t.task_status, TASK_STATUS, "task.task_status");
  assertEnum(t.source, ["panel", "session"], "task.source");
  assertNumber(t.queue_order, "task.queue_order", 1);
  assertText(t.opinion, "task.opinion");
  assertText(t.end_reason, "task.end_reason");
  timestamps(t, "task");
  if (t.group_id !== null) {
    assertId(t.group_id, "task.group_id");
    assertNumber(t.group_seq, "task.group_seq", 1);
  } else if (t.group_seq !== null) invalid("task.group_seq", "普通任务为空");
  if (t.action === "continue" && !t.group_id)
    invalid("task.action", "继续仅用于组合");
  if (t.business_type.endsWith("-delete") !== (t.action === "delete"))
    invalid("task.action", "删除方式与业务不一致");
  if (
    ["rejected", "failed", "cancelled", "superseded"].includes(t.task_status) &&
    !t.end_reason.trim()
  )
    invalid("task.end_reason", "终态需原因");
  if (
    ["queued", "running", "completed"].includes(t.task_status) &&
    t.end_reason
  )
    invalid("task.end_reason", "当前状态原因为空");
  if (p) {
    if (p.id !== t.project_id) invalid("task.project_id", "跨项目");
    const target = locateTarget(p, t.business_type, t.target_id);
    if ((target.episode?.id ?? null) !== t.episode_id)
      invalid("task.episode_id", "剧集归属不符");
    const node = nodeOf(p, t.business_type, t.target_id);
    if (node) validateNode(t.previous_node_state, "task.previous_node_state", false);
    else if (t.previous_node_state !== null)
      invalid("task.previous_node_state", "非节点任务为空");
  }
  return t;
}
export function timestamps(value, path) {
  assertText(value.created_at ?? "", `${path}.created_at`);
  for (const key of ["created_at", "started_at", "ended_at"]) {
    const v = value[key];
    if (v === undefined) continue;
    if (
      v !== null &&
      (typeof v !== "string" || !Number.isFinite(Date.parse(v)))
    )
      invalid(`${path}.${key}`, "需为时间或空值");
  }
}
export function validateStep(s, t) {
  assertFields(
    s,
    [
      "id",
      "task_id",
      "seq",
      "kind",
      "round",
      "step_status",
      "error_reason",
      "prompt",
      "result",
      "started_at",
      "ended_at",
      ...(Object.hasOwn(s, "name") ? ["name"] : []),
    ],
    "step",
  );
  if (Object.hasOwn(s, "name")) { assertText(s.name, "step.name"); if (!s.name.trim()) invalid("step.name", "不可为空"); }
  assertId(s.id, "step.id");
  assertId(s.task_id, "step.task_id");
  if (t && t.id !== s.task_id) invalid("step.task_id", "任务归属不符");
  assertNumber(s.seq, "step.seq", 1);
  assertEnum(s.kind, STEP_KINDS, "step.kind");
  assertNumber(s.round, "step.round");
  if (s.round > 2) invalid("step.round", "最多两轮");
  assertEnum(s.step_status, STEP_STATUS, "step.step_status");
  assertText(s.error_reason, "step.error_reason");
  if (s.step_status === "failed" && !s.error_reason.trim())
    invalid("step.error_reason", "失败需原因");
  timestamps(s, "step");
  return s;
}
export const COMMANDS = Object.freeze([
  "submit",
  "submit-group",
  "query",
  "cancel",
  "continue-group",
  "manual-edit",
  "override",
  "delete",
  "start-queued",
  "remove-queued",
]);
const commandFields = {
  submit: ["business_type", "target_id", "action", "opinion"],
  "submit-group": ["group_type", "episode_id"],
  query: ["task_id", "group_id"],
  cancel: ["task_id"],
  "continue-group": ["group_id"],
  "manual-edit": ["business_type", "target_id", "content"],
  override: ["business_type", "target_id"],
  delete: ["business_type", "target_id"],
  "start-queued": ["task_id"],
  "remove-queued": ["task_id"],
};
export function validateCommand(command) {
  assertRecord(command, "command");
  assertEnum(command.type, COMMANDS, "command.type（命令）");
  assertId(command.project_id, "command.project_id");
  const allowed = [
    "type",
    "project_id",
    ...commandFields[command.type],
    ...(command.type === "submit-group" ? ["shot_id", "opinion"] : []),
    ...(command.type === "query" ? [] : ["request_id"]),
  ];
  for (const key of Object.keys(command))
    if (!allowed.includes(key)) invalid(`command.${key}`, "未定义字段");
  if (
    command.type !== "query" &&
    (!command.request_id ||
      typeof command.request_id !== "string" ||
      command.request_id.length > 128)
  )
    invalid("command.request_id", "写入需幂等键");
  for (const key of commandFields[command.type]) {
    if (command.type === "query" || key === "opinion") continue;
    if (!Object.hasOwn(command, key)) invalid(`command.${key}`, "缺少字段");
  }
  for (const key of ["target_id", "task_id", "group_id", "episode_id", "shot_id"])
    if (Object.hasOwn(command, key)) assertId(command[key], `command.${key}`);
  if (command.type === "query" && command.task_id && command.group_id)
    invalid("command", "查询只能指定 task_id 或 group_id");
  if (command.business_type)
    assertEnum(
      command.business_type,
      Object.keys(BUSINESS_TARGET),
      "command.business_type",
    );
  if (command.type === "submit") {
    assertEnum(
      command.action,
      ["generate", "regenerate"],
      "command.action（继续仅组合）",
    );
    if (command.business_type.endsWith("-delete"))
      invalid("command.business_type", "删除使用 delete 命令");
    if (command.opinion !== undefined) {
      assertText(command.opinion, "command.opinion");
      if (command.action === "generate" && command.opinion.trim())
        invalid("command.opinion", "首次生成不接受修改意见");
    }
  }
  if (command.type === "submit-group")
    assertEnum(
      command.group_type,
      ["episode-seconds", "episode-film"],
      "command.group_type",
    );
  if (command.type === "submit-group") {
    if (command.shot_id && command.group_type !== "episode-film")
      invalid("command.shot_id", "单镜范围仅支持成片组合");
    if (command.opinion !== undefined) assertText(command.opinion, "command.opinion");
  }
  if (
    command.type === "delete" &&
    !["character-delete", "costume-delete"].includes(command.business_type)
  )
    invalid("command.business_type", "只支持角色/服装删除");
  if (
    ["manual-edit", "override"].includes(command.type) &&
    !NODE_TYPES.includes(command.business_type)
  )
    invalid("command.business_type", "人工操作只作用内容节点");
  if (
    command.type === "manual-edit" &&
    (command.content === null || command.content === undefined)
  )
    invalid("command.content", "人工编辑需内容");
  return command;
}
const references = {
  角色编号: { field: "角色id", kind: "character" },
  服装编号: { field: "服装id", kind: "costume" },
  说话人编号: { field: "说话人id", kind: "character" },
  默认服装编号: { field: "默认服装id", kind: "costume" },
  镜头编号: { field: "镜头id", kind: "shot" },
};
function catalogs(project, episodeId) {
  const map = new Map();
  const add = (number, id, kind) => {
    if (!number || map.has(number)) invalid("编号", "重复或空编号");
    map.set(number, { id, kind });
  };
  for (const c of project.角色库.角色) {
    add(c.编号, c.id, "character");
    for (const co of c.服装) add(co.编号, co.id, "costume");
  }
  const e = episodeId ? project.剧集.find((e) => e.id === episodeId) : null;
  if (episodeId && !e) invalid("episode_id", "剧集不存在");
  if (e) for (const s of e.镜头表.镜头) add(s.编号, s.id, "shot");
  return map;
}
export function projectNumberCatalog(project, episodeId) {
  const map = catalogs(project, episodeId),
    inverse = new Map([...map].map(([n, row]) => [row.id, n]));
  const fields = Object.fromEntries(
    Object.entries(references).map(([n, row]) => [row.field, n]),
  );
  const strip = (value) =>
    Array.isArray(value)
      ? value.map(strip)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).flatMap(([k, v]) => {
              if (k === "id" || k === "状态" || k === "原因" || k === "地址")
                return [];
              if (fields[k]) {
                if (v && !inverse.has(v)) invalid(k, "引用无法映射为编号");
                return [[fields[k], v ? inverse.get(v) : ""]];
              }
              if (k.endsWith("id")) return [];
              if (k === "图片") return [["有图", Boolean(v.地址)]];
              if (k === "参考图") return [];
              return [[k, strip(v)]];
            }),
          )
        : value;
  return {
    角色: project.角色库.角色.map(strip),
    镜头: episodeId
      ? project.剧集.find((e) => e.id === episodeId).镜头表.镜头.map(strip)
      : [],
  };
}
export function translateNumbers(value, project, episodeId) {
  const map = catalogs(project, episodeId);
  const walk = (v) =>
    Array.isArray(v)
      ? v.map(walk)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v).map(([k, data]) => {
              const ref = references[k];
              if (ref) {
                if (data === "") return [ref.field, ""];
                const row = map.get(data);
                if (!row || row.kind !== ref.kind)
                  invalid(k, `未知或类型不符的编号 ${data}`);
                return [ref.field, row.id];
              }
              if (k === "id" || k.endsWith("id"))
                invalid(k, "AI 不得返回内部 ID");
              return [k, walk(data)];
            }),
          )
        : v;
  return walk(value);
}
