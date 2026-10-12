import {
  nodeOf,
  locateTarget,
  invalid,
} from "../../../shared/task-contract.js";
import { assertOutput, TEXT_BUSINESSES } from "../../../shared/node-state.js";
import { NODE_DEFINITIONS } from "../../../shared/node-definitions.js";

export function precheck(snapshot, task, { libraryReferences = [] } = {}) {
  const p = snapshot.project,
    { object, episode, character } = locateTarget(
      p,
      task.business_type,
      task.target_id,
    ),
    node = nodeOf(p, task.business_type, task.target_id),
    original = task.previous_node_state?.状态;
  const requireNode = (business, id) => {
    const n = nodeOf(p, business, id);
    if (n.状态 !== "generated") invalid("precheck", `${business}尚未有效生成`);
    assertOutput(p, business, id);
  };
  if (task.action === "override") {
    if (
      !TEXT_BUSINESSES.includes(task.business_type) ||
      original !== "rejected"
    )
      invalid("precheck", "只允许放行结构有效的未通过文本");
    assertOutput(p, task.business_type, task.target_id);
    return { passed: true };
  }
  if (task.action === "manual_edit") return { passed: true };
  if (task.action === "delete") {
    if (libraryReferences.includes(task.target_id))
      invalid("precheck", "素材库仍引用目标");
    if (task.business_type === "character-delete") {
      for (const e of p.剧集) {
        if (
          e.镜头表.镜头.some(
            (s) =>
              s.出镜角色.some((r) => r.角色id === object.id) ||
              s.每秒分镜.内容.节拍.some((b) =>
                b.对白.some((d) => d.说话人id === object.id),
              ),
          )
        )
          invalid("precheck", "角色仍被项目内容引用");
      }
    } else if (character.默认服装id === object.id)
      invalid("precheck", "不能删除默认服装");
    if (p.规则.some((r) => r.范围 === "node" && r.节点id === object.id))
      invalid("precheck", "目标仍被节点规则引用");
    return { passed: true };
  }
  if (task.action === "generate" && node && original !== "empty")
    invalid("precheck", "已有内容请重新生成");
  if (task.action === "regenerate" && node && original === "empty")
    invalid("precheck", "未生成节点请使用生成");
  const business = task.business_type;
  if (business === "script" && p.创作方式 !== "自由创作")
    invalid("precheck", "剧本模式不提供剧本修改任务");
  if (business === "script-split") {
    if (!p.剧本.正文.trim()) invalid("precheck", "剧本为空");
    if (!Number.isInteger(p.参考单集时长秒) || p.参考单集时长秒 < 1)
      invalid("precheck", "缺少参考单集时长");
    // 拆分会整体替换剧集；剧集上仍有未结束任务时无法替换。
    if (
      snapshot.tasks.some(
        (t) =>
          t.id !== task.id &&
          t.episode_id &&
          ["queued", "running"].includes(t.task_status),
      )
    )
      invalid("precheck", "剧集仍有未结束任务");
  }
  const runNodePrecheck = {
    "project-text": () => {
      if (business !== "script" && !p.剧本.正文.trim())
        invalid("precheck", "完整剧本为空");
    },
    "episode-summary": () => {
      if (!episode.剧情.trim()) invalid("precheck", "本集剧情为空");
    },
    outline: () => {
      if (p.创作方式 === "自由创作" && !p.创作方向.trim())
        invalid("precheck", "创作方向为空");
      if (p.创作方式 === "剧本" && !episode.剧情.trim())
        invalid("precheck", "本集剧情为空，请先拆分剧集");
    },
    shots: () => requireNode("outline", episode.id),
    "shots-input": () => requireNode("shots", episode.id),
    storyboard: () => {
      requireNode("shots", episode.id);
      requireNode("seconds", object.id);
    },
    video: () => {
      requireNode("shots", episode.id);
      requireNode("storyboard", object.id);
      for (const row of object.出镜角色) {
        const c = p.角色库.角色.find((c) => c.id === row.角色id);
        requireNode(
          row.服装id ? "costume-image" : "character-image",
          row.服装id || c.id,
        );
      }
      const list = [...episode.镜头表.镜头].sort((a, b) => a.序号 - b.序号),
        index = list.findIndex((s) => s.id === object.id);
      if (index > 0) requireNode("tail", list[index - 1].id);
    },
    tail: () => {
      requireNode("shots", episode.id);
      requireNode("video", object.id);
    },
    assembly: () => {
      if (!episode.镜头表.镜头.length) invalid("precheck", "没有镜头");
      for (const shot of episode.镜头表.镜头) requireNode("video", shot.id);
    },
    "costume-image": () => requireNode("character-image", character.id),
  };
  const precheckKey = NODE_DEFINITIONS[business]?.precheck;
  if (precheckKey) {
    const check = runNodePrecheck[precheckKey];
    if (!check) invalid("precheck", `未定义节点前置检查：${precheckKey}`);
    check();
  }
  return { passed: true, business_type: business, target_id: task.target_id };
}
