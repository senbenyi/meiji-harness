import {
  createId,
  assertFields,
  assertText,
  invalid,
} from "./task_contract.js";
import { emptyShot, validateProject } from "./project_contract.js";

const characterFields = [
  "编号",
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
  "声音",
  "必出",
  "默认服装编号",
  "服装",
];
const costumeFields = ["编号", "名称", "描述"];
const shotFields = ["序号", "编号", "时长秒", "标题", "正文", "出镜角色"];
const media = () => ({ 状态: "empty", 原因: "", 依赖hash: "", 地址: "" });

// 在事务草稿中执行；整次合并通过验证后才替换，失败不修改调用方。
export function mergeCharacters(project, rows) {
  if (!Array.isArray(rows)) invalid("角色", "需为数组");
  const draft = structuredClone(project),
    byNumber = new Map(draft.角色库.角色.map((c) => [c.编号, c])),
    allNumbers = new Set();
  for (const c of draft.角色库.角色) {
    allNumbers.add(c.编号);
    for (const co of c.服装) allNumbers.add(co.编号);
  }
  const seen = new Set(),
    newIds = [];
  for (const row of rows) {
    assertFields(row, characterFields, "角色输出");
    assertText(row.编号, "角色.编号");
    if (!row.编号 || seen.has(row.编号)) invalid("角色.编号", "重复或空编号");
    seen.add(row.编号);
    let c = byNumber.get(row.编号);
    if (!c) {
      if (allNumbers.has(row.编号)) invalid("角色.编号", "编号类型冲突");
      c = {
        id: createId("character"),
        图片: media(),
        参考图: { 地址: "" },
        服装: [],
      };
      draft.角色库.角色.push(c);
      allNumbers.add(row.编号);
      newIds.push(c.id);
    }
    const costumes = new Map(c.服装.map((co) => [co.编号, co])),
      seenCostumes = new Set();
    if (!Array.isArray(row.服装)) invalid("角色.服装", "需为数组");
    for (const data of row.服装) {
      assertFields(data, costumeFields, "服装输出");
      assertText(data.编号, "服装.编号");
      if (!data.编号 || seenCostumes.has(data.编号))
        invalid("服装.编号", "重复或空编号");
      seenCostumes.add(data.编号);
      let co = costumes.get(data.编号);
      if (!co) {
        if (allNumbers.has(data.编号))
          invalid("服装.编号", "编号冲突或不属于当前角色");
        co = { id: createId("costume"), 图片: media() };
        c.服装.push(co);
        costumes.set(data.编号, co);
        allNumbers.add(data.编号);
        newIds.push(co.id);
      }
      Object.assign(co, structuredClone(data));
    }
    const values = Object.fromEntries(
      characterFields
        .filter((k) => !["服装", "默认服装编号"].includes(k))
        .map((k) => [k, structuredClone(row[k])]),
    );
    Object.assign(c, values);
    assertText(row.默认服装编号, "默认服装编号");
    const selected = costumes.get(row.默认服装编号);
    if (row.默认服装编号 && !selected)
      invalid("默认服装编号", "未知或不属于当前角色");
    c.默认服装id = selected?.id || "";
  }
  validateProject(draft);
  return { characters: draft.角色库.角色, new_ids: newIds };
}

export function replaceShots(project, episodeId, rows, tasks = []) {
  if (!Array.isArray(rows)) invalid("镜头", "需为数组");
  const draft = structuredClone(project),
    episode = draft.剧集.find((e) => e.id === episodeId);
  if (!episode) invalid("episode_id", "剧集不存在");
  const byNumber = new Map(episode.镜头表.镜头.map((s) => [s.编号, s])),
    seen = new Set();
  const next = rows.map((row) => {
    assertFields(row, shotFields, "镜头输出");
    assertText(row.编号, "镜头.编号");
    if (!row.编号 || seen.has(row.编号)) invalid("镜头.编号", "重复或空编号");
    seen.add(row.编号);
    return {
      ...(byNumber.get(row.编号) || emptyShot()),
      ...structuredClone(row),
    };
  });
  const retained = new Set(next.map((s) => s.id)),
    removed = episode.镜头表.镜头.filter((s) => !retained.has(s.id));
  for (const shot of removed) {
    if (
      tasks.some(
        (t) =>
          t.target_id === shot.id &&
          ["queued", "running"].includes(t.task_status),
      )
    )
      invalid("镜头", "被移除镜头仍有未结束任务");
    if (draft.规则.some((r) => r.范围 === "node" && r.节点id === shot.id))
      invalid("镜头", "被移除镜头仍有节点规则引用");
  }
  episode.镜头表.镜头 = next;
  validateProject(draft);
  return { shots: next, removed_ids: removed.map((s) => s.id) };
}
