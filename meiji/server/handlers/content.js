import {
  expireDownstream,
  stampDependencyHash,
} from "../../shared/node-dependencies.js";
import { applyDelete } from "./deletion-handler.js";
import {
  nodeOf,
  locateTarget,
  translateNumbers,
  invalid,
} from "../../shared/task_contract.js";
import {
  mergeCharacters,
  replaceShots,
} from "../../shared/collection-identity.js";
import { assertOutput } from "../../shared/node-state.js";
import { emptyEpisode } from "../../shared/project_contract.js";
import { buildSplit } from "./script-split.js";

export function validateShape(value, shape, path = "响应") {
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) invalid(path, "需为数组");
    for (const row of value) validateShape(row, shape[0], path + "[]");
    return;
  }
  if (shape && typeof shape === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      invalid(path, "需为对象");
    for (const key of Object.keys(value))
      if (!Object.hasOwn(shape, key)) invalid(path + "." + key, "未定义字段");
    for (const key of Object.keys(shape)) {
      if (!Object.hasOwn(value, key)) invalid(path + "." + key, "缺少字段");
      validateShape(value[key], shape[key], path + "." + key);
    }
    return;
  }
  if (typeof value !== typeof shape) invalid(path, `需为 ${typeof shape}`);
}
export function aiProjection(value, p) {
  const map = new Map(),
    refs = {
      角色id: "角色编号",
      服装id: "服装编号",
      说话人id: "说话人编号",
      默认服装id: "默认服装编号",
      剧集id: "剧集序号",
    };
  for (const c of p.角色库.角色) {
    map.set(c.id, c.编号);
    for (const co of c.服装) map.set(co.id, co.编号);
  }
  for (const e of p.剧集) {
    map.set(e.id, e.序号);
    for (const s of e.镜头表.镜头) map.set(s.id, s.编号);
  }
  const walk = (v) =>
    Array.isArray(v)
      ? v.map(walk)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v).flatMap(([k, x]) => {
              if (
                k === "id" ||
                ["状态", "原因", "地址", "参考图", "修改记录"].includes(k)
              )
                return [];
              if (refs[k]) return [[refs[k], x ? map.get(x) || "" : ""]];
              if (k === "图片") return [["有图", Boolean(x.地址)]];
              return [[k, walk(x)]];
            }),
          )
        : v;
  return walk(value);
}

function shotsForProject(rows) {
  return rows.map((row, index) => ({
    序号: index + 1,
    编号: row.编号,
    时长秒: row.参考时长,
    标题: row.标题,
    正文: row.正文,
    出镜角色: [],
  }));
}

export function prepareContent(snapshot, task, raw) {
  const p = snapshot.project,
    b = task.business_type,
    target = locateTarget(p, b, task.target_id);
  if (b === "project-characters") {
    const merged = mergeCharacters(p, raw.角色);
    return { 角色: merged.characters, new_ids: merged.new_ids };
  }
  if (b === "script") {
    const sections = raw.分节.map((row) => {
      const e = p.剧集.find((e) => e.序号 === row.剧集序号);
      if (!e) invalid("剧集序号", "未知剧集");
      return { 剧集id: e.id, 正文: row.正文 };
    });
    return { 正文: raw.正文, 剧情: sections, 后续剧情: raw.后续剧情 };
  }
  if (b === "script-split") return buildSplit(p.剧本.正文, raw);
  const spoken =
    b === "shots"
      ? {
          ...raw,
          镜头: shotsForProject(raw.镜头),
        }
      : structuredClone(raw);
  if (b === "seconds")
    for (const beat of spoken.内容.节拍)
      for (const d of beat.对白) {
        const c = p.角色库.角色.find((c) => c.编号 === d.说话人编号);
        d.说话人名称 = c?.名称 || d.说话人编号;
        if (!c) d.说话人编号 = "";
      }
  const content = translateNumbers(spoken, p, target.episode?.id);
  if (b === "shots") {
    const result = replaceShots(
      p,
      target.episode.id,
      content.镜头,
      snapshot.tasks,
    );
    content.镜头 = result.shots;
    content.removed_ids = result.removed_ids;
  }
  const probe = structuredClone(snapshot);
  try {
    commitContent(probe, task, content);
  } catch (error) {
    if (
      b === "shots" &&
      error.message.startsWith("镜头表：镜头总时长超出允许范围")
    )
      error.preparedContent = content;
    throw error;
  }
  return content;
}
export function commitContent(snapshot, task, content) {
  const p = snapshot.project,
    b = task.business_type,
    node = nodeOf(p, b, task.target_id);
  if (task.action === "delete") {
    applyDelete(snapshot, task);
    return [];
  }
  if (task.action === "override") {
    assertOutput(p, b, task.target_id);
    stampDependencyHash(snapshot, b, task.target_id);
    return [];
  }
  if (b === "script-split") {
    p.剧集 = content.剧集.map((e) => emptyEpisode(e));
    assertOutput(p, b, task.target_id);
    return [];
  }
  if (b === "script") {
    const { 剧情: sections = [], ...script } = content;
    for (const row of sections) {
      const e = p.剧集.find((e) => e.id === row.剧集id);
      if (!e || e.剧情 === row.正文) continue;
      e.剧情 = row.正文;
      expireDownstream(snapshot, "episode-plot-sync", e.id, "剧情已更新");
    }
    p.剧本 = {
      ...p.剧本,
      ...script,
      版本: p.剧本.版本 + 1,
      更新时间: new Date().toISOString(),
      修改记录: [
        ...p.剧本.修改记录,
        {
          时间: new Date().toISOString(),
          任务id: task.id,
          修改意见: task.opinion,
        },
      ],
    };
    assertOutput(p, b, task.target_id);
    return [];
  }
  if (b === "project-characters") {
    const old = new Map(node.角色.map((c) => [c.id, c]));
    node.角色 = content.角色;
    for (const c of node.角色) {
      const before = old.get(c.id);
      if (!before) continue;
      const visual = [
        "名称",
        "国籍",
        "身份",
        "身份特征",
        "性别",
        "年代",
        "年龄",
        "身高",
        "体型",
        "面相",
      ];
      if (visual.some((key) => c[key] !== before[key]))
        expireDownstream(snapshot, "character-setting", c.id, "固定资料已修改");
      for (const co of c.服装) {
        const previous = before.服装.find((x) => x.id === co.id);
        if (
          previous &&
          (co.名称 !== previous.名称 || co.描述 !== previous.描述)
        )
          expireDownstream(
            snapshot,
            "costume-setting",
            co.id,
            "服装资料已修改",
          );
      }
    }
  } else if (
    ["character-image", "costume-image", "video", "tail", "assembly"].includes(
      b,
    )
  ) {
    node.地址 = content.地址;
    // 视频/合片按实测时长写入镜头/剧集；参考时长 `时长秒` 不变。
    if (["video", "assembly"].includes(b) && content.实际时长秒 !== undefined)
      locateTarget(p, b, task.target_id).object.实际时长秒 = content.实际时长秒;
  } else if (b === "shots") node.镜头 = content.镜头;
  else Object.assign(node, structuredClone(content));
  if (b === "project-summary") node.剧本版本 = p.剧本.版本;
  assertOutput(p, b, task.target_id);
  stampDependencyHash(snapshot, b, task.target_id);
  const derived = [];
  if (b === "project-characters") {
    const eligible = new Set(content.new_ids || []);
    for (const c of p.角色库.角色) {
      if (eligible.has(c.id) && c.图片.状态 === "empty")
        derived.push({ business_type: "character-image", target_id: c.id });
      for (const co of c.服装)
        if (
          (eligible.has(co.id) || eligible.has(c.id)) &&
          co.图片.状态 === "empty"
        )
          derived.push({ business_type: "costume-image", target_id: co.id });
    }
  }
  return derived;
}
