import { nodeOf, invalid, locateTarget } from "./task_contract.js";
import { validateProject } from "./project_contract.js";
import { TEXT_BUSINESSES } from "./node-definitions.js";

export const SHOT_DURATION_TOLERANCE_SECONDS = 30;
export function shotDurationRange(referenceSeconds) {
  return { min: Math.max(1, referenceSeconds - SHOT_DURATION_TOLERANCE_SECONDS), max: referenceSeconds + SHOT_DURATION_TOLERANCE_SECONDS };
}
export { TEXT_BUSINESSES };
export function setNodeState(node, status, reason = "") {
  const state = node.node_state;
  const allowed = {
    empty: ["queued"],
    queued: ["running", "empty", "generated", "rejected", "failed", "cancelled", "expired"],
    running: ["generated", "rejected", "failed", "cancelled"],
    generated: ["queued", "expired"],
    rejected: ["queued"], failed: ["queued"], cancelled: ["queued"], expired: ["queued"],
  };
  if (state.status !== status && !allowed[state.status]?.includes(status))
    invalid("node_state.status", `非法转换 ${state.status} → ${status}`);
  const needs = ["rejected", "failed", "cancelled", "expired"].includes(status);
  if (needs !== Boolean(reason.trim())) invalid("node_state.reason", "状态与原因不一致");
  state.status = status;
  state.reason = reason;
}
export function enqueueNode(project, task) {
  const node = nodeOf(project, task.business_type, task.target_id);
  if (!node) { task.previous_node_state = null; return; }
  const { status, reason } = node.node_state;
  if (["queued", "running"].includes(status)) invalid("node_state.status", "目标已占用");
  task.previous_node_state = { status, reason };
  setNodeState(node, "queued");
}
export function restoreQueued(project, task) {
  const node = nodeOf(project, task.business_type, task.target_id);
  if (node) setNodeState(node, task.previous_node_state.status, task.previous_node_state.reason);
}
export function hasNodeContent(project, business, targetId) {
  if (business === "script-split") return project.episodes.length > 0;
  const node = nodeOf(project, business, targetId);
  if (!node) return false;
  if (business === "project-characters") return node.characters.length > 0;
  if (business === "outline") return node.segments.length > 0;
  if (business === "shots") return node.shots.length > 0;
  if (business === "seconds") return node.storyboard.length > 0;
  if (business === "storyboard") return Boolean(node.integrated_multimodal_description.trim());
  return Boolean((node.body ?? node.address ?? "").trim());
}
export function assertOutput(project, business, targetId) {
  validateProject(project);
  const { object } = locateTarget(project, business, targetId), node = nodeOf(project, business, targetId);
  const nonempty = (value, path) => {
    if (typeof value !== "string" || !value.trim()) invalid(path, "产出内容为空");
  };
  if (business === "script-split") {
    if (!project.episodes.length) invalid("拆分剧集", "没有生成剧集");
    for (const episode of project.episodes) nonempty(episode.plot, "剧集.剧情");
    return;
  }
  if (business.endsWith("-delete")) return;
  if (["project-summary", "episode-summary"].includes(business)) nonempty(node.body, business);
  if (["character-image", "costume-image", "video", "tail", "assembly"].includes(business)) nonempty(node.address, business);
  if (business === "outline") {
    if (!node.segments.length) invalid("故事大纲", "产出内容为空");
    for (const part of node.segments) nonempty(part.body, "故事大纲");
  }
  if (business === "shots" && !node.shots.length) invalid("镜头表", "产出内容为空");
  if (business === "seconds") {
    let end = 0;
    if (!node.storyboard.length) invalid("每秒分镜", "产出内容为空");
    for (const beat of node.storyboard) {
      const range = beat.time_range.match(/^(\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)s$/);
      if (!range || Number(range[1]) !== end) invalid("时段", "必须连续覆盖本镜");
      end = Number(range[2]);
    }
    if (end !== object.duration_seconds) invalid("时段", "必须完整覆盖本镜");
  }
  if (business === "storyboard") nonempty(node.integrated_multimodal_description, "文生视频提示词");
}

// 数值业务审核只在程序审核和人工放行执行；人工编辑及可消费结构校验不重复审核。
export function assertProgramReview(project, business, targetId) {
  assertOutput(project, business, targetId);
  const { object } = locateTarget(project, business, targetId), node = nodeOf(project, business, targetId);
  if (business === "outline") {
    const total = node.segments.reduce((sum, segment) => sum + segment.duration_seconds, 0);
    if (Math.abs(total - object.duration_seconds) > 30)
      invalid("故事大纲", `小段总时长 ${total} 秒超出允许范围（本集参考时长 ${object.duration_seconds} 秒，允许误差±30秒）`);
  }
  if (business === "shots") {
    if (node.shots.some(shot => shot.duration_seconds < 4 || shot.duration_seconds > 15))
      invalid("镜头表", "镜头时长需为 4–15 秒");
    const { min, max } = shotDurationRange(object.duration_seconds), total = node.shots.reduce((n, x) => n + x.duration_seconds, 0);
    if (total < min || total > max)
      invalid("镜头表", `镜头总时长超出允许范围（本集参考时长±${SHOT_DURATION_TOLERANCE_SECONDS}秒，允许 ${min}–${max} 秒）`);
  }
}
