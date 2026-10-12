import { stepName } from "./task-labels.js";
import { createId } from "./task-contract.js";
import { BUSINESS_DEFINITIONS } from "./node-definitions.js";
export function stepKinds(task) {
  if (task.action === "delete") return ["precheck", "impact", "apply"];
  if (["manual_edit", "override"].includes(task.action))
    return ["precheck", task.action];
  return [
    "precheck",
    "generate",
    // 拆分剧集由程序校验切分结果，不做 AI 自审。
    ...(BUSINESS_DEFINITIONS[task.business_type]?.review ? ["review"] : []),
  ];
}
export function newStep(task, seq, kind, round = 0) {
  return {
    id: createId("step"),
    task_id: task.id,
    name: stepName({ kind, round }, task),
    seq,
    kind,
    round,
    step_status: "ready",
    error_reason: "",
    prompt: null,
    result: null,
    started_at: null,
    ended_at: null,
  };
}
