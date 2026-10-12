import { TEXT_BUSINESSES, assertOutput } from "../../shared/node-state.js";
import { locateTarget, nodeOf } from "../../shared/task_contract.js";
import { loadTemplate } from "../prompts/yaml-prompts.js";
import { validateShape, prepareContent } from "./content.js";

export function createHandlerRegistry({ text, media }) {
  return async (context) => {
    const { snapshot, task, step } = context,
      p = snapshot.project,
      b = task.business_type;
    if (task.action === "delete") {
      const { object } = locateTarget(p, b, task.target_id);
      if (step.kind === "impact") {
        const shots = p.剧集
          .flatMap((e) => e.镜头表.镜头)
          .filter((s) => s.出镜角色.some((r) => r.服装id === object.id));
        return { result: { affected_video_ids: shots.map((s) => s.id) } };
      }
      if (step.kind === "apply")
        return {
          content: { delete_id: object.id },
          result: { deleted_id: object.id },
        };
    }
    if (task.action === "override") {
      assertOutput(p, b, task.target_id);
      return { content: null, result: { override: true } };
    }
    if (task.action === "manual_edit" && TEXT_BUSINESSES.includes(b)) {
      const raw = step.result?.input;
      const template = await loadTemplate(`${b}-generate`);
      validateShape(raw, template.input.system.输出格式.结构);
      const content = prepareContent(snapshot, task, raw);
      return { content, result: raw };
    }
    return TEXT_BUSINESSES.includes(b) ? text(context) : media(context);
  };
}
