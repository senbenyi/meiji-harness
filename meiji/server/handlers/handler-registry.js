import { TEXT_BUSINESSES, assertProgramReview, assertOverride } from "../../shared/node-state.js";
import { locateTarget } from "../../shared/task_contract.js";
import { validateNodeResult } from "../http/ai-routes.js";
import { prepareContent, commitContent } from "./content.js";
import { taskNodeInput } from './node-inputs.js';
import { buildSplit, rejectedSplitCandidate } from "./script-split.js";

export function createHandlerRegistry({ text, media, videoPrompt }) {
  return async (context) => {
    const { snapshot, task, step, draft, reviewType } = context;
    const project = snapshot.project, business = task.business_type;
    if (step.kind === "review" && reviewType === "program" && TEXT_BUSINESSES.includes(business)) {
      try {
        if (business === "script-split") buildSplit(project.script.body, draft, project.reference_episode_duration_seconds);
        else {
          const probe = structuredClone(snapshot);
          commitContent(probe, task, draft, { passed: false });
          assertProgramReview(probe.project, business, task.target_id);
        }
        return { result: { 是否通过: true, 类型: "", 原因: "" } };
      } catch (error) {
        if (error.code !== "INVALID_CONTRACT") throw error;
        return { result: { 是否通过: false, 类型: "模型问题", 原因: error.message } };
      }
    }
    if (task.action === "delete") {
      const { object } = locateTarget(project, business, task.target_id);
      if (step.kind === "impact") {
        const shots = project.episodes.flatMap(episode => episode.shot_list.shots).filter(shot => shot.on_screen_characters.some(row => row.costume_id === object.id));
        return { result: { affected_video_ids: shots.map(shot => shot.id) } };
      }
      if (step.kind === "apply") return { content: { delete_id: object.id }, result: { deleted_id: object.id } };
    }
    if (task.action === "override" && business === "script-split") {
      const candidate = rejectedSplitCandidate(snapshot, task);
      buildSplit(project.script.body, candidate, project.reference_episode_duration_seconds);
      return { content: candidate, result: { override: true } };
    }
    if (task.action === "override") {
      assertOverride(project, business, task.target_id);
      return { content: null, result: { override: true } };
    }
    if (task.action === "manual_edit" && TEXT_BUSINESSES.includes(business)) {
      const raw = step.result?.input;
      validateNodeResult(business, "generate", raw, taskNodeInput(snapshot, task, null, "generate"));
      const content = prepareContent(snapshot, task, raw);
      return { content, result: raw };
    }
    if (['first-last-frame', 'multimodal'].includes(business)) return videoPrompt(context);
    return TEXT_BUSINESSES.includes(business) ? text(context) : media(context);
  };
}
