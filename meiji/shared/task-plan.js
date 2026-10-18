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
  return ["precheck", "generate", ...(task.business_type === 'video' ? ['download', 'apply'] : []), ...reviewTypes(task).map(() => "review")];
}
// 调用模型（文本、图片、视频）的步骤为 AI，其余（前置、程序审核、编排、人工、写回）为程序。
export function stepExecutor(task, kind, reviewer = null) {
  if (kind === "review") return reviewer === "ai" ? "ai" : "program";
  if (!["generate", "revise"].includes(kind)) return "program";
  const definition = BUSINESS_DEFINITIONS[task.business_type];
  return ["text", "media"].includes(definition?.handler) && !["assembly", "tail"].includes(task.business_type) ? "ai" : "program";
}
// 工作快照中的步骤不含提示词与 HTTP（只在数据库行中，由运行中写入）；步骤 Model 定义完整行结构。
export function newStep(task, seq, kind, round = 0, reviewer = null) {
  const { prompt, http, ...step } = createStepModel({
    task_id: task.id,
    name: stepName({ kind, round, review_type: reviewer }, task),
    seq,
    kind,
    round,
    executor: stepExecutor(task, kind, reviewer),
  });
  return step;
}
