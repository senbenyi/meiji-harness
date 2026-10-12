// 单个任务执行步骤的固定字段模型。
import { createId } from "../task_contract.js";
export const createStepModel = (fields = {}) => ({ id: createId("step"), task_id: "", name: "步骤", seq: 1, kind: "precheck", round: 0, step_status: "ready", error_reason: "", prompt: {}, result: {}, started_at: null, ended_at: null, ...fields });
