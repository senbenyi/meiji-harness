import {
  nodeOf,
  locateTarget,
  invalid,
} from "../../../shared/task_contract.js";
import { assertOutput, assertProgramReview, hasNodeContent, TEXT_BUSINESSES } from "../../../shared/node-state.js";
import { NODE_DEFINITIONS } from "../../../shared/node-definitions.js";
import { isNodeCurrent } from "../../../shared/node-dependencies.js";

export function precheck(snapshot, task, { libraryReferences = [] } = {}) {
  const p = snapshot.project,
    { object, episode, character } = locateTarget(
      p,
      task.business_type,
      task.target_id,
    ),
    node = nodeOf(p, task.business_type, task.target_id),
    original = task.previous_node_state?.status;
  const requireNode = (business, id) => {
    const n = nodeOf(p, business, id);
    if (n.node_state.status !== "generated") invalid("precheck", `${business}尚未有效生成`);
    assertOutput(p, business, id);
    if (!isNodeCurrent(snapshot, business, id)) invalid("precheck", `${business}依赖已过期，请重新生成`);
  };
  if (task.action === "override") {
    if (
      !TEXT_BUSINESSES.includes(task.business_type) ||
      original !== "rejected"
    )
      invalid("precheck", "只允许放行结构有效的未通过文本");
    assertProgramReview(p, task.business_type, task.target_id);
    return { passed: true };
  }
  if (task.action === "manual_edit") return { passed: true };
  if (task.action === "delete") {
    if (libraryReferences.includes(task.target_id))
      invalid("precheck", "素材库仍引用目标");
    if (task.business_type === "character-delete") {
      for (const e of p.episodes) {
        if (
          e.shot_list.shots.some(
            (s) =>
              s.on_screen_characters.some((r) => r.character_id === object.id) ||
              s.seconds_storyboard.storyboard.some((b) =>
                b.dialogue.some((d) => d.speaker_id === object.id),
              ),
          )
        )
          invalid("precheck", "角色仍被项目内容引用");
      }
    } else if (character.default_costume_id === object.id)
      invalid("precheck", "不能删除默认服装");
    if (p.rules.some((r) => r.scope === "node" && r.node_id === object.id))
      invalid("precheck", "目标仍被节点规则引用");
    return { passed: true };
  }
  if (task.action === "generate" && node && hasNodeContent(p, task.business_type, task.target_id))
    invalid("precheck", "已有内容请重新生成");
  if (task.action === "regenerate" && node && !hasNodeContent(p, task.business_type, task.target_id))
    invalid("precheck", "未生成节点请使用生成");
  const business = task.business_type;
  if (business === "script-split") {
    if (!p.script.body.trim()) invalid("precheck", "剧本为空");
    if (!Number.isInteger(p.reference_episode_duration_seconds) || p.reference_episode_duration_seconds < 1)
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
      if (!p.script.body.trim())
        invalid("precheck", "完整剧本为空");
    },
    "episode-summary": () => {
      if (!episode.plot.trim()) invalid("precheck", "本集剧情为空");
    },
    outline: () => {
      if (p.creation_mode === "自由创作" && !p.creative_direction.trim())
        invalid("precheck", "创作方向为空");
      if (p.creation_mode === "剧本" && !episode.plot.trim())
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
      for (const row of object.on_screen_characters) {
        const c = p.character_library.characters.find((c) => c.id === row.character_id);
        requireNode(
          row.costume_id ? "costume-image" : "character-image",
          row.costume_id || c.id,
        );
      }
      const list = [...episode.shot_list.shots].sort((a, b) => a.sequence - b.sequence),
        index = list.findIndex((s) => s.id === object.id);
      if (index > 0) requireNode("tail", list[index - 1].id);
    },
    tail: () => {
      requireNode("shots", episode.id);
      requireNode("video", object.id);
    },
    assembly: () => {
      if (!episode.shot_list.shots.length) invalid("precheck", "没有镜头");
      for (const shot of episode.shot_list.shots) requireNode("video", shot.id);
    },
    "character-image": () => {
      if (!object.name.trim() || !object.body_type.trim())
        invalid("precheck", "角色资料不足，请先补充人物姓名和身材资料");
    },
    "costume-image": () => {
      if (!object && character.costumes.length)
        invalid("precheck", "已有明确服装，请选择对应服装生成定妆照");
      requireNode("character-image", character.id);
    },
  };
  const precheckKey = NODE_DEFINITIONS[business]?.precheck;
  if (precheckKey) {
    const check = runNodePrecheck[precheckKey];
    if (!check) invalid("precheck", `未定义节点前置检查：${precheckKey}`);
    check();
  }
  return { passed: true, business_type: business, target_id: task.target_id };
}
