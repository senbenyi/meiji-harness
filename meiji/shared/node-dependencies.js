import { createHash } from "node:crypto";
import { nodeOf, locateTarget } from "./task-contract.js";

const recordedHash = /^[a-f0-9]{64}$/;
const canonical = (value) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );

// 参与指纹的资料只定义在这里。状态、原因、依赖hash、声音、默认服装id、画幅、输出语言、规则不参与。
function dependencyMaterial(snapshot, business, id, memo) {
  const project = snapshot.project;
  const upstream = (type, target) =>
    dependencyHash(snapshot, type, target, memo);
  const body = (node) => {
    const copy = { ...node };
    delete copy.状态;
    delete copy.原因;
    delete copy.依赖hash;
    return copy;
  };
  if (business === "project-summary" || business === "project-characters")
    return { 剧本正文: project.剧本.正文 };
  if (business === "character-image") {
    const character = locateTarget(project, business, id).object;
    return {
      名称: character.名称,
      国籍: character.国籍,
      身份: character.身份,
      身份特征: character.身份特征,
      性别: character.性别,
      年代: character.年代,
      年龄: character.年龄,
      身高: character.身高,
      体型: character.体型,
      面相: character.面相,
      必出: character.必出,
    };
  }
  if (business === "costume-image") {
    const costume = locateTarget(project, business, id).object;
    return { 名称: costume.名称, 描述: costume.描述 };
  }
  if (business === "episode-summary" || business === "outline")
    return { 剧情: locateTarget(project, business, id).episode.剧情 };
  if (business === "shots") {
    const episode = locateTarget(project, business, id).episode;
    return {
      小段: episode.故事大纲.小段.map((part) => ({
        序号: part.序号,
        时长秒: part.时长秒,
        正文: part.正文,
      })),
      上游: upstream("outline", episode.id),
    };
  }
  if (business === "seconds") {
    const located = locateTarget(project, business, id);
    return {
      标题: located.object.标题,
      编号: located.object.编号,
      时长秒: located.object.时长秒,
      正文: located.object.正文,
      上游: upstream("shots", located.episode.id),
    };
  }
  if (business === "storyboard") {
    const shot = locateTarget(project, business, id).object;
    return { 分镜: body(shot.每秒分镜), 上游: upstream("seconds", shot.id) };
  }
  if (business === "video") {
    const located = locateTarget(project, business, id),
      shot = located.object,
      list = [...located.episode.镜头表.镜头].sort(
        (a, b) => a.序号 - b.序号,
      ),
      index = list.findIndex((item) => item.id === shot.id),
      previous = index > 0 ? list[index - 1] : null;
    return {
      提示词: body(shot.文本提示词),
      上游: upstream("storyboard", shot.id),
      参考图: referencedImages(snapshot, shot, memo),
      上一尾帧: previous
        ? { 地址: previous.尾帧.地址, 上游: upstream("tail", previous.id) }
        : null,
    };
  }
  if (business === "tail") {
    const shot = locateTarget(project, business, id).object;
    return { 视频地址: shot.视频.地址, 上游: upstream("video", shot.id) };
  }
  if (business === "assembly") {
    const episode = locateTarget(project, business, id).episode;
    return {
      视频: [...episode.镜头表.镜头]
        .sort((a, b) => a.序号 - b.序号)
        .map((shot) => ({
          地址: shot.视频.地址,
          上游: upstream("video", shot.id),
        })),
    };
  }
  return {};
}

function referencedImages(snapshot, shot, memo) {
  const steps = snapshot.steps || [];
  const task = (snapshot.tasks || [])
    .filter(
      (item) =>
        item.business_type === "video" &&
        item.target_id === shot.id &&
        item.task_status === "completed",
    )
    .sort((a, b) => b.queue_order - a.queue_order)
    .find((item) =>
      steps.some(
        (step) =>
          step.task_id === item.id && step.result?.address === shot.视频.地址,
      ),
    );
  const recorded = task
    ? steps.find(
        (step) =>
          step.task_id === task.id && step.result?.address === shot.视频.地址,
      )?.result?.reference_ids
    : null;
  const ids = Array.isArray(recorded)
    ? recorded
    : (shot.出镜角色 || []).map((row) => row.服装id || row.角色id);
  return ids.filter(Boolean).map((imageId) => {
    for (const character of snapshot.project.角色库.角色) {
      if (character.id === imageId)
        return {
          地址: character.图片.地址,
          上游: dependencyHash(snapshot, "character-image", imageId, memo),
        };
      for (const costume of character.服装)
        if (costume.id === imageId)
          return {
            地址: costume.图片.地址,
            上游: dependencyHash(snapshot, "costume-image", imageId, memo),
          };
    }
    return { 地址: "", 上游: "" };
  });
}

export function dependencyHash(snapshot, business, id, memo = new Map()) {
  const key = `${business}:${id}`;
  if (memo.has(key)) {
    const cached = memo.get(key);
    if (cached == null) throw new Error(`依赖指纹循环：${key}`);
    return cached;
  }
  memo.set(key, null);
  const digest = createHash("sha256")
    .update(canonical(dependencyMaterial(snapshot, business, id, memo)))
    .digest("hex");
  memo.set(key, digest);
  return digest;
}

export function stampDependencyHash(snapshot, business, id) {
  const node = nodeOf(snapshot.project, business, id);
  if (!node) return "";
  node.依赖hash = dependencyHash(snapshot, business, id);
  return node.依赖hash;
}

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
  if (business === "outline") return [one("shots", id)];
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
  options = {},
) {
  const compare = options.compareHash !== false;
  const visited = new Set(),
    queue = downstream(snapshot, business, id);
  while (queue.length) {
    const item = queue.shift(),
      key = `${item.business_type}:${item.target_id}`;
    if (visited.has(key)) continue;
    const node = nodeOf(snapshot.project, item.business_type, item.target_id);
    if (
      compare &&
      recordedHash.test(node.依赖hash || "") &&
      node.依赖hash ===
        dependencyHash(snapshot, item.business_type, item.target_id)
    )
      continue;
    visited.add(key);
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
