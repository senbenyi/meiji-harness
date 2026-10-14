import { videoType, videoPack, previousShot, videoImages } from './video-inputs.js';
import { shotTextInputs } from './shot-text-inputs.js';
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
  if (['shot-characters', 'seconds', 'storyboard'].includes(business)) {
    const { episode, object } = locateTarget(project, business, id);
    return { ...shotTextInputs(project, episode, object, business), requirements: project.creative_direction,
      upstream: business === 'shot-characters' ? upstream('shots', episode.id)
        : business === 'seconds' ? upstream('shot-characters', id) : upstream('seconds', id) };
  }
  if (['video', 'first-last-frame', 'multimodal'].includes(business)) {
    const { object: shot, episode } = locateTarget(project, business, id);
    const type = videoType(episode, shot), previous = previousShot(episode, shot);
    const pack = videoPack(type);
    return { type, duration: shot.duration_seconds, aspectRatio: project.aspect_ratio,
      prompt: body(shot.text_to_video_prompt), upstream: upstream('storyboard', id),
      ...(type === '多模态' ? { images: videoImages(project, shot).map(({ id, image }) => ({ id, address: image?.address || '', hash: image?.node_state.dependency_hash || '' })) } : {}),
      ...(type === '首尾帧' ? { previous: { id: previous.id, address: previous.last_frame.address, hash: upstream('tail', previous.id) } } : {}),
      ...(business === 'video' && pack ? { packed: body(nodeOf(project, pack, id)), packHash: upstream(pack, id) } : {}),
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

export function dependencyHash(snapshot, business, id) {
  return createHash("sha256")
    .update(canonical(dependencyMaterial(snapshot, business, id)))
    .digest("hex");
}

export function isNodeCurrent(snapshot, business, id) {
  try {
    if (business === 'video' && locateTarget(snapshot.project, business, id).object.last_frame.node_state.status !== 'generated') return false;
    if (business === 'tail' && locateTarget(snapshot.project, business, id).object.video.node_state.status !== 'generated') return false;
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

const shotTextBusinesses = ["shot-characters", "seconds", "storyboard"];

function restampShotText(snapshot) {
  for (const episode of snapshot.project.episodes || []) {
    for (const shot of episode.shot_list?.shots || []) {
      for (const business of shotTextBusinesses) {
        const node = nodeOf(snapshot.project, business, shot.id);
        if (node?.node_state?.status === "generated") stampDependencyHash(snapshot, business, shot.id);
      }
    }
  }
  for (const task of snapshot.tasks || []) {
    if (!shotTextBusinesses.includes(task.business_type) || task.previous_node_state?.status !== "generated") continue;
    task.previous_node_state.dependency_hash = dependencyHash(snapshot, task.business_type, task.target_id);
  }
}

// v9 项目去掉规则后，按不再包含规则的指纹重写已生成节点和排队快照。
export function removeProjectRules(snapshot) {
  delete snapshot.project.rules;
  restampShotText(snapshot);
}

// v10 项目去掉语言字段后，按不再包含语言的指纹重写已生成节点和排队快照。正文和状态不动。
export function detachOutputLanguage(snapshot) {
  delete snapshot.project.output_language;
  restampShotText(snapshot);
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
  const roleContext = () => p.episodes.flatMap(episode => [
    { ...one("shots", episode.id), context_only: true },
    ...episode.shot_list.shots.flatMap(shot => ['shot-characters', 'seconds', 'storyboard'].map(business => ({ ...one(business, shot.id), context_only: true }))),
  ]);
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
      ...e.shot_list.shots.map((x) => one("shot-characters", x.id)),
      // 集合顺序也影响前镜尾帧和合片，不能依赖每秒分镜变化才触达。
      ...e.shot_list.shots.flatMap(x => [one('first-last-frame', x.id), one('multimodal', x.id), one('video', x.id)]),
      one("assembly", e.id),
    ];
  if (business === 'shot-characters') {
    const shots = [...e.shot_list.shots].sort((a, b) => a.sequence - b.sequence);
    const next = shots[shots.findIndex(shot => shot.id === id) + 1];
    return [one('seconds', id), one('first-last-frame', id), one('multimodal', id), one('video', id), ...(next ? [one('shot-characters', next.id)] : [])];
  }
  if (business === "seconds") return [one("storyboard", id)];
  if (business === 'storyboard') return [one('first-last-frame', id), one('multimodal', id), one('video', id)];
  if (['first-last-frame','multimodal'].includes(business)) return [one('video', id)];
  if (business === 'video') return [one('tail', id), ...downstream(snapshot, 'tail', id), one('assembly', e.id)];
  if (business === "tail") {
    const list = [...e.shot_list.shots].sort((a, b) => a.sequence - b.sequence),
      next = list[list.findIndex((x) => x.id === id) + 1];
    return next && videoType(e, next) === '首尾帧' ? [one('first-last-frame', next.id), one('video', next.id)] : [];
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
        const used = videoType(episode, shot) === '多模态' && videoImages(p, shot).some(row => row.id === id || (business === 'character-image' && row.id === character.id));
        if (used) result.push(one('multimodal', shot.id), one('video', shot.id));
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
