import { stepName } from "./task-labels.js";
import { BUSINESS_DEFINITIONS } from "./node-definitions.js";
import { createStepModel } from "./models/step_model.js";

export function reviewTypes(task) {
  const definition = BUSINESS_DEFINITIONS[task.business_type];
  return [
    ...(definition?.programReview ? ["program"] : []),
    ...(definition?.aiReview ? ["ai"] : []),
  ];
}
export function reviewType(step) {
  if (step.kind !== "review") return null;
  if (step.name.includes("程序审核")) return "program";
  if (step.name.includes("AI审核")) return "ai";
  throw new Error(`审核步骤未定义类型：${step.name}`);
}
export function stepKinds(task) {
  if (task.action === "delete") return ["precheck", "impact", "apply"];
  if (task.business_type === 'video' && task.action === 'manual_edit') return ['precheck', 'manual_edit', 'apply'];
  if (["manual_edit", "override"].includes(task.action))
    return ["precheck", task.action];
  // 剧本审核只审核当前剧本，不改写；按意见修改（revise）才先改写剧本再审核。
  if (task.business_type === "script-review" && task.action !== "revise") return ["precheck", "review"];
  return ["precheck", "generate", ...(task.business_type === 'video' ? ['apply'] : []), ...reviewTypes(task).map(() => "review")];
}
export function newStep(task, seq, kind, round = 0, reviewer = null) {
  return createStepModel({
    task_id: task.id,
    name: stepName({ kind, round, review_type: reviewer }, task),
    seq,
    kind,
    round,
  });
}
