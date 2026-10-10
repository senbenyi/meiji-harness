import { createId } from "./task-contract.js";
import { TEXT_BUSINESSES } from "./node-state.js";
export function stepKinds(task) {
  if (task.action === "delete") return ["precheck", "impact", "apply"];
  if (["manual_edit", "override"].includes(task.action))
    return ["precheck", task.action];
  return [
    "precheck",
    "generate",
    // 拆分剧集由程序校验切分结果，不做 AI 自审。
    ...(TEXT_BUSINESSES.includes(task.business_type) &&
    task.business_type !== "script-split"
      ? ["review"]
      : []),
  ];
}
export function newStep(task, seq, kind, round = 0) {
  return {
    id: createId("step"),
    task_id: task.id,
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
