import { nodeOf, invalid, locateTarget } from "./task_contract.js";
import { validateProject } from "./project_contract.js";
import { TEXT_BUSINESSES } from "./node-definitions.js";

export { TEXT_BUSINESSES };
export function setNodeState(node, status, reason = "") {
  const state = node.node_state;
  if (!["empty", "generated", "rejected", "expired"].includes(status))
    invalid("node_state.status", `非法数据状态 ${status}`);
  const needsReason = ["rejected", "expired"].includes(status);
  if (needsReason !== Boolean(reason.trim())) invalid("node_state.reason", "状态与原因不一致");
  state.status = status;
  state.reason = needsReason ? reason : "";
  state.fail_message = "";
}
export function enqueueNode(project, task) {
  const node = nodeOf(project, task.business_type, task.target_id);
  if (!node) { task.previous_node_state = null; return; }
  const { status, reason, fail_message = "" } = node.node_state;
  task.previous_node_state = { status, reason, fail_message };
}
export function releaseQueuedNodeStatus(project, tasks) {
  const apply = (business, id, node) => {
    if (node?.node_state?.status !== "queued") return;
    const match = (status) => tasks.find((task) => task.business_type === business && task.target_id === id && task.task_status === status);
    const previous = match("queued")?.previous_node_state;
    if (match("running")) Object.assign(node.node_state, { status: "running", reason: "", fail_message: "" });
    else if (previous && previous.status !== "queued") Object.assign(node.node_state, { status: previous.status, reason: previous.reason || "", fail_message: previous.fail_message || "" });
    else Object.assign(node.node_state, { status: "cancelled", reason: "排队中已从节点状态移除", fail_message: "" });
  };
  apply("script-review", project.id, project.script);
  apply("project-summary", project.id, project.project_summary);
  apply("project-characters", project.id, project.character_library);
  for (const character of project.character_library?.characters || [])
    for (const image of character.costume_images || [])
      apply("costume-image", image.costume_id || character.id, image);
  for (const episode of project.episodes || []) {
    apply("episode-summary", episode.id, episode.summary);
    apply("outline", episode.id, episode.story_outline);
    apply("shots", episode.id, episode.shot_list);
    apply("assembly", episode.id, episode.assembly);
    for (const shot of episode.shot_list?.shots || []) {
      apply("seconds", shot.id, shot.seconds_storyboard);
      apply("storyboard", shot.id, shot.text_to_video_prompt);
      apply("first-last-frame", shot.id, shot.first_last_frame_prompt);
      apply("multimodal", shot.id, shot.multimodal_prompt);
      apply("video", shot.id, shot.video);
      apply("tail", shot.id, shot.last_frame);
    }
  }
}
export function hasNodeContent(project, business, targetId) {
  if (business === "script-split") return project.episodes.length > 0;
  const node = nodeOf(project, business, targetId);
  if (!node) return false;
  if (business === "project-characters") return node.characters.length > 0;
  if (business === "outline") return node.segments.length > 0;
  if (business === "shots") return node.shots.length > 0;
  if (business === "script-review") return Boolean(node.body.trim());
  if (business === "seconds") return node.storyboard.length > 0;
  if (business === "storyboard") return Boolean(node.integrated_multimodal_description.trim());
  return Boolean((node.body ?? node.prompt ?? node.address ?? "").trim());
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
  if (business === "script-review") return nonempty(node.body, "剧本");
  if (["project-summary", "episode-summary"].includes(business)) nonempty(node.body, business);
  if (["character-image", "costume-image", "video", "tail", "assembly"].includes(business)) nonempty(node.address, business);
  if (business === "outline") {
    if (!node.segments.length) invalid("故事大纲", "产出内容为空");
    for (const part of node.segments) nonempty(part.body, "故事大纲");
  }
  if (business === "shots" && !node.shots.length) invalid("镜头表", "产出内容为空");
  if (['first-last-frame', 'multimodal'].includes(business)) nonempty(node.prompt, '视频编排');
  if (business === 'video') { nonempty(object.last_frame.address, '视频尾帧'); if (!(object.actual_duration_seconds > 0)) invalid('视频时长', '缺少实测时长'); }
  if (business === "seconds") {
    if (!node.storyboard.length) invalid("每秒分镜", "产出内容为空");
    nonempty(node.end_state, "每秒分镜.结束状态");
  }
  if (business === "storyboard") nonempty(node.integrated_multimodal_description, "文生视频提示词");
}

// 数值业务审核只在程序审核和人工放行执行；人工编辑及可消费结构校验不重复审核。
export function assertProgramReview(project, business, targetId) {
  assertOutput(project, business, targetId);
  const { object } = locateTarget(project, business, targetId), node = nodeOf(project, business, targetId);
  if (business === "seconds") {
    let end = 0;
    for (const beat of node.storyboard) {
      const range = beat.time_range.match(/^(\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)s$/);
      const start = Number(range[1]), next = Number(range[2]);
      if (Math.abs(start - end) > 1e-9 || next <= start) invalid("时段", "必须从0开始连续覆盖，不能重叠、倒序或留空隙");
      end = next;
    }
    if (Math.abs(end - object.duration_seconds) > 5 + 1e-9)
      invalid("每秒分镜", `总时长 ${end} 秒超出本镜参考 ${object.duration_seconds} 秒允许误差±5秒`);
  }
  if (business === 'video') {
    const actual = object.actual_duration_seconds;
    if (actual < 4 || actual > 15 || Math.abs(actual - object.duration_seconds) > 5 + 1e-9)
      invalid('视频时长', `实测 ${actual} 秒，需为4–15秒且与计划 ${object.duration_seconds} 秒相差不超过±5秒`);
  }
  if (business === "outline") {
    const total = node.segments.reduce((sum, segment) => sum + segment.duration_seconds, 0);
    if (Math.abs(total - object.duration_seconds) > 30)
      invalid("故事大纲", `小段总时长 ${total} 秒超出允许范围（本集参考时长 ${object.duration_seconds} 秒，允许误差±30秒）`);
  }
  if (business === "shots") {
    if (node.shots.some(shot => shot.duration_seconds < 4 || shot.duration_seconds > 15))
      invalid("镜头表", "镜头时长需为 4–15 秒");
    const expected = Math.round(object.story_outline.segments.reduce((sum, segment) => sum + segment.duration_seconds, 0));
    const total = node.shots.reduce((sum, shot) => sum + shot.duration_seconds, 0);
    if (Math.abs(total - expected) > 30)
      invalid('镜头表', `镜头总时长 ${total} 秒超出允许范围（故事小段合计取整 ${expected} 秒，允许误差±30秒）`);
  }
}

// 人工放行跳过 AI 审核；结构与本节点程序审核仍须通过。剧本没有程序审核，只要求剧本正文非空。
export function assertOverride(project, business, targetId) {
  return assertProgramReview(project, business, targetId);
}
