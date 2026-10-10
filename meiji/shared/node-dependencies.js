import { nodeOf, locateTarget } from "./task-contract.js";

export function downstream(snapshot, business, id) {
  const p = snapshot.project,
    t = locateTarget(
      p,
      business === "character-setting"
        ? "character-image"
        : business === "costume-setting"
          ? "costume-image"
          : ["episode-plot", "episode-plot-sync"].includes(business)
            ? "outline"
            : business,
      id,
    ),
    e = t.episode,
    s = t.object;
  const one = (b, target) => ({ business_type: b, target_id: target });
  if (business === "script") return [one("project-summary", p.id)];
  // 剧集剧情（剧本原文）不是节点：拆分写入或人工编辑使摘要与故事大纲过期；
  // 自由创作剧本更新回写剧情时，故事大纲是剧情的来源，只使摘要过期。
  if (business === "episode-plot")
    return [one("episode-summary", id), one("outline", id)];
  if (business === "episode-plot-sync") return [one("episode-summary", id)];
  if (business === "script-split") return [];
  if (business === "outline")
    return ["episode-characters", "shots"].map((b) => one(b, id));
  if (business === "episode-characters") return [one("shots", id)];
  if (business === "shots")
    return e.镜头表.镜头.map((x) => one("seconds", x.id));
  if (business === "seconds") return [one("storyboard", id)];
  if (business === "storyboard") return [one("video", id)];
  if (business === "video") return [one("tail", id), one("assembly", e.id)];
  if (business === "tail") {
    const list = [...e.镜头表.镜头].sort((a, b) => a.序号 - b.序号),
      next = list[list.findIndex((x) => x.id === id) + 1];
    return next ? [one("video", next.id)] : [];
  }
  if (business === "character-setting") return [one("character-image", id)];
  if (business === "costume-setting") return [one("costume-image", id)];
  if (["character-image", "costume-image"].includes(business)) {
    const result = [];
    for (const episode of p.剧集)
      for (const shot of episode.镜头表.镜头) {
        const task = snapshot.tasks
          .filter(
            (t) =>
              t.business_type === "video" &&
              t.target_id === shot.id &&
              t.task_status === "completed",
          )
          .sort((a, b) => b.queue_order - a.queue_order)
          .find((t) =>
            snapshot.steps.some(
              (st) =>
                st.task_id === t.id && st.result?.address === shot.视频.地址,
            ),
          );
        const refs = task
          ? snapshot.steps.find(
              (st) =>
                st.task_id === task.id && st.result?.address === shot.视频.地址,
            )?.result?.reference_ids
          : null;
        const used = refs
          ? refs.includes(id)
          : shot.出镜角色.some((r) =>
              business === "costume-image"
                ? r.服装id === id
                : r.角色id === id && !r.服装id,
            );
        if (used) result.push(one("video", shot.id));
      }
    return result;
  }
  return [];
}
export function expireDownstream(
  snapshot,
  business,
  id,
  reason = `${business}已修改`,
) {
  const visited = new Set(),
    queue = downstream(snapshot, business, id);
  while (queue.length) {
    const item = queue.shift(),
      key = `${item.business_type}:${item.target_id}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const node = nodeOf(snapshot.project, item.business_type, item.target_id);
    if (node.状态 === "generated") {
      node.状态 = "expired";
      node.原因 = reason;
    }
    if (node.状态 === "queued") {
      const task = snapshot.tasks.find(
        (t) =>
          t.business_type === item.business_type &&
          t.target_id === item.target_id &&
          t.task_status === "queued",
      );
      if (task?.previous_node_state?.状态 === "generated")
        task.previous_node_state = { 状态: "expired", 原因: reason };
    }
    queue.push(...downstream(snapshot, item.business_type, item.target_id));
  }
  return [...visited];
}
