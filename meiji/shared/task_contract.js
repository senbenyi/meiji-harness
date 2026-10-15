import { primaryCostumeImage } from "./models/character_model.js";
import {
  BUSINESS_TARGET,
  BUSINESS_DEFINITIONS,
  NODE_TYPES,
  NODE_DEFINITIONS,
} from "./node-definitions.js";

// 新任务协议的纯模块；不读取旧 Run、任务历史或文件。
export const NODE_STATUS = Object.freeze(["empty", "generated", "rejected", "expired"]);
// 历史任务的执行前快照保留原协议；当前项目节点只允许数据状态。
const HISTORICAL_NODE_STATUS = [...NODE_STATUS, "running", "failed", "cancelled"];
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
  "rejected",
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
  "revise",
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
export function validateNode(state, path, checkHash = true) {
  assertRecord(state, path);
  assertEnum(state.status, checkHash ? NODE_STATUS : HISTORICAL_NODE_STATUS, `${path}.status`);
  assertText(state.reason, `${path}.reason`);
  if (typeof state.fail_message !== "string") state.fail_message = "";
  if (state.status === "failed" && state.reason.trim() && !state.fail_message.trim()) {
    state.fail_message = state.reason;
    state.reason = "";
  }
  if (checkHash) {
    assertText(state.dependency_hash, `${path}.dependency_hash`);
    if (state.dependency_hash && !/^[a-f0-9]{64}$/.test(state.dependency_hash))
      invalid(`${path}.dependency_hash`, "需为空或依赖指纹");
  }
  const needsReason = ["rejected", "cancelled", "expired"].includes(state.status);
  const needsFail = state.status === "failed";
  if (needsReason !== Boolean(state.reason.trim()))
    invalid(`${path}.reason`, needsReason ? "当前状态必须有原因" : "当前状态原因为空");
  if (needsFail !== Boolean(state.fail_message.trim()))
    invalid(`${path}.fail_message`, needsFail ? "失败必须有失败说明" : "当前状态失败说明为空");
  return state;
}
export function locateTarget(project, business, targetId) {
  const kind = BUSINESS_TARGET[business];
  if (!kind) invalid("business_type", "未知任务业务");
  if (kind === "project" && project.id === targetId)
    return { kind, object: project, episode: null };
  if (kind === "character" || kind === "costume") {
    for (const character of project.character_library.characters) {
      if (kind === "character" && character.id === targetId)
        return { kind, object: character, character, episode: null };
      // 空服装限制属于新任务前置；旧未绑定定妆照在增加服装后仍可查询。
      if (business === "costume-image" && character.id === targetId)
        return { kind, object: null, character, episode: null };
      const costume = character.costumes.find(item => item.id === targetId);
      if (kind === "costume" && costume)
        return { kind, object: costume, character, episode: null };
    }
  }
  for (const episode of project.episodes) {
    if (kind === "episode" && episode.id === targetId)
      return { kind, object: episode, episode };
    const shot = episode.shot_list.shots.find(item => item.id === targetId);
    if (kind === "shot" && shot) return { kind, object: shot, episode };
  }
  invalid("target_id", "目标不存在或与业务归属不符");
}
export function nodeOf(project, business, targetId) {
  const definition = NODE_DEFINITIONS[business];
  if (!definition) return null;
  const target = locateTarget(project, business, targetId);
  if (business === "character-image") return primaryCostumeImage(target.character);
  if (business === "costume-image") {
    const node = target.character.costume_images.find(image => image.costume_id === (target.object?.id || ""));
    if (!node) invalid("target_id", "定妆照节点不存在");
    return node;
  }
  return target.object[definition.field];
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
  const removedBusiness = ["episode-characters", "script"].includes(t.business_type);
  if (removedBusiness && !TERMINAL_TASKS.includes(t.task_status))
    invalid("task.business_type", "已移除的任务只能保留为历史终态");
  assertEnum(t.business_type, [
    ...Object.keys(BUSINESS_TARGET),
    ...(removedBusiness ? [t.business_type] : []),
  ], "task.business_type");
  if (t.episode_id !== null) assertId(t.episode_id, "task.episode_id");
  if (NODE_TYPES.includes(t.business_type) || t.business_type === "episode-characters") {
    if (!Object.hasOwn(t.previous_node_state, "fail_message")) t.previous_node_state.fail_message = "";
    assertFields(
      t.previous_node_state,
      ["status", "reason", "fail_message"],
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
    if (TERMINAL_TASKS.includes(t.task_status)) return t;
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
  if (["failed", "rejected"].includes(s.step_status) && !s.error_reason.trim())
    invalid("step.error_reason", "失败或未通过需原因");
  timestamps(s, "step");
  return s;
}
export const COMMANDS = Object.freeze([
  "submit",
  "submit-group",
  "submit-costumes",
  "query",
  "cancel",
  "continue-group",
  "manual-edit",
  "override",
  "delete",
]);
const commandFields = {
  submit: ["business_type", "target_id", "action", "opinion"],
  "submit-costumes": ["action"],
  "submit-group": ["group_type", "episode_id"],
  query: ["task_id", "group_id"],
  cancel: ["task_id"],
  "continue-group": ["group_id"],
  "manual-edit": ["business_type", "target_id", "content"],
  override: ["business_type", "target_id"],
  delete: ["business_type", "target_id"],
};
export function validateCommand(command) {
  assertRecord(command, "command");
  assertEnum(command.type, COMMANDS, "command.type（命令）");
  assertId(command.project_id, "command.project_id");
  const allowed = [
    "type",
    "project_id",
    ...commandFields[command.type],
    ...(command.type === "submit-group" ? ["shot_id", "opinion", "action"] : []),
    ...(command.type === "submit-costumes" ? ["target_id"] : []),
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
  if (command.business_type === 'tail' && command.type !== 'query') invalid('business_type', '尾帧已并入视频任务');
  if (['first-last-frame', 'multimodal'].includes(command.business_type) && !['query','submit'].includes(command.type)) invalid('business_type', '程序编排只支持执行或查询');
  if (command.business_type === "character-image" && command.type !== "query")
    invalid("business_type", "独立角色图已移除，请生成人物定妆照");
  if (command.type === "submit-costumes") assertEnum(command.action, ["generate", "regenerate"], "command.action");
  if (command.type === "submit") {
    assertEnum(
      command.action,
      ["generate", "regenerate", "revise"],
      "command.action（继续仅组合）",
    );
    if (command.business_type.endsWith("-delete"))
      invalid("command.business_type", "删除使用 delete 命令");
    if (command.opinion !== undefined) assertText(command.opinion, "command.opinion");
    if (command.action === "revise") {
      if (BUSINESS_DEFINITIONS[command.business_type]?.handler !== "text") invalid("command.action", "按意见修改仅支持文本节点");
      if (!command.opinion?.trim()) invalid("command.opinion", "按意见修改需要修改意见");
    }
  }
  if (command.type === "submit-group")
    assertEnum(
      command.group_type,
      ["episode-seconds", "episode-film"],
      "command.group_type",
    );
  if (command.type === "submit-group") {
    assertEnum(command.action ?? "generate", ["generate", "regenerate"], "command.action");
    if (command.shot_id && command.group_type !== "episode-film")
      invalid("command.shot_id", "单镜范围仅支持成片组合");
    if (command.opinion !== undefined) assertText(command.opinion, "command.opinion");
    if ((command.action ?? "generate") === "generate" && command.opinion?.trim())
      invalid("command.opinion", "修改意见需使用重新生成");
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
  // 剧本节点只支持审核、按审核意见修改与人工放行，剧本不提供人工编辑。
  if (command.business_type === "script-review" && command.type === "manual-edit")
    invalid("command.business_type", "剧本只支持审核、按审核意见修改与人工放行");
  return command;
}
const references = {
  角色编号: { field: "character_id", kind: "character" },
  服装编号: { field: "costume_id", kind: "costume" },
  说话人编号: { field: "speaker_id", kind: "character" },
  默认服装编号: { field: "default_costume_id", kind: "costume" },
  镜头编号: { field: "shot_id", kind: "shot" },
};
function catalogs(project, episodeId) {
  const map = new Map();
  const add = (number, id, kind) => {
    if (!number || map.has(number)) invalid("编号", "重复或空编号");
    map.set(number, { id, kind });
  };
  for (const c of project.character_library.characters) {
    add(c.number, c.id, "character");
    for (const co of c.costumes) add(co.number, co.id, "costume");
  }
  const e = episodeId ? project.episodes.find((e) => e.id === episodeId) : null;
  if (episodeId && !e) invalid("episode_id", "剧集不存在");
  if (e) for (const s of e.shot_list.shots) add(s.number, s.id, "shot");
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
              if (["id", "node_state", "address"].includes(k))
                return [];
              if (fields[k]) {
                if (v && !inverse.has(v)) invalid(k, "引用无法映射为编号");
                return [[fields[k], v ? inverse.get(v) : ""]];
              }
              if (k.endsWith("id")) return [];

              if (k === "reference_image") return [];
              return [[k, strip(v)]];
            }),
          )
        : value;
  return {
    characters: project.character_library.characters.map(character => ({ ...strip(character), has_image: Boolean(primaryCostumeImage(character).address) })),
    shots: episodeId
      ? project.episodes.find((e) => e.id === episodeId).shot_list.shots.map(strip)
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
