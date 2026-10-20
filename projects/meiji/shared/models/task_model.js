// 单个制作任务的固定字段模型。
import { createId } from "../task_contract.js";
export const createTaskModel = (fields = {}) => ({ id: createId("task"), project_id: "", episode_id: null, business_type: "", target_id: "", action: "generate", group_id: null, group_seq: null, task_status: "queued", source: "panel", name: "任务", queue_order: 1, end_reason: "", created_at: new Date().toISOString(), started_at: null, ended_at: null, opinion: "", previous_node_state: null, ...fields });
