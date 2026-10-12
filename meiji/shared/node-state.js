import { nodeOf, invalid, locateTarget } from "./task_contract.js";
import { validateProject } from "./project_contract.js";
import { TEXT_BUSINESSES } from "./node-definitions.js";

export const SHOT_DURATION_TOLERANCE_SECONDS = 30;

export function shotDurationRange(referenceSeconds) {
  return {
    min: Math.max(1, referenceSeconds - SHOT_DURATION_TOLERANCE_SECONDS),
    max: referenceSeconds + SHOT_DURATION_TOLERANCE_SECONDS,
  };
}

export { TEXT_BUSINESSES };
export function setNodeState(node, status, reason = "") {
  const allowed = {
    empty: ["queued"],
    queued: [
      "running",
      "empty",
      "generated",
      "rejected",
      "failed",
      "cancelled",
      "expired",
    ],
    running: ["generated", "rejected", "failed", "cancelled"],
    generated: ["queued", "expired"],
    rejected: ["queued"],
    failed: ["queued"],
    cancelled: ["queued"],
    expired: ["queued"],
  };
  if (node.状态 !== status && !allowed[node.状态]?.includes(status))
    invalid("状态", `非法转换 ${node.状态} → ${status}`);
  const needs = ["rejected", "failed", "cancelled", "expired"].includes(status);
  if (needs !== Boolean(reason.trim())) invalid("原因", "状态与原因不一致");
  node.状态 = status;
  node.原因 = reason;
}
export function enqueueNode(project, task) {
  const node = nodeOf(project, task.business_type, task.target_id);
  if (!node) {
    task.previous_node_state = null;
    return;
  }
  if (["queued", "running"].includes(node.状态)) invalid("状态", "目标已占用");
  task.previous_node_state = { 状态: node.状态, 原因: node.原因 };
  setNodeState(node, "queued");
}
export function restoreQueued(project, task) {
  const node = nodeOf(project, task.business_type, task.target_id);
  if (node)
    setNodeState(
      node,
      task.previous_node_state.状态,
      task.previous_node_state.原因,
    );
}
export function assertOutput(project, business, targetId) {
  validateProject(project);
  const { object } = locateTarget(project, business, targetId),
    node = nodeOf(project, business, targetId);
  const nonempty = (value, path) => {
    if (typeof value !== "string" || !value.trim())
      invalid(path, "产出内容为空");
  };
  if (business === "script") return nonempty(project.剧本.正文, "剧本");
  if (business === "script-split") {
    if (!project.剧集.length) invalid("拆分剧集", "没有生成剧集");
    for (const e of project.剧集) nonempty(e.剧情, "剧集.剧情");
    return;
  }
  if (business.endsWith("-delete")) return;
  if (["project-summary", "episode-summary"].includes(business))
    nonempty(node.正文, business);
  if (
    business === "project-summary" &&
    [...node.正文.replace(/\s/g, "")].length > 1000
  )
    invalid("项目摘要", "最多1000个字符");
  if (
    ["character-image", "costume-image", "video", "tail", "assembly"].includes(
      business,
    )
  )
    nonempty(node.地址, business);
  if (business === "outline") {
    if (
      !node.小段.length ||
      node.小段.reduce((n, x) => n + x.时长秒, 0) !== object.时长秒
    )
      invalid("故事大纲", "小段时长之和必须等于本集时长");
    for (const part of node.小段) nonempty(part.正文, "故事大纲");
  }
  if (business === "shots") {
    const { min, max } = shotDurationRange(object.时长秒),
      total = node.镜头.reduce((n, x) => n + x.时长秒, 0);
    if (
      !node.镜头.length ||
      total < min ||
      total > max
    )
      invalid(
        "镜头表",
        `镜头总时长超出允许范围（本集参考时长±${SHOT_DURATION_TOLERANCE_SECONDS}秒，允许 ${min}–${max} 秒）`,
      );
  }
  const coverage = (rows, duration) => {
    let end = 0;
    for (const row of rows) {
      if (row.开始秒 !== end) invalid("时段", "必须连续覆盖本镜");
      end = row.结束秒;
    }
    if (end !== duration) invalid("时段", "必须完整覆盖本镜");
  };
  if (business === "seconds") {
    nonempty(node.内容.事件, "事件");
    coverage(node.内容.节拍, object.时长秒);
  }
  if (business === "storyboard") coverage(node.正文, object.时长秒);
}
