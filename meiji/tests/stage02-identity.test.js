import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeCharacters,
  replaceShots,
} from "../shared/collection-identity.js";
import { emptyProject, emptyEpisode } from "../shared/project-contract.js";
import { createId } from "../shared/task-contract.js";

const character = (编号 = "C01", 服装编号 = "C01-01") => ({
  编号,
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
  默认服装编号: 服装编号,
  服装: [{ 编号: 服装编号, 名称: "常服", 描述: "常服" }],
});
const shot = (编号 = "S01") => ({
  序号: 1,
  编号,
  时长秒: 5,
  标题: "镜头",
  正文: "剧情",
  出镜角色: [],
});

test("S2-07 角色合并保留 ID、资源和未返回对象，新对象新 ID，服装归属严格", () => {
  const p = emptyProject();
  p.角色库.角色 = mergeCharacters(p, [character()]).characters;
  const first = p.角色库.角色[0];
  first.图片 = { 状态: "generated", 原因: "", 依赖hash: "", 地址: "keep.png" };
  const merged = mergeCharacters(p, [
    { ...character(), 名称: "改名" },
    character("C02", "C02-01"),
  ]);
  assert.equal(merged.characters[0].id, first.id);
  assert.equal(merged.characters[0].服装[0].id, first.服装[0].id);
  assert.equal(merged.characters[0].图片.地址, "keep.png");
  assert.equal(merged.new_ids.length, 2);
  p.角色库.角色 = merged.characters;
  assert.equal(mergeCharacters(p, []).characters.length, 2);
  const before = structuredClone(p);
  assert.throws(
    () => mergeCharacters(p, [{ ...character("C02", "C01-01") }]),
    /不属于/,
  );
  assert.deepEqual(p, before);
});

test("S2-07 镜头重生成保留身份与资源，新增分配 ID，移除受占用/规则约束", () => {
  const p = emptyProject(),
    e = emptyEpisode();
  p.剧集 = [e];
  e.镜头表.镜头 = replaceShots(p, e.id, [shot()]).shots;
  const id = e.镜头表.镜头[0].id;
  e.镜头表.镜头[0].视频 = { 状态: "generated", 原因: "", 依赖hash: "", 地址: "keep.mp4" };
  const replaced = replaceShots(p, e.id, [{ ...shot(), 序号: 2 }, shot("S02")]);
  assert.equal(replaced.shots[0].id, id);
  assert.equal(replaced.shots[0].视频.地址, "keep.mp4");
  assert.notEqual(replaced.shots[1].id, id);
  const running = [{ target_id: id, task_status: "running" }];
  assert.throws(() => replaceShots(p, e.id, [], running), /未结束/);
  assert.deepEqual(
    replaceShots(p, e.id, [], [{ target_id: id, task_status: "completed" }])
      .removed_ids,
    [id],
  );
  p.规则 = [
    {
      id: createId("rule"),
      范围: "node",
      节点id: id,
      适用业务: ["video"],
      类别: "动作",
      约束: "必须",
      内容: "规则",
    },
  ];
  assert.throws(() => replaceShots(p, e.id, []), /规则引用/);
});
