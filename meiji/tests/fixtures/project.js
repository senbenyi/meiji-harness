import { emptyProject, emptyEpisode, emptyShot } from "../../shared/project_contract.js";
import { createId } from "../../shared/task_contract.js";
import { emptyStorySegmentModel } from "../../shared/models/story_segment_model.js";
import { emptyStoryboardBeatModel } from "../../shared/models/storyboard_beat_model.js";
import { stampDependencyHash } from "../../shared/node-dependencies.js";
export function projectFixture() {
  const p = emptyProject({ name: "新契约测试", creative_direction: "方向" });
  p.script.body = "完整剧本";
  p.character_library.node_state.status = "generated";
  p.project_summary.body = "摘要";
  p.project_summary.node_state.status = "generated";
  const e = emptyEpisode({ duration_seconds: 10, plot: "本集剧情原文" });
  p.episodes = [e];
  e.summary.body = "展示摘要";
  e.summary.node_state.status = "generated";
  e.story_outline.node_state.status = "generated";
  e.story_outline.segments = [{ ...emptyStorySegmentModel(), duration_seconds: 10, body: "故事" }];
  e.shot_list.node_state.status = "generated";
  e.assembly.node_state.status = "generated";
  e.assembly.address = "film.mp4";
  for (let n = 1; n <= 2; n++) {
    const s = emptyShot({ sequence: n, number: `S0${n}`, duration_seconds: 5, body: "剧情" });
    s.continuity_transition = "尾帧衔接";
    s.character_binding.has_result = true;
    s.character_binding.node_state.status = "generated";
    s.seconds_storyboard.node_state.status = "generated";
    s.seconds_storyboard.end_state = "人物站在原位，动作已结束，持物保持不变。";
    s.seconds_storyboard.storyboard = [{ ...emptyStoryboardBeatModel(), time_range: "0–5s", action: "动作", camera: "镜头", space: "空间", audio: "声音", handoff: "结束" }];
    s.text_to_video_prompt.node_state.status = "generated";
    s.text_to_video_prompt.integrated_multimodal_description = "动作；镜头；空间；声音；结束";
    s.video.node_state.status = "generated";
    s.video.address = `${n}.mp4`;
    s.actual_duration_seconds = 5;
    s.video_generation_type = n === 1 ? "文生" : "首尾帧";
    if (n > 1) Object.assign(s.first_last_frame_prompt, { model: "elysium-video", prompt: "compiled", seconds: 5, size: "1024x576", input_reference: "1.png", node_state: { status: "generated", reason: "", dependency_hash: "" } });
    s.last_frame.node_state.status = "generated";
    s.last_frame.address = `${n}.png`;
    e.shot_list.shots.push(s);
  }
  const snapshot = { project: p, tasks: [], steps: [] };
  stampDependencyHash(snapshot, "project-summary", p.id);
  stampDependencyHash(snapshot, "project-characters", p.id);
  for (const business of ["episode-summary", "outline", "shots"])
    stampDependencyHash(snapshot, business, e.id);
  for (const shot of e.shot_list.shots)
    for (const business of ["shot-characters", "seconds", "storyboard", "first-last-frame", "multimodal", "video", "tail"])
      stampDependencyHash(snapshot, business, shot.id);
  stampDependencyHash(snapshot, "assembly", e.id);
  return p;
}
export function taskFixture(p, business = "seconds", target = p.episodes[0].shot_list.shots[0].id, fields = {}) {
  return {
    id: createId("task"), project_id: p.id, episode_id: p.episodes[0].id,
    business_type: business, target_id: target, action: "regenerate", group_id: null, group_seq: null,
    task_status: "queued", source: "panel", queue_order: 1, end_reason: "",
    created_at: new Date().toISOString(), started_at: null, ended_at: null, opinion: "",
    previous_node_state: { status: "generated", reason: "" }, ...fields,
  };
}
export const snapshotFixture = () => ({
  project: projectFixture(), tasks: [], steps: [], groups: [],
  runtime: { revision: 1, requests: [], outbox: [] },
});
