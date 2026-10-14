import { primaryCostumeImage } from "./models/character_model.js";
import { createHash } from "node:crypto";
import { nodeOf, locateTarget } from "./task_contract.js";
import { assertOutput } from "./node-state.js";

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

const characterMaterial = character => ({
  name: character.name, gender: character.gender, era: character.era, position: character.position, age_range: character.age_range,
  body_type: character.body_type, hairstyle: character.hairstyle,
  signature_props: character.signature_props, immutable_traits: character.immutable_traits,
});

// 提示词与依赖使用同一份角色文字；图片、声线和默认服装配置不参与。
export function shotCharacterContext(project) {
  return project.character_library.characters.map(character => ({
    number: character.number,
    ...characterMaterial(character),
    costumes: character.costumes.map(costume => ({
      number: costume.number, name: costume.name, color: costume.color,
      material: costume.material, props: costume.props,
    })),
  }));
}

// 参与指纹的业务资料只定义在这里，节点状态和原因不参与；图片节点读取其固定参考图。
function dependencyMaterial(snapshot, business, id) {
  const project = snapshot.project;
  const upstream = (type, target) =>
    nodeOf(project, type, target).node_state.dependency_hash;
  const body = (node) => {
    const copy = { ...node };
    delete copy.node_state;
    return copy;
  };
  if (business === "project-summary" || business === "project-characters")
    return { 剧本正文: project.script.body };
  if (business === "character-image") {
    const character = locateTarget(project, business, id).character;
    return dependencyMaterial(snapshot, "costume-image", character.costumes[0]?.id || character.id);
  }
  if (business === "costume-image") {
    const { object: costume, character } = locateTarget(project, business, id);
    const primary = primaryCostumeImage(character);
    const first = primary.costume_id === (costume?.id || "");
    return {
      character: characterMaterial(character),
      costume: costume ? { name: costume.name, color: costume.color, material: costume.material, props: costume.props } : null,
      reference: first ? { address: character.reference_image.address } : { address: primary.address, dependency_hash: primary.node_state.dependency_hash },
    };
  }
  if (business === "episode-summary")
    return { 剧情: locateTarget(project, business, id).episode.plot };
  if (business === "outline") {
    const episode = locateTarget(project, business, id).episode;
    return { 剧情: episode.plot, 参考时长秒: episode.duration_seconds };
  }
  if (business === "shots") {
    const episode = locateTarget(project, business, id).episode;
    return {
      小段: episode.story_outline.segments.map((part) => ({
        序号: part.sequence,
        时长秒: part.duration_seconds,
        正文: part.body,
        衔接: part.causal,
      })),
      参考时长秒: episode.duration_seconds,
      角色资料: shotCharacterContext(project),
      上游: upstream("outline", episode.id),
    };
  }
  if (business === "seconds") {
    const located = locateTarget(project, business, id);
    return {
      标题: located.object.title,
      编号: located.object.number,
      时长秒: located.object.duration_seconds,
      正文: located.object.body,
      景别: located.object.shot_scale,
      钩子: located.object.hook,
      连续性衔接: located.object.continuity_transition,
      参考锚点: located.object.reference_anchor,
      音频安排: located.object.audio_arrangement,
      上游: upstream("shots", located.episode.id),
    };
  }
  if (business === "storyboard") {
    const shot = locateTarget(project, business, id).object;
    return { 分镜: body(shot.seconds_storyboard), 上游: upstream("seconds", shot.id) };
  }
  if (business === "video") {
    const located = locateTarget(project, business, id),
      shot = located.object,
      list = [...located.episode.shot_list.shots].sort(
        (a, b) => a.sequence - b.sequence,
      ),
      index = list.findIndex((item) => item.id === shot.id),
      previous = index > 0 ? list[index - 1] : null;
    return {
      提示词: body(shot.text_to_video_prompt),
      上游: upstream("storyboard", shot.id),
      参考图: referencedImages(snapshot, shot),
      上一尾帧: previous
        ? { 镜头id: previous.id, 地址: previous.last_frame.address, 上游: upstream("tail", previous.id) }
        : null,
    };
  }
  if (business === "tail") {
    const shot = locateTarget(project, business, id).object;
    return { 视频地址: shot.video.address, 上游: upstream("video", shot.id) };
  }
  if (business === "assembly") {
    const episode = locateTarget(project, business, id).episode;
    return {
      视频: [...episode.shot_list.shots]
        .sort((a, b) => a.sequence - b.sequence)
        .map((shot) => ({
          地址: shot.video.address,
          上游: upstream("video", shot.id),
        })),
    };
  }
  return {};
}

function referencedImages(snapshot, shot) {
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
          step.task_id === item.id && step.result?.address === shot.video.address,
      ),
    );
  const recorded = task
    ? steps.find(
        (step) =>
          step.task_id === task.id && step.result?.address === shot.video.address,
      )?.result?.reference_ids
    : null;
  const ids = Array.isArray(recorded)
    ? recorded
    : (shot.on_screen_characters || []).map((row) => row.costume_id || row.character_id);
  return ids.filter(Boolean).map((imageId) => {
    for (const character of snapshot.project.character_library.characters) {
      if (character.id === imageId)
        return {
          地址: primaryCostumeImage(character).address,
          上游: primaryCostumeImage(character).node_state.dependency_hash,
        };
      for (const costume of character.costumes)
        if (costume.id === imageId)
          return {
            地址: character.costume_images.find(image => image.costume_id === costume.id).address,
            上游: nodeOf(snapshot.project, "costume-image", imageId).node_state.dependency_hash,
          };
    }
    return { 地址: "", 上游: "" };
  });
}

export function dependencyHash(snapshot, business, id) {
  return createHash("sha256")
    .update(canonical(dependencyMaterial(snapshot, business, id)))
    .digest("hex");
}

export function isNodeCurrent(snapshot, business, id) {
  try {
    const node = nodeOf(snapshot.project, business, id);
    if (!node || node.node_state.status !== "generated") return false;
    assertOutput(snapshot.project, business, id);
    return recordedHash.test(node.node_state.dependency_hash) &&
      node.node_state.dependency_hash === dependencyHash(snapshot, business, id);
  } catch (error) {
    if (error.code === "INVALID_CONTRACT") return false;
    throw error;
  }
}

export function stampDependencyHash(snapshot, business, id) {
  const node = nodeOf(snapshot.project, business, id);
  if (!node) return "";
  node.node_state.dependency_hash = dependencyHash(snapshot, business, id);
  return node.node_state.dependency_hash;
}

export function downstream(snapshot, business, id) {
  const p = snapshot.project,
    t = locateTarget(
      p,
      business === "script"
        ? "project-summary"
        : business === "character-setting"
        ? "character-image"
        : business === "costume-setting"
          ? "costume-image"
          : ["episode-plot", "episode-plot-sync", "episode-duration"].includes(business)
            ? "outline"
            : business,
      id,
    ),
    e = t.episode,
    s = t.object;
  const one = (b, target) => ({ business_type: b, target_id: target });
  const roleContext = () => p.episodes.map(episode => ({ ...one("shots", episode.id), context_only: true }));
  if (business === "script") return [one("project-summary", p.id), one("project-characters", p.id)];
  // 剧集剧情（剧本原文）不是节点：拆分写入或人工编辑使摘要与故事大纲过期；
  // 自由创作剧本更新回写剧情时，故事大纲是剧情的来源，只使摘要过期。
  if (business === "episode-plot")
    return [one("episode-summary", id), one("outline", id)];
  if (business === "episode-plot-sync") return [one("episode-summary", id)];
  if (business === "episode-duration") return [one("outline", id), one("shots", id)];
  if (business === "project-characters") return roleContext();
  if (business === "script-split") return [];
  if (business === "outline") return [one("shots", id)];
  if (business === "shots")
    return [
      ...e.shot_list.shots.map((x) => one("seconds", x.id)),
      // 集合顺序也影响前镜尾帧和合片，不能依赖每秒分镜变化才触达。
      ...e.shot_list.shots.map((x) => one("video", x.id)),
      one("assembly", e.id),
    ];
  if (business === "seconds") return [one("storyboard", id)];
  if (business === "storyboard") return [one("video", id)];
  if (business === "video") return [one("tail", id), one("assembly", e.id)];
  if (business === "tail") {
    const list = [...e.shot_list.shots].sort((a, b) => a.sequence - b.sequence),
      next = list[list.findIndex((x) => x.id === id) + 1];
    return next ? [one("video", next.id)] : [];
  }
  if (business === "character-setting") return [...s.costume_images.map(image => one("costume-image", image.costume_id || id)), ...roleContext()];
  if (business === "costume-setting") return [one("costume-image", id), ...roleContext()];
  if (["character-image", "costume-image"].includes(business)) {
    const character = t.character;
    const isPrimary = business === "character-image" || (t.object?.id || "") === primaryCostumeImage(character).costume_id;
    const result = isPrimary ? character.costume_images
      .filter(image => image.costume_id !== primaryCostumeImage(character).costume_id)
      .map(image => one("costume-image", image.costume_id || character.id)) : [];
    for (const episode of p.episodes)
      for (const shot of episode.shot_list.shots) {
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
                st.task_id === t.id && st.result?.address === shot.video.address,
            ),
          );
        const refs = task
          ? snapshot.steps.find(
              (st) =>
                st.task_id === task.id && st.result?.address === shot.video.address,
            )?.result?.reference_ids
          : null;
        const used = refs
          ? refs.includes(id) || (isPrimary && refs.includes(character.id))
          : shot.on_screen_characters.some((r) =>
              business === "costume-image"
                ? (r.costume_id === id || (isPrimary && r.character_id === character.id && !r.costume_id))
                : r.character_id === id && !r.costume_id,
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
  const sourceExpired = nodeOf(snapshot.project, business, id)?.node_state.status === "expired";
  const visited = new Set(),
    queue = downstream(snapshot, business, id).map(item => ({ ...item, force: !compare || (sourceExpired && !item.context_only) }));
  while (queue.length) {
    const item = queue.shift(),
      key = `${item.business_type}:${item.target_id}`;
    if (visited.has(key)) continue;
    const node = nodeOf(snapshot.project, item.business_type, item.target_id);
    if (
      compare &&
      !item.force &&
      node.node_state.status !== "expired" &&
      recordedHash.test(node.node_state.dependency_hash || "") &&
      node.node_state.dependency_hash ===
        dependencyHash(snapshot, item.business_type, item.target_id)
    )
      continue;
    visited.add(key);
    if (node.node_state.status === "generated") {
      node.node_state.status = "expired";
      node.node_state.reason = reason;
    }
    const task = snapshot.tasks.find(
      (t) =>
        t.business_type === item.business_type &&
        t.target_id === item.target_id &&
        t.task_status === "queued",
    );
    if (task?.previous_node_state?.status === "generated")
      task.previous_node_state = { status: "expired", reason };
    queue.push(...downstream(snapshot, item.business_type, item.target_id)
      .map(next => ({ ...next, force: !compare || !next.context_only })));
  }
  return [...visited];
}
